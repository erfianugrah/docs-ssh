"""Spec for embed/embed.py (docs-ssh#5 phase 2). Runs with numpy + pytest
only: the real model (fastembed bge-small) is injected, a fake stands in.

Contract
- scan(docs_dir) -> {rel_path: (sha1_hex, text)} for every *.md under
  docs_dir, recursively, skipping files whose name starts with "_" and
  anything under a directory whose name starts with "_". text = the first
  2,000 characters of the file (utf-8, errors replaced); sha1 over text.
- State dir holds pages.tsv ("path\tsha1" per line, row i <-> vector i)
  and vectors.npy (float16, shape (n, dim), rows L2-normalised).
  load_state(dir) -> (paths: list[str], shas: list[str], vecs: np.ndarray);
  a missing state dir/files = empty state. save_state(dir, ...) writes both
  files atomically (temp file + os.replace).
- update(state, scanned, embed_fn, budget_s, clock=time.monotonic,
  batch=64) -> (new_state, stats): keeps vectors whose path is still in
  scanned with the same sha; drops removed pages; embeds new/changed pages
  in sorted-path order, batch by batch, and stops starting new batches once
  clock() - start >= budget_s (at least one batch always runs if anything
  is pending). embed_fn(list[str]) -> np.ndarray (n, dim) float; update
  L2-normalises. stats = {"kept", "embedded", "pending", "removed"}.
  Output order: sorted by path.
- neighbours(paths, shas, vecs, k=8, block=4096) -> list[(path, [paths])]:
  for every row, the k rows with the highest dot product, highest first,
  ties broken by path, excluding itself and rows with the same sha (the
  dump repeats pages). Pages with fewer candidates get fewer neighbours.
  Must give the same result for any block size.
- write_related(path, rows) writes "path\tn1\tn2..." lines sorted by path,
  atomically; rows with no neighbours are omitted.
- empty_state() -> ([], [], np.zeros((0, 0), np.float16)).
- main(argv): --docs DIR --state DIR [--budget-s 3600] [--k 8]; loads the
  real model lazily, runs scan/update/save_state/neighbours, writes
  <state>/_related.tsv, prints one summary line with the stats.
"""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(__file__))
import embed as E  # noqa: E402


def fake_embed(texts):
    """Deterministic 4-dim vectors: counts of a, b, c, d in the text."""
    return np.array([[t.count(ch) + 0.01 for ch in "abcd"] for t in texts], dtype=np.float32)


def write(root, rel, body):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(body)


@pytest.fixture
def docs(tmp_path):
    root = tmp_path / "docs"
    write(root, "s1/a.md", "aaaa")
    write(root, "s1/b.md", "bbbb")
    write(root, "s2/ab.md", "aabb")
    write(root, "s2/c.md", "cccc")
    write(root, "_links.tsv", "x")
    write(root, "s1/_hidden.md", "aaaa")
    write(root, "_meta/x.md", "aaaa")
    write(root, "s1/notes.txt", "aaaa")
    return str(root)


class Clock:
    def __init__(self, step):
        self.t, self.step = 0.0, step

    def __call__(self):
        self.t += self.step
        return self.t


def test_scan_skips_underscore_and_non_md(docs):
    s = E.scan(docs)
    assert sorted(s) == ["s1/a.md", "s1/b.md", "s2/ab.md", "s2/c.md"]
    sha, text = s["s1/a.md"]
    assert text == "aaaa" and len(sha) == 40


def test_scan_truncates_to_2000_chars(tmp_path):
    write(str(tmp_path), "s/long.md", "x" * 5000)
    assert len(E.scan(str(tmp_path))["s/long.md"][1]) == 2000


def test_update_embeds_all_pending_and_normalises(docs):
    state, stats = E.update(E.empty_state(), E.scan(docs), fake_embed, budget_s=1e9)
    paths, shas, vecs = state
    assert paths == sorted(paths) and len(paths) == 4
    assert stats == {"kept": 0, "embedded": 4, "pending": 0, "removed": 0}
    assert np.allclose(np.linalg.norm(vecs.astype(np.float32), axis=1), 1.0, atol=1e-2)


def test_update_is_incremental(docs):
    state, _ = E.update(E.empty_state(), E.scan(docs), fake_embed, budget_s=1e9)
    write(docs, "s1/b.md", "bbbbcc")  # changed
    os.remove(os.path.join(docs, "s2/c.md"))  # removed
    write(docs, "s3/d.md", "dddd")  # new
    calls = []

    def counting(texts):
        calls.extend(texts)
        return fake_embed(texts)

    state, stats = E.update(state, E.scan(docs), counting, budget_s=1e9)
    assert sorted(calls) == ["bbbbcc", "dddd"]
    assert stats == {"kept": 2, "embedded": 2, "pending": 0, "removed": 1}
    assert state[0] == ["s1/a.md", "s1/b.md", "s2/ab.md", "s3/d.md"]


def test_update_stops_at_budget_but_runs_one_batch(docs):
    state, stats = E.update(E.empty_state(), E.scan(docs), fake_embed, budget_s=0.5, clock=Clock(1.0), batch=1)
    assert stats["embedded"] == 1 and stats["pending"] == 3
    assert state[0] == ["s1/a.md"]  # sorted-path order: first pending page
    state, stats = E.update(state, E.scan(docs), fake_embed, budget_s=1e9)
    assert stats == {"kept": 1, "embedded": 3, "pending": 0, "removed": 0}


def test_state_roundtrip_and_missing_state(docs, tmp_path):
    assert E.load_state(str(tmp_path / "nope"))[0] == []
    state, _ = E.update(E.empty_state(), E.scan(docs), fake_embed, budget_s=1e9)
    d = str(tmp_path / "state")
    E.save_state(d, state)
    paths, shas, vecs = E.load_state(d)
    assert paths == state[0] and shas == state[1]
    assert vecs.dtype == np.float16 and vecs.shape == (4, 4)
    assert not [f for f in os.listdir(d) if f.endswith(".tmp")]


def test_neighbours_rank_and_exclusions():
    paths = ["a.md", "b.md", "c.md", "dup.md"]
    shas = ["1", "2", "3", "1"]  # dup.md repeats a.md
    v = np.array([[1, 0], [0.8, 0.6], [0, 1], [1, 0]], dtype=np.float32)
    rows = dict(E.neighbours(paths, shas, v, k=8))
    assert rows["a.md"] == ["b.md", "c.md"]  # not itself, not its duplicate
    assert rows["b.md"] == ["a.md", "dup.md", "c.md"]  # tie a/dup broken by path
    assert rows["c.md"][0] == "b.md"


def test_neighbours_k_and_block_invariance():
    rng = np.random.default_rng(0)
    v = rng.normal(size=(50, 8)).astype(np.float32)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    paths = [f"p{i:02d}.md" for i in range(50)]
    shas = [str(i) for i in range(50)]
    a = E.neighbours(paths, shas, v, k=5, block=7)
    b = E.neighbours(paths, shas, v, k=5, block=4096)
    assert a == b and all(len(n) == 5 for _, n in a)


def test_write_related(tmp_path):
    out = str(tmp_path / "_related.tsv")
    E.write_related(out, [("b.md", ["a.md"]), ("a.md", ["b.md", "c.md"]), ("z.md", [])])
    assert open(out).read() == "a.md\tb.md\tc.md\nb.md\ta.md\n"
