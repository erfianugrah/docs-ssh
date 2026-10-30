"""Embed docs pages and write per-page nearest neighbours (docs-ssh#5 phase 2).

See test_embed.py for the contract. Only numpy is imported at module level;
fastembed is imported lazily in main().
"""
import argparse
import hashlib
import os
import sys
import tempfile
import time

import numpy as np

TEXT_CHARS = 2000


def scan(docs_dir):
    """{rel_path: (sha1_hex, text)} for every *.md, skipping "_"-prefixed names."""
    out = {}
    for root, dirs, files in os.walk(docs_dir):
        dirs[:] = [d for d in dirs if not d.startswith("_")]
        for name in files:
            if name.startswith("_") or not name.endswith(".md"):
                continue
            full = os.path.join(root, name)
            with open(full, "rb") as f:
                text = f.read().decode("utf-8", errors="replace")[:TEXT_CHARS]
            rel = os.path.relpath(full, docs_dir).replace(os.sep, "/")
            out[rel] = (hashlib.sha1(text.encode("utf-8")).hexdigest(), text)
    return out


def empty_state():
    return ([], [], np.zeros((0, 0), np.float16))


def load_state(state_dir):
    pages = os.path.join(state_dir, "pages.tsv")
    vectors = os.path.join(state_dir, "vectors.npy")
    if not (os.path.isfile(pages) and os.path.isfile(vectors)):
        return empty_state()
    paths, shas = [], []
    with open(pages, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            p, s = line.split("\t")
            paths.append(p)
            shas.append(s)
    vecs = np.load(vectors)
    if vecs.shape[0] != len(paths):
        # simplify: a torn pair is discarded and everything re-embedded
        return empty_state()
    return paths, shas, vecs


def _atomic_write(path, write_fn, mode):
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, prefix=os.path.basename(path) + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, mode) as f:
            write_fn(f)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def save_state(state_dir, state):
    paths, shas, vecs = state
    os.makedirs(state_dir, exist_ok=True)
    vecs = np.asarray(vecs, dtype=np.float16)
    # np.save on a path appends .npy, so write to an open handle.
    _atomic_write(os.path.join(state_dir, "vectors.npy"), lambda f: np.save(f, vecs), "wb")
    body = "".join(f"{p}\t{s}\n" for p, s in zip(paths, shas))
    _atomic_write(os.path.join(state_dir, "pages.tsv"), lambda f: f.write(body), "w")


def _normalise(v):
    v = np.asarray(v, dtype=np.float32)
    n = np.linalg.norm(v, axis=1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def update(state, scanned, embed_fn, budget_s, clock=time.monotonic, batch=64):
    paths, shas, vecs = state
    old = {p: (s, i) for i, (p, s) in enumerate(zip(paths, shas))}
    kept = {}
    for p, (sha, _text) in scanned.items():
        o = old.get(p)
        if o is not None and o[0] == sha:
            kept[p] = (sha, vecs[o[1]])
    removed = sum(1 for p in old if p not in scanned)
    pending = sorted(p for p in scanned if p not in kept)

    start = clock()
    embedded = {}
    pos = 0
    while pos < len(pending):
        if pos > 0 and clock() - start >= budget_s:
            break
        chunk = pending[pos:pos + batch]
        out = _normalise(embed_fn([scanned[p][1] for p in chunk]))
        for p, v in zip(chunk, out):
            embedded[p] = (scanned[p][0], v)
        pos += len(chunk)

    merged = {**kept, **embedded}
    new_paths = sorted(merged)
    new_shas = [merged[p][0] for p in new_paths]
    if new_paths:
        new_vecs = np.stack([merged[p][1] for p in new_paths]).astype(np.float16)
    else:
        new_vecs = np.zeros((0, vecs.shape[1] if vecs.ndim == 2 else 0), np.float16)
    stats = {
        "kept": len(kept),
        "embedded": len(embedded),
        "pending": len(pending) - len(embedded),
        "removed": removed,
    }
    return (new_paths, new_shas, new_vecs), stats


def neighbours(paths, shas, vecs, k=8, block=4096):
    """Top-k rows by dot product per row; ties by path; excludes self and same-sha rows."""
    n = len(paths)
    if n == 0 or k <= 0:
        return [(p, []) for p in sorted(paths)] if k <= 0 else []
    # Work in path order so a stable sort on -score breaks ties by path.
    order = sorted(range(n), key=lambda i: paths[i])
    sp = [paths[i] for i in order]
    sha_ids = {}
    ss = np.array([sha_ids.setdefault(shas[i], len(sha_ids)) for i in order], dtype=np.int64)
    m = np.ascontiguousarray(np.asarray(vecs, dtype=np.float32)[order])

    result = []
    for lo in range(0, n, block):
        hi = min(lo + block, n)
        scores = m[lo:hi] @ m.T  # (hi-lo, n) float32
        scores[ss[lo:hi, None] == ss[None, :]] = -np.inf  # self and duplicates
        for r in range(hi - lo):
            s = scores[r]
            avail = int(np.isfinite(s).sum())
            kk = min(k, avail)
            if kk == 0:
                result.append((sp[lo + r], []))
                continue
            if kk < n:
                top = np.argpartition(-s, kk - 1)[:kk]
                thr = s[top].min()
                # argpartition may drop equal-score rows at the cut; take them all.
                cand = np.flatnonzero(s >= thr)
            else:
                cand = np.arange(n)
            best = cand[np.argsort(-s[cand], kind="stable")][:kk]  # cand is in path order
            result.append((sp[lo + r], [sp[j] for j in best]))
    return result


def write_related(path, rows):
    body = "".join(
        f"{p}\t" + "\t".join(ns) + "\n" for p, ns in sorted(rows, key=lambda r: r[0]) if ns
    )
    _atomic_write(path, lambda f: f.write(body), "w")


def main(argv):
    ap = argparse.ArgumentParser(prog="embed")
    ap.add_argument("--docs", required=True)
    ap.add_argument("--state", required=True)
    ap.add_argument("--budget-s", type=float, default=3600)
    ap.add_argument("--k", type=int, default=8)
    args = ap.parse_args(argv)

    t0 = time.monotonic()
    scanned = scan(args.docs)
    state = load_state(args.state)

    have = dict(zip(state[0], state[1]))
    pending_any = any(have.get(p) != s for p, (s, _t) in scanned.items())
    embed_fn = None
    if pending_any:
        import fastembed  # lazy: heavy, absent in tests

        model = fastembed.TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir=os.environ.get("EMBED_MODEL_DIR"))
        embed_fn = lambda texts: np.array(list(model.embed(texts, batch_size=64)))  # noqa: E731
    else:
        embed_fn = lambda texts: np.zeros((len(texts), 0))  # noqa: E731 - never called

    state, stats = update(state, scanned, embed_fn, args.budget_s)
    save_state(args.state, state)
    # block=1024: 1024 x 170k float32 scores = ~0.7 GB per block; the
    # function default (4096) would allocate ~2.8 GB on the CI host.
    rows = neighbours(*state, k=args.k, block=1024)
    write_related(os.path.join(args.state, "_related.tsv"), rows)
    related = sum(1 for _p, ns in rows if ns)
    print(
        "embed: kept={kept} embedded={embedded} pending={pending} removed={removed} "
        "pages={pages} related={related} secs={secs}".format(
            pages=len(state[0]), related=related, secs=round(time.monotonic() - t0), **stats
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
