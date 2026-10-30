#!/usr/bin/env python3
"""Rank of the expected page in live docs_search (MCP endpoint, the same
DocsService as SSH-side search) for every row labelled Y (the page the agent opened answers the query) or
fixed (the agent opened the wrong page; the right one was labelled by hand),
reported per group and combined.

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
out = ["rank\tlabel\tquery\tsource\texpected"]
ranks = {"Y": [], "fixed": []}
for lab, q, src, exp, url in rows:
    if lab not in ranks:
        continue
    res = search(q, src)
    urls = Counter(u for _, u in res)
    r = 0
    for i, (p, u) in enumerate(res, 1):
        if p == exp or (url and u == url and urls[u] == 1):
            r = i
            break
    ranks[lab].append(r)
    out.append(f"{r}\t{lab}\t{q}\t{src}\t{exp}")
open("baseline.tsv", "w").write("\n".join(out) + "\n")
def report(name, rs):
    n = len(rs)
    hits = "  ".join(f"hit@{k} {sum(1 for r in rs if 0 < r <= k)}/{n}" for k in (1, 5, 15))
    print(f"{name:<8} {hits}  MRR@15 {sum(1 / r for r in rs if r) / n:.3f}")
report("Y", ranks["Y"])
report("fixed", ranks["fixed"])
report("all", ranks["Y"] + ranks["fixed"])
