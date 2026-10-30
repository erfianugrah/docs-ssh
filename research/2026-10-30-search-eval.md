# Search eval set from the query log (docs-ssh#5, phase 0 -> 2)

Date: 2026-10-30. Raw files and scripts: `research/raw/2026-10-30-search-eval/`.

## What the log holds

The persistent query log (live since the 2026-10-22 build) held 3,126 lines
from 2026-10-22T06:08Z to 2026-10-30T05:55Z: 1,913 tool operations with an
`op` field, of which 444 were `search` (171 distinct queries) across 104
client sessions (`sid`), plus 41 MCP `tools/call` lines. Most volume is
`grep` (962) and `read` (291).

## How the eval set was built

`extract.py` pairs each search with the first `read` or `summary` the same
session made within the next five operations and before its next search.
That gave 53 candidate pairs; after merging pairs that differ only in query
case and dropping one query that names a private host, 51 remain.

A pair records what the agent opened next, which is not always the answer.
Each pair was judged by hand (`label.tsv`, one labeller):

| Label | Count | Meaning |
|---|---|---|
| Y | 31 | the opened page answers the query |
| N | 17 | the agent opened an unrelated page (e.g. "realtime limits concurrent connections" -> `auth/rate-limits.md`) |
| ? | 2 | could not tell from the path |
| gone | 1 | the page no longer exists in the corpus |

Two expected paths had moved since they were logged and were remapped by
hand: the pi docs moved under `pi/packages/coding-agent/docs/`, and
Hyperdrive's limits page went from `cloudflare/limits-3600.md` (2026-10-23)
to `cloudflare/limits-3603.md`. The second is a naming defect, carded as
docs-ssh#12: duplicate-title pages in llms-full splits are suffixed with
their position in the vendor file, so a page inserted earlier renames every
later one. To survive that, `label.tsv` also stores each expected page's
origin URL, and `baseline.py` accepts a URL match when no other result in
the list shares the URL (some sources map every page to one root URL).

## Keyword baseline

`baseline.py` runs each Y query, with the source filter the agent used,
through live `docs_search` on the MCP endpoint (the same DocsService the
SSH tools use), top 15:

| Metric | Value |
|---|---|
| hit@1 | 12/31 (39%) |
| hit@5 | 23/31 (74%) |
| hit@15 | 27/31 (87%) |
| MRR@15 | 0.53 |

Two runs gave identical numbers (the search is deterministic over one
build). The four misses: "update timescaledb extension ALTER EXTENSION"
(no source), "subtitles sync subsync" (bazarr), "clickAction"
(home-assistant), and "Get-WinEvent ConvertTo-Json" searched under the
`nvapi` source, which no search can answer.

## What these numbers can and cannot say

- n = 31, one labeller. A difference of one or two queries is noise.
- The set is biased toward keyword search. The Y pages are mostly pages
  the agent reached through the current search, so the baseline is
  inflated, and a semantic search that finds a better page than the one
  the agent opened scores as a miss. The 17 N rows are the opposite case:
  queries where search led the agent astray. Labelling the right page for
  them is the most useful next addition, because they are the queries an
  embedding search would have to win.
- The set describes one user's agents over eight days: Supabase,
  Cloudflare, NVAPI, Jellyfin and Home Assistant dominate.

## Next

1. Label the correct page for the 17 N rows (by reading the corpus), so
   the set measures failures as well as successes.
2. Re-run `extract.py` as the log grows; rows naming private hosts are
   dropped before commit (the repo is mirrored publicly).
3. Phase 2 (embedding neighbours) is measured against this set. Its open
   question stands: where the embedding pass runs (the CI runner on the
   router has no GPU; the dev-box GPU is shared with llmc).
