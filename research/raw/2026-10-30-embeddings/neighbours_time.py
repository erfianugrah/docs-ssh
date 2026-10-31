"""Time embed.neighbours() on the real embedding state. Run on the router
(the CI host) against the cache volume, read-only:
  docker run --rm --cpus 12 -v docs-ssh-cache:/cache:ro -v $PWD:/w \
    -v $REPO/embed:/embed python:3.12-slim \
    sh -c 'pip -q install numpy==2.5.4 && nice -n 19 python /w/neighbours_time.py'
2026-10-31, router idle: 57000 -> 169.4 s, 114176 -> 697.4 s.
Same script on the dev box (12 BLAS threads): 20000 -> 5.0 s, 57000 -> 37.7 s,
114176 -> 158.0 s."""
import sys, time
sys.path.insert(0, "/embed")
import embed

p, s, v = embed.load_state("/cache/embed")
for n in (57000, len(p)):
    t = time.monotonic()
    embed.neighbours(p[:n], s[:n], v[:n])
    print(n, round(time.monotonic() - t, 1), flush=True)
