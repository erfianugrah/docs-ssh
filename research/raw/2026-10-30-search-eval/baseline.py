#!/usr/bin/env python3
"""Rank of the expected page in live docs_search (MCP endpoint, the same
DocsService as SSH-side search) for every label=Y row of label.tsv.

A result matches on its path, or on its origin URL (search's 4th column)
when no other result in the list shares that URL - some sources map every
page to one root URL, so a shared URL identifies nothing. URL matching is
what keeps the set valid when a page's path moves between builds
(docs-ssh#12). Writes baseline.tsv; prints hit@1/5/15 and MRR@15.
The calls land in the server's query log as type:mcp lines with no sid,
so they never feed back into extract.py."""
import sys
from collections import Counter
from mcp import call
K = 15
def search(q, source):
    args = {"query": q, "maxResults": K}
    if source:
        args["source"] = source
    res = []
    for line in call("docs_search", args).splitlines():
        cols = line.split("\t")
        if cols[0].startswith("["):
            continue
        p = "/docs/" + cols[0].strip().lstrip("/").removeprefix("docs/")
        res.append((p, cols[3].strip() if len(cols) > 3 else ""))
    return res
rows = [l.split("\t") for l in open("label.tsv").read().splitlines()[1:]]
out = ["rank\tquery\tsource\texpected"]
ranks = []
for lab, q, src, exp, url in rows:
    if lab != "Y":
        continue
    res = search(q, src)
    urls = Counter(u for _, u in res)
    r = 0
    for i, (p, u) in enumerate(res, 1):
        if p == exp or (url and u == url and urls[u] == 1):
            r = i
            break
    ranks.append(r)
    out.append(f"{r}\t{q}\t{src}\t{exp}")
open("baseline.tsv", "w").write("\n".join(out) + "\n")
n = len(ranks)
for k in (1, 5, 15):
    h = sum(1 for r in ranks if 0 < r <= k)
    print(f"hit@{k}: {h}/{n} = {h/n:.0%}")
print("MRR@15:", round(sum(1 / r for r in ranks if r) / n, 3))
