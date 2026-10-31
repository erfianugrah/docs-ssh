"""Throughput of fastembed bge-small-en-v1.5 on the build host, over a fixed
random sample of corpus pages. Run on the router (MS-01, the CI host):
  docker run --rm --cpus 16 -v docs-ssh-cache:/cache:ro -v docs-ssh-embed-model:/model \
    -v $PWD:/w python:3.12-slim sh -c 'pip -q install fastembed && nice -n 19 python /w/rate.py'
PARALLEL lists the fastembed data-parallel settings to time ("0" = one process).
The __main__ guard matters: fastembed's parallel workers are spawned processes
that re-import this module (the first run without it re-walked the corpus in
every worker and drove the router's load average to 34).Text per page: first 2,000 chars (bge-small truncates at 512 tokens anyway)."""
import os, random, sys, time
from fastembed import TextEmbedding


def main():
    root = "/cache/docs"
    paths = []
    for d, _, fs in os.walk(root):
        paths += [os.path.join(d, f) for f in fs if f.endswith(".md")]
    random.seed(0)
    sample = random.sample(paths, int(os.environ.get("N", "3000")))
    texts = [open(p, encoding="utf-8", errors="replace").read(2000) for p in sample]
    print(f"corpus {len(paths)} pages, sample {len(texts)}, cpus {os.cpu_count()}", flush=True)
    model = TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir="/model")
    list(model.embed(texts[:64]))  # warm-up: model load + first session run
    for parallel in [int(x) or None for x in os.environ.get("PARALLEL", "0,4").split(",")]:
        t = time.time()
        n = sum(1 for _ in model.embed(texts, batch_size=64, parallel=parallel))
        dt = time.time() - t
        print(f"parallel={parallel}: {n} pages in {dt:.1f}s = {n/dt*60:.0f} pages/min", flush=True)


if __name__ == "__main__":
    main()
