"""docs-ssh#16: why did backfill run 143 embed ~146 pages/min when rate.py
measured 667? Run on the router against the cache volume, read-only:
  docker run --rm --cpus 12 -v docs-ssh-cache:/cache:ro -v docs-ssh-embed-model:/model \
    -v $PWD:/w -v $REPO/embed:/embed python:3.12-slim \
    sh -c 'pip -q install -r /embed/requirements.txt && nice -n 19 python /w/probe.py'
Compares a random corpus sample with a random sample of the still-pending
pages (same 2,000-char text embed.py uses), by token length (bge truncates
at 512; fastembed pads each batch to its longest row) and by measured rate,
with fastembed's default threads and with threads=12 (the --cpus quota)."""
import os, random, sys, time

sys.path.insert(0, "/embed")
import embed  # noqa: E402
from fastembed import TextEmbedding  # noqa: E402

N = int(os.environ.get("N", "512"))
t = time.monotonic()
scanned = embed.scan("/cache/docs")
paths, shas, _ = embed.load_state("/cache/embed")
have = dict(zip(paths, shas))
pending = sorted(p for p, (s, _t) in scanned.items() if have.get(p) != s)
print(f"scan {len(scanned)} pages, pending {len(pending)}, {time.monotonic() - t:.0f}s", flush=True)
by_src = {}
for p in pending:
    by_src[p.split("/")[0]] = by_src.get(p.split("/")[0], 0) + 1
print("pending by source:", sorted(by_src.items(), key=lambda x: -x[1])[:12], flush=True)

random.seed(0)
sets = {
    "random": random.sample(sorted(scanned), N),
    "pending": random.sample(pending, N),
    "pending-sorted": pending[:N],  # the order update() embeds in
}
m0 = TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir="/model")
tok = m0.model.tokenizer
for name, ps in sets.items():
    enc = tok.encode_batch([scanned[p][1] for p in ps])
    lens = [len(e.ids) for e in enc]  # tokenizer truncates at 512, as in the model
    padded = sum(max(lens[i:i + 64]) * len(lens[i:i + 64]) for i in range(0, N, 64)) / N
    print(f"{name}: mean tokens {sum(lens)/N:.0f}, at 512 {sum(l >= 512 for l in lens)/N:.0%}, "
          f"mean padded (batch 64) {padded:.0f}", flush=True)

for threads in [None, 12]:
    m = m0 if threads is None else TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir="/model", threads=threads)
    list(m.embed(["warm up"] * 64))
    for name, ps in sets.items():
        texts = [scanned[p][1] for p in ps]
        t = time.monotonic()
        n = sum(1 for _ in m.embed(texts, batch_size=64))
        dt = time.monotonic() - t
        print(f"threads={threads} {name}: {n / dt * 60:.0f} pages/min ({dt:.0f}s)", flush=True)
