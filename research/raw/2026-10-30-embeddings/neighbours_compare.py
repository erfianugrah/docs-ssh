"""docs-ssh#13: old (per-row argpartition, embed.py at 5f1ffe7) vs new
(chunk-max candidate cut) neighbours() on the real state, timed, with an
equality check over every row. Copy both versions next to this file as
embed_old.py / embed_new.py, plus pages.tsv + vectors.npy from
docs-ssh-cache:/cache/embed, then: python3 neighbours_compare.py <n> <block> [old]
2026-10-31 dev box, 12 BLAS threads, block 1024 (what main() uses):
  57000: new 7.5 s, old 36.6 s, equal
  114176: new 30.9 s, old 156.5 s, equal (0 differing rows)"""
import sys, time
import embed_old as O, embed_new as N

p, s, v = N.load_state(".")
n = int(sys.argv[1]); blk = int(sys.argv[2])
t = time.monotonic(); b = N.neighbours(p[:n], s[:n], v[:n], block=blk); tn = time.monotonic() - t
print("new", n, round(tn, 1), flush=True)
if len(sys.argv) > 3:
    t = time.monotonic(); a = O.neighbours(p[:n], s[:n], v[:n], block=blk); to = time.monotonic() - t
    print("old", n, round(to, 1), "equal", a == b, sum(x != y for x, y in zip(a, b)))
