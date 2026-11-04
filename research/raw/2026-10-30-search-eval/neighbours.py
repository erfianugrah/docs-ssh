"""Score docs_related against the eval set's `fixed` rows (docs-ssh#5 phase 2).

A fixed row is a search where the agent opened the wrong page. The question:
from the page it opened, would docs_related have pointed at the right one?
Hit = the expected page (by path, or by origin URL when the path moved) is
among the opened page's top-8 neighbours.

    python3 neighbours.py > neighbours.tsv
"""
import csv, sys
import mcp

HERE = __file__.rsplit("/", 1)[0] if "/" in __file__ else "."

def rows(name):
    with open(f"{HERE}/{name}", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))

opened = {}
for p in rows("pairs.tsv"):
    opened.setdefault((p["query"].lower(), p["source"]), p["read_path"])

out = csv.writer(sys.stdout, delimiter="\t", lineterminator="\n")
out.writerow(["query", "opened", "expected", "rank"])
hits = n = 0
for r in rows("label.tsv"):
    if r["label"] != "fixed":
        continue
    src = opened.get((r["query"].lower(), r["source"]))
    if not src:
        continue
    n += 1
    text = mcp.call("docs_related", {"path": src})
    paths = [l.split("\t")[0] for l in text.splitlines() if l.startswith("/docs/")]
    rank = ""
    if r["expected"] in paths:
        rank = str(paths.index(r["expected"]) + 1)
    elif r["expected_url"]:
        # URL match only when unique in the list (as baseline.py): some
        # sources map every page to one root URL.
        urls = [mcp.origin_url(p) for p in paths]
        if urls.count(r["expected_url"]) == 1:
            rank = str(urls.index(r["expected_url"]) + 1)
    hits += bool(rank)
    out.writerow([r["query"], src, r["expected"], rank])
print(f"# fixed rows scored: {n}, expected page in opened page's top-8 related: {hits}", file=sys.stderr)
