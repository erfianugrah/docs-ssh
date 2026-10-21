# Doc-to-doc link graph: feasibility probe (2026-10-21)

Question: can docs-ssh surface related pages by following the links docs
already contain? Probe over five sources pulled from the live container
(`/docs/_origins.tsv` + postgres, supabase, cloudflare, kubernetes, caddy).
Scripts: `research/raw/2026-10-21-link-graph/` (expect the corpus at `/tmp/dg`).

## Method 1: resolve links via `_origins.tsv` (resolve.mjs)

Resolve each markdown link against the page's origin URL, look it up in the
reverse origin map.

| source | links | resolved same-source | resolved cross-source | files with an edge |
|---|---|---|---|---|
| postgres | 37871 | 10039 | 6 | 809/809 |
| supabase | 8155 | 0 | 208 (postgres 189) | 93/821 |
| cloudflare | 92739 | (bogus, see below) | 887 (cloudflare-blog 532, ietf-rfc 110) | - |
| kubernetes | 10273 | 102 | 23 | 54/1722 |
| caddy | 1573 | 92 | 5 | 28/82 |

Works only where the origin is the published page URL (http scrape:
postgres). Git sources record GitHub blob URLs, so site-path links never
match; llms-full sources (cloudflare) record one origin, the site root, for
every page.

## Method 2: match link paths against corpus paths (suffix.mjs)

Per source: index files by path without extension/`index`; a site-relative
link (or an absolute link on the source's own site host) matches the longest
path suffix.

| source | in-site links | matched | files with an edge | distinct targets |
|---|---|---|---|---|
| postgres | 34565 | 29% | 809/809 | 807 |
| supabase | 5437 | 55% | 606/821 | 472 |
| cloudflare | 75789 | 45% | 6196/6215 | 2008 |
| kubernetes | 6302 | 93% | 1189/1722 | 672 |
| caddy | 827 | 89% | 72/82 | 74 |

Misses are mostly not doc pages: postgres site navigation (other versions,
news), supabase dashboard links, cloudflare API reference and asset URLs.

## Findings

- Same-source edges: method 2 gives nearly every page in these sources
  edges. Needs a per-source site host (supabase.com/docs, kubernetes.io/docs,
  ...) for absolute links.
- Cross-source edges: method 1 finds them where origins are real page URLs
  (supabase -> postgres, cloudflare -> cloudflare-blog / RFCs). Fixing
  origins for git sources (a `publicUrl` mapper, as erfi-technical-blog has)
  would extend it.
- Navigation noise: pages linked from most of a source (postgres index,
  version switchers) must be dropped or they dominate backlinks.
- Size: ~10^5 edges for these five sources. A TSV (`from\tto`) built at image
  build time and queried with rg answers one-hop "links / linked from" in
  milliseconds; a graph database server adds nothing for one-hop queries.

Not measured: whether agents answer better with the links. That needs a
before/after on real queries.
