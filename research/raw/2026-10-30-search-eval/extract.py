#!/usr/bin/env python3
"""Pair each logged docs_search with the first read/summary that follows it in
the same client session (sid), within 5 ops and before the next search.
Input: the container's query log, concatenated (stdin). Output: pairs.tsv
(query, source, read_path); session ids stay out of the committed file. A pair is a CANDIDATE: the read page is
what the agent opened next, not necessarily the right answer - label.tsv
carries the human judgement."""
import json, sys
ops = []
for line in sys.stdin:
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if o.get("op"):
        ops.append(o)
by = {}
for o in ops:
    if o.get("sid"):
        by.setdefault(o["sid"], []).append(o)
seen = set()
print("query\tsource\tread_path")
for sid, seq in by.items():
    for i, o in enumerate(seq):
        if o["op"] != "search":
            continue
        for n in seq[i + 1 : i + 6]:
            if n["op"] == "search":
                break
            if n["op"] in ("read", "summary") and n.get("path"):
                path = "/" + n["path"].lstrip("/")
                if not path.startswith("/docs/"):
                    path = "/docs" + path
                key = (o.get("q"), path)
                if key not in seen:
                    seen.add(key)
                    print(f"{o.get('q')}\t{o.get('source') or ''}\t{path}")
                break
