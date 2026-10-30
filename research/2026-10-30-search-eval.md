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
Each pair was judged by hand (`label.tsv`, one labeller), and where the agent
opened the wrong page, the right one was found by reading the corpus:

| Label | Count | Meaning |
|---|---|---|
| Y | 30 | the opened page answers the query |
| fixed | 14 | the agent opened the wrong page (e.g. "realtime limits concurrent connections" -> `auth/rate-limits.md`); the expected column holds the right page, labelled by hand |
| absent | 4 | no page in the corpus answers it: no Supabase HA/SLA page, no supabase-js reference, no Home Assistant companion-app notification docs |
| ? | 2 | could not tell |
| gone | 1 | the page no longer exists in the corpus |

One first-pass Y was wrong: "clickAction" -> `home-assistant/integrations/mobile_app` looked right by path, but that page never mentions `clickAction`; it appears only in a shopping_list example. It is `absent` now.

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

`baseline.py` runs each Y and fixed query, with the source filter the agent
used, through live `docs_search` on the MCP endpoint (the same DocsService
the SSH tools use), top 15:

| Group | n | hit@1 | hit@5 | hit@15 | MRR@15 |
|---|---|---|---|---|---|
| Y | 30 | 12 | 23 | 27 | 0.548 |
| fixed | 14 | 3 | 6 | 9 | 0.303 |
| all | 44 | 15 | 29 | 36 | 0.470 |

Repeat runs give identical numbers (the search is deterministic over one
build). Three fixed rows already rank first ("realtime limits ...",
"Scheduling Edge Functions", "HX711 load cell"): there the agent picked a
lower result, which no search change fixes. The fixed misses are where
search loses: "management api storage s3 access keys credentials create"
and "get project logs analytics endpoints" (the right pages are the
supabase-api spec pages), "mcp build", "gh api contents", "PowerShell
version". The Y misses: "update timescaledb extension ALTER EXTENSION"
(no source), "subtitles sync subsync" (bazarr), and "Get-WinEvent
ConvertTo-Json" searched under the `nvapi` source, which no search can
answer.

## What these numbers can and cannot say

- n = 44, one labeller. A difference of one or two queries is noise.
- The Y group is biased toward keyword search: those pages are mostly
  pages the agent reached through the current search, so its numbers are
  inflated. The fixed group is the counterweight, and the one a semantic
  search has to win; compare candidates on it first.
- The set describes one user's agents over eight days: Supabase,
  Cloudflare, NVAPI, Jellyfin and Home Assistant dominate.

## Next

1. Re-run `extract.py` as the log grows; rows naming private hosts are
   dropped before commit (the repo is mirrored publicly).
2. Phase 2 (embedding neighbours) is measured against this set. Its open
   question stands: where the embedding pass runs (the CI runner on the
   router has no GPU; the dev-box GPU is shared with llmc).
