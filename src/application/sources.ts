import { DocSource } from "../domain/DocSource.js";

// Browser User-Agent for the few government legislation sites that
// block non-browser UAs at the WAF/TLS layer (verified: planalto.gov.br
// ECONNRESETs, legisquebec.gouv.qc.ca and sso.agc.gov.sg 403 the
// docs-ssh UA, all 200 with a browser UA). Passed via DocSource.userAgent.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * Canonical definitions of all doc sources.
 *
 * Each source uses the best available fetch method:
 * - Supabase: git sparse-checkout of apps/docs/content (789 MDX files, full coverage)
 * - Cloudflare: llms-full.txt (40MB full dump) + git repo for raw MDX
 * - Vercel: llms-full.txt (11MB full dump)
 * - Next.js: llms-full.txt (full dump)
 * - Astro: llms-full.txt (full dump)
 * - MCP: llms.txt → per-page markdown URLs
 * - Fly.io: sitemap → HTML pages (filtered to /docs/)
 * - Tailwind: git repo with MDX docs
 * - Rust: git repo (The Rust Book)
 * - Postgres: TOC discovery → HTML pages
 * - AWS: llms-index → per-service llms.txt → HTML pages
 *
 * No hardcoded URL lists. The daily CI cron picks up changes automatically.
 */
export const SOURCES: readonly DocSource[] = [
  // ─── Supabase ──────────────────────────────────────────────────────

  // Git sparse-checkout of apps/docs/content — covers all guides, troubleshooting,
  // and reference pages including realtime/broadcast, postgres-changes, authorization,
  // etc. that the official tarball omits (~789 MDX files vs ~553 in the tarball).
  new DocSource({
    name: "supabase",
    type: "git",
    url: "https://github.com/supabase/supabase",
    format: "mdx",
    paths: ["apps/docs/content"],
    rootPath: "apps/docs/content",
    // Inline `<$Partial path="..." />` transclusions from `_partials/` and
    // drop the fragments from the served set (otherwise referencing pages
    // lose content and the raw directive leaks as noise).
    resolvePartials: true,
  }),

  // Blog — MDX source from the supabase/supabase repo
  new DocSource({
    name: "supabase-blog",
    type: "git",
    url: "https://github.com/supabase/supabase",
    format: "mdx",
    paths: ["apps/www/_blog"],
    rootPath: "apps/www/_blog",
  }),

  // @supabase/server — server-side auth/client utilities for Edge Functions, Workers, Hono.
  // No `paths` — DocSource.paths are scanned via readdir (dirs only); listing files there
  // crashes with ENOTDIR. The extension filter (.md/.mdx) already narrows the walk.
  new DocSource({
    name: "supabase-server",
    type: "git",
    url: "https://github.com/supabase/server",
    format: "markdown",
  }),

  // Foreign Data Wrappers catalog (mkdocs). The `supabase` docs tarball ships
  // only wrappers/overview.md; the per-wrapper catalog pages (s3, bigquery,
  // iceberg, snowflake, clickhouse, …) live in this repo under docs/.
  new DocSource({
    name: "supabase-wrappers",
    type: "git",
    url: "https://github.com/supabase/wrappers",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // Supabase ETL - the engine behind managed external replication (Fumadocs
  // site; docs moved from docs/src/content/docs to site/content/docs in the
  // upstream repo). The main docs cover only the Dashboard UX; architecture,
  // events, schema-changes and destination guides live here.
  new DocSource({
    name: "supabase-etl",
    type: "git",
    url: "https://github.com/supabase/etl",
    format: "mdx",
    paths: ["site/content/docs"],
    rootPath: "site/content/docs",
  }),

  // Supabase CLI reference. Upstream removed the committed per-command
  // markdown (apps/cli-go/docs) when porting the CLI from Go to TypeScript -
  // the reference is now generated at build time and published as a single
  // server-rendered page with #supabase-<command> anchors. Per-command URLs
  // all return the same shell, so we mirror the one usage page.
  new DocSource({
    name: "supabase-cli",
    type: "http",
    url: "https://supabase.com/docs/reference/cli/usage",
    format: "html",
  }),

  // Changelog - the full history (2022 to present, ~200 entries) lives on
  // supabase.com/changelog, which is backed by GitHub org-level
  // discussions (github.com/orgs/supabase/discussions) in the Changelog
  // category. There's no RSS feed (supabase.com/changelog/rss.xml 404s)
  // and no per-changelog sitemap, but the index page's SSR HTML embeds
  // every `href="/changelog/<id>-<slug>"` link, so `toc` discovery
  // harvests all entry URLs. Each entry page honours
  // `Accept: text/markdown` content negotiation and returns clean
  // markdown with YAML frontmatter (number/slug/published/discussion/
  // labels), bypassing Turndown via preNormalised. `urlPattern` filters
  // the harvested hrefs down to numeric-id entry pages (drops nav/self
  // links). urlToPath yields `<id>-<slug>.md`.
  new DocSource({
    name: "supabase-changelog",
    type: "http",
    url: "https://supabase.com/changelog/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://supabase.com/changelog",
    urlPattern: "supabase\\.com/changelog/[0-9]+-",
  }),

  // Incident + status history - status.supabase.com is an Atlassian
  // Statuspage. The whole history (back to Apr 2021) is reachable via the
  // JSON API: `/history.json?page=N` paginates 3 months/page listing every
  // incident code, and `/incidents/<code>.json` returns the full update
  // timeline (investigating -> resolved) + postmortem for any incident,
  // old ones included. `discovery: "statuspage"` drives the paginate-then-
  // fetch-each flow (statuspage-converter.ts), emitting one `<code>.md` per
  // incident. Resolved incidents are immutable, so this caches perfectly.
  new DocSource({
    name: "supabase-status",
    type: "http",
    url: "https://status.supabase.com",
    format: "markdown",
    discovery: "statuspage",
  }),

  // ─── Logflare ─────────────────────────────────────────────────────

  // Git sparse — Supabase's logging platform. Docs live inside the
  // main logflare repo as a Docusaurus site.
  new DocSource({
    name: "logflare",
    type: "git",
    url: "https://github.com/Logflare/logflare",
    format: "markdown",
    paths: ["docs/docs.logflare.com/docs"],
    rootPath: "docs/docs.logflare.com/docs",
  }),

  // ─── Cloudflare ────────────────────────────────────────────────────

  // llms-full.txt — entire docs in one 40MB file, pre-split into pages
  new DocSource({
    name: "cloudflare",
    type: "http",
    url: "https://developers.cloudflare.com/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://developers.cloudflare.com/llms-full.txt",
  }),

  // Blog — HTML pages from sitemap (~3500 posts). blog.cloudflare.com is
  // itself behind Cloudflare's bot / rate management, so the default
  // 15-wide burst trips throttling and collapses the source to zero
  // files (it then blows the 10-min source deadline). Throttle to 4-wide
  // and grant a 40-min deadline so the gentler scrape completes. Verified
  // live: 4-wide fetches all 3523 pages with zero retries/429s in ~25min
  // (40-min deadline leaves margin). The host also honours
  // `Accept: text/markdown` content negotiation, so every page comes back
  // as compact markdown (~4k tokens/page) that bypasses Turndown.
  new DocSource({
    name: "cloudflare-blog",
    type: "http",
    url: "https://blog.cloudflare.com/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://blog.cloudflare.com/sitemap-posts.xml",
    pageConcurrency: 4,
    deadlineMs: 2_400_000,
  }),

  // Changelog — individual post pages discovered via RSS feed
  new DocSource({
    name: "cloudflare-changelog",
    type: "http",
    url: "https://developers.cloudflare.com/changelog/",
    format: "html",
    discovery: "rss",
    discoveryUrl: "https://developers.cloudflare.com/changelog/rss/index.xml",
    urlPattern: "developers\\.cloudflare\\.com/changelog/post/",
  }),

  // ─── BunnyCDN ──────────────────────────────────────────────────────

  // llms-full.txt - entire docs.bunny.net in one ~1.3MB dump, pre-split
  // into per-page files. The BunnyWay/docs GitHub repo is only a Mintlify
  // starter template (15 scaffold files), not the real content, so the
  // single full-text dump is the cleanest mirror path.
  new DocSource({
    name: "bunnycdn",
    type: "http",
    url: "https://docs.bunny.net/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://docs.bunny.net/llms-full.txt",
  }),

  // ─── Fastly ────────────────────────────────────────────────────────

  // llms.txt - curated index of ~67 documentation page URLs under
  // www.fastly.com/documentation/. Pages are HTML; HttpIngestor's
  // content-negotiation (Accept: text/markdown) is attempted, falling
  // back to Turndown. urlPattern keeps only /documentation/ pages and
  // drops the bare landing + any external links the index references.
  new DocSource({
    name: "fastly",
    type: "http",
    url: "https://www.fastly.com/documentation/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://www.fastly.com/documentation/llms.txt",
    urlPattern: "fastly\\.com/documentation/.+",
  }),

  // ─── Vercel ────────────────────────────────────────────────────────

  // llms-full.txt — entire docs in one 11MB file
  new DocSource({
    name: "vercel",
    type: "http",
    url: "https://vercel.com/docs/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://vercel.com/docs/llms-full.txt",
  }),

  // Blog — HTML pages from sitemap (Vercel dropped .md suffix support for blog)
  new DocSource({
    name: "vercel-blog",
    type: "http",
    url: "https://vercel.com/blog/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://vercel.com/sitemap.xml",
    urlPattern: "vercel\\.com/blog/.+",
  }),

  // Changelog — HTML pages from sitemap (Vercel dropped .md suffix support for changelog)
  new DocSource({
    name: "vercel-changelog",
    type: "http",
    url: "https://vercel.com/changelog/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://vercel.com/sitemap.xml",
    urlPattern: "vercel\\.com/changelog/.+",
  }),

  // ─── PostgreSQL ────────────────────────────────────────────────────

  // TOC-based discovery — all pages from the book index
  new DocSource({
    name: "postgres",
    type: "http",
    url: "https://www.postgresql.org/docs/current/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://www.postgresql.org/docs/current/bookindex.html",
    urlPattern: "postgresql\\.org/docs/current/",
    urlExclude: "(bookindex|biblio|errcodes|features|acronyms)\\.html",
  }),

  // ─── PostgREST ─────────────────────────────────────────────────

  // The REST API layer behind Supabase's auto-generated API. Docs are
  // Sphinx/RST (no markdown source, no per-page sitemap) → scrape the stable
  // TOC as HTML.
  new DocSource({
    name: "postgrest",
    type: "http",
    url: "https://docs.postgrest.org/en/stable/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://docs.postgrest.org/en/stable/",
    urlPattern: "docs\\.postgrest\\.org/en/stable/",
    urlExclude: "(genindex|search|_sources)\\.html",
  }),

  // ─── pgloader ──────────────────────────────────────────────────

  // Bulk MySQL/MSSQL→Postgres migration tool referenced across the Supabase
  // migration guides. ReadTheDocs/Sphinx (RST) → scrape the latest TOC as HTML.
  new DocSource({
    name: "pgloader",
    type: "http",
    url: "https://pgloader.readthedocs.io/en/latest/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://pgloader.readthedocs.io/en/latest/",
    urlPattern: "pgloader\\.readthedocs\\.io/en/latest/",
    urlExclude: "(genindex|search|_sources)\\.html",
  }),

  // ─── Postgres blogs & newsletters ──────────────────────────────

  // Query-plan / EXPLAIN deep-dives. Full blog archive via sitemap
  // (~228 posts under /blog/*); no RSS on the site. urlPattern drops the
  // /blog index page itself plus product/marketing pages in the sitemap.
  new DocSource({
    name: "pgmustard",
    type: "http",
    url: "https://www.pgmustard.com/blog",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://www.pgmustard.com/sitemap.xml",
    urlPattern: "pgmustard\\.com/blog/.+",
  }),

  // pganalyze engineering blog + "5mins of Postgres" series. No RSS
  // (/feed redirect-loops); sitemap-index.xml is advertised in robots.txt.
  new DocSource({
    name: "pganalyze-blog",
    type: "http",
    url: "https://pganalyze.com/blog",
    format: "html",
    discovery: "sitemap-index",
    discoveryUrl: "https://pganalyze.com/sitemap-index.xml",
    urlPattern: "pganalyze\\.com/blog/.+",
  }),

  // Community aggregator. RSS items are postgr.es shortlinks that
  // redirect to the original blog posts across the Postgres blogosphere
  // (~15-item rolling window - a "latest from the community" slice that
  // refreshes on each daily build, not an archive). `url` points at the
  // shortlink host (not planet.postgresql.org) so urlToPath derives
  // clean `p/<id>.md` paths instead of raw-URL `https:/postgr.es/...`.
  new DocSource({
    name: "planet-postgres",
    type: "http",
    url: "https://postgr.es/",
    format: "html",
    discovery: "rss",
    discoveryUrl: "https://planet.postgresql.org/rss20.xml",
  }),

  // Weekly curated newsletter. RSS items link to self-hosted issue pages
  // (postgresweekly.com/issues/N) - recent window only; the full archive
  // is an HTML index, not a feed.
  new DocSource({
    name: "postgres-weekly",
    type: "http",
    url: "https://postgresweekly.com/",
    format: "html",
    discovery: "rss",
    discoveryUrl: "https://postgresweekly.com/rss",
  }),

  // ─── DuckDB ────────────────────────────────────────────────────

  // In-process analytical DB; reads/writes Parquet/CSV/JSON and Iceberg. Docs
  // are Jekyll markdown in duckdb-web; pin to the LTS docs dir to avoid the
  // per-version duplication (docs/0.10 … docs/current all coexist in-repo).
  new DocSource({
    name: "duckdb",
    type: "git",
    url: "https://github.com/duckdb/duckdb-web",
    format: "markdown",
    paths: ["docs/lts"],
    rootPath: "docs/lts",
  }),

  // ─── PlanetScale ───────────────────────────────────────────────

  // MySQL/Postgres-compatible serverless DB platform. Docs are a Next.js site;
  // ingest via the docs sitemap as HTML (origin doesn't serve markdown).
  new DocSource({
    name: "planetscale",
    type: "http",
    url: "https://planetscale.com/docs",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://planetscale.com/docs/sitemap.xml",
    urlPattern: "planetscale\\.com/docs/",
  }),

  // ─── MySQL ─────────────────────────────────────────────────────

  // The MySQL Reference Manual is not published as markdown or in any
  // git repo — dev.mysql.com is HTML-only with no sitemap/llms.txt and
  // doesn't honour content negotiation. The single mirror-able form is
  // the GNU info build (texinfo), shipped as `mysql-X.info.zip`: one
  // 4MB archive unpacking to the complete manual (~2,400 nodes). The
  // `texinfo` discovery splits it into per-node markdown. Pinned to the
  // 8.4 LTS series; bump the URL for a newer LTS when one ships.
  new DocSource({
    name: "mysql",
    type: "http",
    url: "https://dev.mysql.com/doc/refman/8.4/en/",
    format: "markdown",
    discovery: "texinfo",
    discoveryUrl: "https://downloads.mysql.com/docs/mysql-8.4.info.zip",
    // Oracle's CDN 403s downloads.mysql.com from GitHub runner and some
    // residential IP ranges (observed 2026-08: every daily build failed
    // with HTTP 403). Fall back to a Wayback Machine capture; the manual
    // is stable enough that a snapshot beats an absent source.
    fallbackDiscoveryUrl:
      "https://web.archive.org/web/20260310101758if_/https://downloads.mysql.com/docs/mysql-8.4.info.zip",
    description: "MySQL 8.4 Reference Manual (from the GNU info build)",
  }),

  // ─── Debezium ───────────────────────────────────────────────

  // Change-data-capture platform. Docs are Antora-flavoured AsciiDoc in
  // the main repo (`documentation/`), not markdown — the `adoc` format
  // routes the git checkout through asciidoc-converter.ts, which renders
  // each page with Asciidoctor (resolving include::/ifdef/xref against
  // the on-disk partials) and converts to markdown. Connector config
  // property tables that Debezium generates from Java at build time are
  // absent from git; those few fragments don't appear in the mirror.
  new DocSource({
    name: "debezium",
    type: "git",
    url: "https://github.com/debezium/debezium",
    format: "adoc",
    paths: ["documentation"],
    rootPath: "documentation",
    description: "Debezium CDC connectors and platform",
  }),

  // (AWS sources moved to end of file — they're the slowest to fetch
  //  and we don't want them blocking faster sources in early batches.)

  // ─── Next.js ───────────────────────────────────────────────────────

  // llms-full.txt — entire docs in one file
  new DocSource({
    name: "nextjs",
    type: "http",
    url: "https://nextjs.org/docs/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://nextjs.org/docs/llms-full.txt",
  }),

  // ─── Astro ─────────────────────────────────────────────────────────

  // Git sparse — Astro docs from withastro/docs repo (llms-full.txt removed)
  new DocSource({
    name: "astro",
    type: "git",
    url: "https://github.com/withastro/docs",
    format: "mdx",
    paths: ["src/content/docs/en"],
    rootPath: "src/content/docs/en",
  }),

  // ─── MCP (Model Context Protocol) ─────────────────────────────────

  // llms.txt lists individual .md page URLs
  new DocSource({
    name: "mcp",
    type: "http",
    url: "https://modelcontextprotocol.io/",
    format: "markdown",
    discovery: "llms-txt",
    discoveryUrl: "https://modelcontextprotocol.io/llms.txt",
  }),

  // ─── Fly.io ────────────────────────────────────────────────────────

  // Sitemap filtered to /docs/ pages
  new DocSource({
    name: "flyio",
    type: "http",
    url: "https://fly.io/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://fly.io/sitemap.xml",
    urlPattern: "fly\\.io/docs/.+",
  }),

  // ─── Tailwind CSS ──────────────────────────────────────────────────

  // MDX docs from the tailwindcss.com repo
  new DocSource({
    name: "tailwindcss",
    type: "git",
    url: "https://github.com/tailwindlabs/tailwindcss.com",
    format: "mdx",
    paths: ["src"],
    rootPath: "src",
  }),

  // ─── Rust ──────────────────────────────────────────────────────────

  // The Rust Programming Language book — markdown from the official repo
  new DocSource({
    name: "rust-book",
    type: "git",
    url: "https://github.com/rust-lang/book",
    format: "markdown",
    paths: ["src"],
    rootPath: "src",
  }),

  // ─── Erfi's Blogs ───────────────────────────────────────────────────

  // Technical blog — Astro Starlight site with MDX docs
  new DocSource({
    name: "erfi-technical-blog",
    type: "git",
    url: "https://github.com/erfianugrah/lexicanum",
    format: "mdx",
    paths: ["src/content/docs"],
    rootPath: "src/content/docs",
  }),

  // Personal blog — Astro photography & writing site with MDX content
  new DocSource({
    name: "erfi-personal-blog",
    type: "git",
    url: "https://github.com/erfianugrah/revista-3",
    format: "mdx",
    paths: ["src/content"],
    rootPath: "src/content",
  }),

  // ─── Docker ──────────────────────────────────────────────────────

  // Git sparse — Hugo source for docs.docker.com (1.2k+ md files)
  new DocSource({
    name: "docker",
    type: "git",
    url: "https://github.com/docker/docs",
    format: "markdown",
    paths: ["content"],
    rootPath: "content",
  }),

  // ─── Shadcn/UI ─────────────────────────────────────────────────

  // Git sparse — component docs are MDX in apps/v4/content
  new DocSource({
    name: "shadcn",
    type: "git",
    url: "https://github.com/shadcn-ui/ui",
    format: "mdx",
    paths: ["apps/v4/content"],
    rootPath: "apps/v4/content",
  }),

  // ─── Kubernetes ────────────────────────────────────────────────

  // Markdown docs from the official website repo
  new DocSource({
    name: "kubernetes",
    type: "git",
    url: "https://github.com/kubernetes/website",
    format: "markdown",
    paths: ["content/en/docs"],
    rootPath: "content/en/docs",
  }),

  // ─── Traefik ───────────────────────────────────────────────────

  // Markdown docs from the traefik repo
  new DocSource({
    name: "traefik",
    type: "git",
    url: "https://github.com/traefik/traefik",
    format: "markdown",
    paths: ["docs/content"],
    rootPath: "docs/content",
  }),

  // ─── Caddy ─────────────────────────────────────────────────────

  // Markdown docs from the caddyserver website repo
  new DocSource({
    name: "caddy",
    type: "git",
    url: "https://github.com/caddyserver/website",
    format: "markdown",
    paths: ["src/docs/markdown"],
    rootPath: "src/docs/markdown",
  }),

  // ─── Caddy cache-handler ─────────────────────────────────────────

  // caddyserver/cache-handler - the stable Caddy module build of Souin
  // (RFC-compliant distributed HTTP caching for Caddy). The repo's docs
  // are the root README (full Caddyfile/JSON configuration reference,
  // cache keys, invalidation, stale, storage backends) so no sparse
  // paths - walk the whole (tiny) clone.
  new DocSource({
    name: "caddy-cache-handler",
    type: "git",
    url: "https://github.com/caddyserver/cache-handler",
    format: "markdown",
  }),

  // ─── Souin ───────────────────────────────────────────────────────

  // Hugo docs content from the darkweak/souin repo - introduction,
  // quickstart, the full configuration reference, per-middleware pages
  // (Caddy, Traefik, Gin, Echo, Fiber, and other Go frameworks),
  // storage backends (Redis, Olric, Badger, Nuts, Etcd, NATS, Otter,
  // SimpleFS, ...), and use-case guides (WordPress-with-Caddy,
  // API Platform). The repo-root README is a monolith duplicate of the
  // same material, so the website content tree is the canonical set.
  new DocSource({
    name: "souin",
    type: "git",
    url: "https://github.com/darkweak/souin",
    format: "markdown",
    paths: ["docs/website/content"],
    rootPath: "docs/website/content",
  }),

  // ─── Varnish ───────────────────────────────────────────────────

  // Sitemap scrape of www.varnish.org (the Varnish Cache project site).
  // The upstream docs are Sphinx RST in varnishcache/varnish-cache (no
  // RST support), so the rendered Hugo site is the ingestion path.
  // Scoped to the doc sections: tutorials, users-guide, reference,
  // install-guide - excludes release notes and security advisories.
  new DocSource({
    name: "varnish",
    type: "http",
    url: "https://www.varnish.org/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://www.varnish.org/sitemap.xml",
    urlPattern: "www\\.varnish\\.org/docs/(tutorials|users-guide|reference|install-guide)/",
    urlExclude: "/tags/",
  }),

  // ─── Squid ───────────────────────────────────────────────────────

  // The Squid wiki (wiki.squid-cache.org) is a Jekyll site built from
  // this repo - 400+ markdown pages: Features, ConfigExamples,
  // KnowledgeBase, cache configuration and tuning.
  new DocSource({
    name: "squid",
    type: "git",
    url: "https://github.com/squid-cache/squid-cache.github.io",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── nginx ─────────────────────────────────────────────────────

  // Sitemap scrape of nginx.org/en/docs - module directive references
  // (ngx_http_proxy/fastcgi/uwsgi/scgi/memcached modules carry all the
  // cache directives), beginners guide, how-tos, admin topics.
  // NOTE: nginx.org's sitemap locs use the http:// scheme while the
  // site is https - urlToPath's same-host pathname fallback keeps
  // output paths clean; fetches land on https via 301 redirect.
  new DocSource({
    name: "nginx",
    type: "http",
    url: "https://nginx.org/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://nginx.org/sitemap.xml",
    urlPattern: "nginx\\.org/en/docs/.+",
  }),

  // ─── Apache Traffic Server ───────────────────────────────────────

  // ATS is a major caching proxy. Docs are Sphinx (no sitemap, no RST
  // support), and `toc` discovery is single-level, so an explicit list
  // of the caching-relevant admin-guide pages: cache basics, hierarchical
  // caching, storage, the cache.config/hosting.config/volume.config/
  // storage.config/records.yaml file references, and cache logging/stats.
  new DocSource({
    name: "apache-traffic-server",
    type: "http",
    url: "https://docs.trafficserver.apache.org/",
    format: "html",
    urls: [
      "https://docs.trafficserver.apache.org/admin-guide/configuration/cache-basics.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/configuration/hierarchical-caching.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/configuring-traffic-server.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/storage/index.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/files/cache.config.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/files/hosting.config.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/files/volume.config.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/files/storage.config.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/files/records.yaml.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/logging/cache-results.en.html",
      "https://docs.trafficserver.apache.org/admin-guide/monitoring/statistics/core/cache.en.html",
    ],
  }),

  // ─── HTTP caching RFCs ───────────────────────────────────────────

  // The authoritative HTTP caching specifications (rfc-editor HTML):
  // 9110 Semantics, 9111 Caching, 5861 stale-while-revalidate/
  // stale-if-error, 8246 immutable, 9211 Cache-Status, 9213 targeted
  // cache control.
  new DocSource({
    name: "http-caching-rfcs",
    type: "http",
    url: "https://www.rfc-editor.org/",
    format: "html",
    urls: [
      "https://www.rfc-editor.org/rfc/rfc9110.html",
      "https://www.rfc-editor.org/rfc/rfc9111.html",
      "https://www.rfc-editor.org/rfc/rfc5861.html",
      "https://www.rfc-editor.org/rfc/rfc8246.html",
      "https://www.rfc-editor.org/rfc/rfc9211.html",
      "https://www.rfc-editor.org/rfc/rfc9213.html",
    ],
  }),

  // ─── HTTP caching tutorial (mnot) ────────────────────────────────

  // Mark Nottingham's classic "Caching Tutorial for Web Authors and
  // Webmasters" (mnot is the HTTPbis co-chair). Single 50KB page.
  new DocSource({
    name: "http-caching-tutorial",
    type: "http",
    url: "https://www.mnot.net/cache_docs/",
    format: "html",
    urls: ["https://www.mnot.net/cache_docs/"],
  }),

  // ─── Neovim ────────────────────────────────────────────────────

  // HTML docs from sitemap — vimdoc format in git, HTML is cleaner
  new DocSource({
    name: "neovim",
    type: "http",
    url: "https://neovim.io/doc/user/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://neovim.io/sitemap.xml",
    urlPattern: "neovim\\.io/doc/user/.+",
  }),

  // ─── Starlight (Astro) ───────────────────────────────────────

  // MDX docs from the withastro/starlight repo (includes translations)
  new DocSource({
    name: "starlight",
    type: "git",
    url: "https://github.com/withastro/starlight",
    format: "mdx",
    paths: ["docs/src/content/docs"],
    rootPath: "docs/src/content/docs",
  }),

  // ─── Mermaid ───────────────────────────────────────────────────

  // Markdown docs from the mermaid monorepo
  new DocSource({
    name: "mermaid",
    type: "git",
    url: "https://github.com/mermaid-js/mermaid",
    format: "markdown",
    paths: ["packages/mermaid/src/docs"],
    rootPath: "packages/mermaid/src/docs",
  }),

  // ─── Quarto ─────────────────────────────────────────────────

  // llms.txt — Quarto publishing system docs (329 pages as text/markdown)
  new DocSource({
    name: "quarto",
    type: "http",
    url: "https://quarto.org/docs/",
    format: "markdown",
    discovery: "llms-txt",
    discoveryUrl: "https://quarto.org/llms.txt",
  }),

  // ─── Docs craft & technical writing ─────────────────────────────

  // The Diataxis documentation framework (tutorials / how-to / reference /
  // explanation). Sphinx on ReadTheDocs; the sitemap lists only the
  // homepage, so scrape the index TOC instead - the whole site is ~20
  // long-form pages, all linked from it. RTD honours markdown content
  // negotiation, so pages arrive preNormalised. /pl/ is the Polish
  // translation; genindex/search are Sphinx utility pages.
  new DocSource({
    name: "diataxis",
    type: "http",
    url: "https://diataxis.fr/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://diataxis.fr/",
    urlExclude: "diataxis\\.fr/(pl/|genindex|search)",
  }),

  // Write the Docs documentation guide. Sphinx/RTD like diataxis (markdown
  // via content negotiation), but the /guide/ index links only its section
  // pages, not the writing/* subpages, and the sitemap lists just the
  // homepage - so enumerate the (small, stable) page set explicitly.
  new DocSource({
    name: "writethedocs-guide",
    type: "http",
    url: "https://www.writethedocs.org/guide/",
    format: "html",
    urls: [
      "https://www.writethedocs.org/guide/",
      "https://www.writethedocs.org/guide/about/",
      "https://www.writethedocs.org/guide/about/alternatives/",
      "https://www.writethedocs.org/guide/about/community/",
      "https://www.writethedocs.org/guide/about/vision/",
      "https://www.writethedocs.org/guide/api/api-documentation-tools/",
      "https://www.writethedocs.org/guide/choosing-tools/",
      "https://www.writethedocs.org/guide/contributing/",
      "https://www.writethedocs.org/guide/doc-ops/",
      "https://www.writethedocs.org/guide/docs-as-code/",
      "https://www.writethedocs.org/guide/imposter/",
      "https://www.writethedocs.org/guide/seo/",
      "https://www.writethedocs.org/guide/starting/",
      "https://www.writethedocs.org/guide/tools/",
      "https://www.writethedocs.org/guide/tools/sphinx-community/",
      "https://www.writethedocs.org/guide/tools/sphinx-themes/",
      "https://www.writethedocs.org/guide/tools/sphinx/",
      "https://www.writethedocs.org/guide/tools/testing/",
      "https://www.writethedocs.org/guide/ux-writing/",
      "https://www.writethedocs.org/guide/writing/accessibility/",
      "https://www.writethedocs.org/guide/writing/asciidoc/",
      "https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/",
      "https://www.writethedocs.org/guide/writing/docs-principles/",
      "https://www.writethedocs.org/guide/writing/markdown/",
      "https://www.writethedocs.org/guide/writing/mindshare/",
      "https://www.writethedocs.org/guide/writing/reStructuredText/",
      "https://www.writethedocs.org/guide/writing/reducing-bias/",
      "https://www.writethedocs.org/guide/writing/style-guides/",
      "https://www.writethedocs.org/guide/writing/support-team/",
      "https://www.writethedocs.org/guide/writing/xml/",
    ],
  }),

  // I'd Rather Be Writing - Tom Johnson's tech-writing site. The llms.txt
  // indexes ~345 pages: the book-length API documentation course
  // (learnapidoc, 186 pages), the AI courses, and selected blog posts.
  // Jekyll .html pages (no markdown negotiation) -> Turndown.
  new DocSource({
    name: "idratherbewriting",
    type: "http",
    url: "https://idratherbewriting.com/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://idratherbewriting.com/llms.txt",
  }),

  // Microsoft Writing Style Guide - the source repo behind
  // learn.microsoft.com/style-guide (~950 markdown files under styleguide/).
  new DocSource({
    name: "microsoft-style-guide",
    type: "git",
    url: "https://github.com/MicrosoftDocs/microsoft-style-guide",
    format: "markdown",
    paths: ["styleguide"],
    rootPath: "styleguide",
  }),

  // ─── Bun ───────────────────────────────────────────────────────

  // llms.txt — comprehensive docs with .md URLs
  new DocSource({
    name: "bun",
    type: "http",
    url: "https://bun.sh/docs/",
    format: "markdown",
    discovery: "llms-txt",
    discoveryUrl: "https://bun.sh/llms.txt",
  }),

  // ─── React ─────────────────────────────────────────────────────

  // llms.txt — complete React docs with .md URLs
  new DocSource({
    name: "react",
    type: "http",
    url: "https://react.dev/",
    format: "markdown",
    discovery: "llms-txt",
    discoveryUrl: "https://react.dev/llms.txt",
  }),

  // ─── Hono ──────────────────────────────────────────────────────

  // Git sparse — VitePress source for hono.dev (84 md files)
  new DocSource({
    name: "hono",
    type: "git",
    url: "https://github.com/honojs/website",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Zod ───────────────────────────────────────────────────────

  // llms.txt — TypeScript schema validation
  new DocSource({
    name: "zod",
    type: "http",
    url: "https://zod.dev/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://zod.dev/llms.txt",
  }),

  // ─── Drizzle ORM ──────────────────────────────────────────────

  // Git sparse — Astro Starlight source (247 mdx files)
  new DocSource({
    name: "drizzle",
    type: "git",
    url: "https://github.com/drizzle-team/drizzle-orm-docs",
    format: "mdx",
    paths: ["src/content/docs"],
    rootPath: "src/content/docs",
  }),

  // ─── TypeScript ────────────────────────────────────────────────

  // Handbook and reference from the TypeScript-Website repo
  new DocSource({
    name: "typescript",
    type: "git",
    url: "https://github.com/microsoft/TypeScript-Website",
    format: "markdown",
    paths: ["packages/documentation"],
    rootPath: "packages/documentation",
  }),

  // ─── K3s ───────────────────────────────────────────────────────

  // Git sparse — Docusaurus source for docs.k3s.io (68 md files)
  new DocSource({
    name: "k3s",
    type: "git",
    url: "https://github.com/k3s-io/docs",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Python ────────────────────────────────────────────────────

  // TOC-based discovery from the Python docs contents page
  new DocSource({
    name: "python",
    type: "http",
    url: "https://docs.python.org/3/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://docs.python.org/3/contents.html",
    urlPattern: "docs\\.python\\.org/3/(tutorial|library|reference|howto|faq)/",
    urlExclude: "(genindex|modindex|copyright|license|bugs|about)",
  }),

  // ─── Ansible ───────────────────────────────────────────────────

  // TOC-based — core Ansible docs from the index page
  new DocSource({
    name: "ansible",
    type: "http",
    url: "https://docs.ansible.com/projects/ansible/latest/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://docs.ansible.com/projects/ansible/latest/index.html",
    urlPattern: "docs\\.ansible\\.com/projects/ansible/latest/(getting_started|installation_guide|inventory_guide|command_guide|playbook_guide|vault_guide|module_plugin_guide|collections_guide|os_guide|tips_tricks|dev_guide|network|galaxy|reference_appendices)",
    urlExclude: "(porting_guides|roadmap|community|scenario_guides|collections/index|all_plugins)",
  }),

  // ─── OpenAPI Specs ──────────────────────────────────────────────

  // Cloudflare API — OpenAPI 3.x, monolithic JSON (>5MB)
  new DocSource({
    name: "cloudflare-api",
    type: "http",
    url: "https://developers.cloudflare.com/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json",
  }),

  // Docker Engine API — Swagger 2.0, YAML
  new DocSource({
    name: "docker-api",
    type: "http",
    url: "https://docs.docker.com/reference/api/engine/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/moby/moby/master/api/swagger.yaml",
  }),

  // Kubernetes API — Swagger 2.0, JSON (~4MB)
  new DocSource({
    name: "kubernetes-api",
    type: "http",
    url: "https://kubernetes.io/docs/reference/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/kubernetes/kubernetes/master/api/openapi-spec/swagger.json",
  }),

  // Supabase Management API — OpenAPI 3.0, JSON
  new DocSource({
    name: "supabase-api",
    type: "http",
    url: "https://supabase.com/docs/reference/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/spec/api_v1_openapi.json",
  }),

  // Supabase Auth API — OpenAPI 3.0, YAML
  new DocSource({
    name: "supabase-auth-api",
    type: "http",
    url: "https://supabase.com/docs/reference/auth/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/supabase/auth/master/openapi.yaml",
  }),

  // Fly.io Machines API — Swagger 2.0, JSON
  new DocSource({
    name: "flyio-api",
    type: "http",
    url: "https://docs.machines.dev/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://docs.machines.dev/swagger/doc.json",
  }),

  // ─── MDN Web Docs ───────────────────────────────────────────────

  // Markdown docs from the mdn/content repo (English only)
  new DocSource({
    name: "mdn",
    type: "git",
    url: "https://github.com/mdn/content",
    format: "markdown",
    paths: ["files/en-us"],
    rootPath: "files/en-us",
  }),

  // ─── Gitea ───────────────────────────────────────────────────────

  // Git sparse — Hugo source for docs.gitea.com (56 md files)
  new DocSource({
    name: "gitea",
    type: "git",
    url: "https://github.com/go-gitea/docs",
    format: "markdown",
    paths: ["content"],
    rootPath: "content",
  }),

  // ─── Forgejo ────────────────────────────────────────────────────

  // Git sparse - Docusaurus source for forgejo.org/docs (Codeberg,
  // default branch `next`; 138 md files under docs/: user/, admin/,
  // contributor/). The gitea source covers the fork's shared heritage;
  // this carries Forgejo-specific surface (forgejo-cli, federation,
  // release notes).
  new DocSource({
    name: "forgejo",
    type: "git",
    url: "https://codeberg.org/forgejo/docs",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Authentik ─────────────────────────────────────────────────

  // MDX/MD docs from the goauthentik monorepo
  new DocSource({
    name: "authentik",
    type: "git",
    url: "https://github.com/goauthentik/authentik",
    format: "mdx",
    paths: ["website/docs"],
    rootPath: "website/docs",
  }),

  // ─── Keycloak ──────────────────────────────────────────────────

  // Sitemap — OIDC/SAML IdP guides (server, HA, securing apps, etc.)
  new DocSource({
    name: "keycloak",
    type: "http",
    url: "https://www.keycloak.org/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://www.keycloak.org/sitemap.xml",
    urlPattern:
      "keycloak\\.org/(server|getting-started|high-availability|securing-apps|operator|observability|ui-customization|migration)/",
  }),

  // ─── Better Auth ───────────────────────────────────────────────

  // Framework-agnostic TypeScript auth library. Fumadocs MDX content in-repo.
  new DocSource({
    name: "better-auth",
    type: "git",
    url: "https://github.com/better-auth/better-auth",
    format: "mdx",
    paths: ["docs/content/docs"],
    rootPath: "docs/content/docs",
  }),

  // ─── Clerk ─────────────────────────────────────────────────────

  // Auth / user-management platform. MDX docs in clerk/clerk-docs under docs/
  // (the separate clerk-typedoc/ tree is excluded by the sparse path).
  new DocSource({
    name: "clerk",
    type: "git",
    url: "https://github.com/clerk/clerk-docs",
    format: "mdx",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── OpenID Connect ───────────────────────────────────────────

  // OIDC spec pages — direct URLs (sitemap unreliable, CDATA parse errors)
  new DocSource({
    name: "openid",
    type: "http",
    url: "https://openid.net/",
    format: "html",
    urls: [
      "https://openid.net/specs/openid-connect-core-1_0.html",
      "https://openid.net/specs/openid-connect-discovery-1_0.html",
      "https://openid.net/specs/openid-connect-registration-1_0.html",
      "https://openid.net/specs/openid-connect-rpinitiated-1_0.html",
      "https://openid.net/specs/openid-connect-frontchannel-1_0.html",
      "https://openid.net/specs/openid-connect-backchannel-1_0.html",
      "https://openid.net/specs/oauth-v2-multiple-response-types-1_0.html",
      "https://openid.net/specs/oauth-v2-form-post-response-mode-1_0.html",
      "https://openid.net/specs/openid-connect-session-1_0.html",
      "https://openid.net/specs/openid-federation-1_0.html",
    ],
  }),

  // ─── SAML 2.0 ─────────────────────────────────────────────────

  // OASIS SAML 2.0 specs — technical overview + core documents
  new DocSource({
    name: "saml",
    type: "http",
    url: "https://docs.oasis-open.org/",
    format: "html",
    urls: [
      "https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html",
      "https://docs.oasis-open.org/security/saml/v2.0/sstc-saml-approved-errata-2.0.html",
    ],
  }),

  // ─── Terraform ─────────────────────────────────────────────────

  // MDX docs from the hashicorp/web-unified-docs repo (all versions)
  new DocSource({
    name: "terraform",
    type: "git",
    url: "https://github.com/hashicorp/web-unified-docs",
    format: "mdx",
    paths: ["content/terraform"],
    rootPath: "content/terraform",
  }),

  // ─── OpenAPI Specs (continued) ─────────────────────────────────

  // Gitea API — Swagger 2.0, JSON (live spec from gitea.com)
  new DocSource({
    name: "gitea-api",
    type: "http",
    url: "https://docs.gitea.com/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://gitea.com/swagger.v1.json",
  }),

  // Authentik API — OpenAPI 3.0, YAML
  new DocSource({
    name: "authentik-api",
    type: "http",
    url: "https://docs.goauthentik.io/developer-docs/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl:
      "https://raw.githubusercontent.com/goauthentik/authentik/main/schema.yml",
  }),

  // Keycloak Admin REST API — OpenAPI 3.0, YAML
  new DocSource({
    name: "keycloak-api",
    type: "http",
    url: "https://www.keycloak.org/docs-api/latest/rest-api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl:
      "https://www.keycloak.org/docs-api/latest/rest-api/openapi.yaml",
  }),

  // Stripe API - OpenAPI 3.0, JSON (~7.5MB, ~414 paths, zero tags).
  // The spec carries no operation tags, so grouping falls back to the
  // path-derived resource name (see groupFromPath in
  // openapi-converter.ts) - /v1/charges/{id} lands in api/charges.md.
  new DocSource({
    name: "stripe-api",
    type: "http",
    url: "https://docs.stripe.com/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl:
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
  }),

  // ─── Zsh ────────────────────────────────────────────────────────

  // TOC-based discovery — full manual as browsable HTML chapters
  new DocSource({
    name: "zsh",
    type: "http",
    url: "https://zsh.sourceforge.io/Doc/Release/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://zsh.sourceforge.io/Doc/Release/zsh_toc.html",
    urlPattern: "zsh\\.sourceforge\\.io/Doc/Release/",
    urlExclude:
      "(Concept-Index|Variables-Index|Options-Index|Functions-Index|Editor-Functions-Index|Style-and-Tag-Index|zsh_toc)\\.html",
  }),

  // ─── Oh My Zsh ────────────────────────────────────────────────

  // Public wiki repo — curated docs (FAQ, plugins overview, themes, etc.)
  new DocSource({
    name: "ohmyzsh",
    type: "git",
    url: "https://github.com/ohmyzsh/wiki",
    format: "markdown",
  }),

  // ─── Zinit ─────────────────────────────────────────────────────

  // Docusaurus wiki — guides, syntax, annexes, ecosystem plugins
  new DocSource({
    name: "zinit",
    type: "git",
    url: "https://github.com/z-shell/wiki",
    format: "mdx",
    paths: ["docs", "ecosystem", "community"],
  }),

  // ─── Powerlevel10k ─────────────────────────────────────────────

  // Markdown docs from the romkatv/powerlevel10k repo
  new DocSource({
    name: "powerlevel10k",
    type: "git",
    url: "https://github.com/romkatv/powerlevel10k",
    format: "markdown",
  }),

  // ─── WezTerm ───────────────────────────────────────────────────

  // Markdown docs from the wezterm/wezterm repo (634 files)
  new DocSource({
    name: "wezterm",
    type: "git",
    url: "https://github.com/wezterm/wezterm",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── SOPS ──────────────────────────────────────────────────────

  // Sitemap — secrets management tool docs (comprehensive single-page)
  new DocSource({
    name: "sops",
    type: "http",
    url: "https://getsops.io/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://getsops.io/sitemap.xml",
    urlPattern: "getsops\\.io/docs/",
  }),

  // ─── age ───────────────────────────────────────────────────────

  // Markdown docs from the FiloSottile/age repo (README + spec)
  new DocSource({
    name: "age",
    type: "git",
    url: "https://github.com/FiloSottile/age",
    format: "markdown",
  }),

  // ─── Vault ───────────────────────────────────────────────────────

  // HashiCorp Vault. Docs moved out of hashicorp/vault into the
  // web-unified-docs monorepo, which carries every released version side
  // by side - pin to the current v2.x tree (docs + API reference) instead
  // of mirroring ~20 version dirs of near-duplicate content.
  new DocSource({
    name: "vault",
    type: "git",
    url: "https://github.com/hashicorp/web-unified-docs",
    format: "mdx",
    paths: [
      "content/vault/v2.x/content/docs",
      "content/vault/v2.x/content/api-docs",
    ],
    rootPath: "content/vault/v2.x/content",
  }),

  // ─── OpenBao ─────────────────────────────────────────────────────

  // Open-source Vault fork (LF Edge). Classic pre-migration HashiCorp
  // site layout inside the main repo; MDX docs, no separate api-docs dir.
  new DocSource({
    name: "openbao",
    type: "git",
    url: "https://github.com/openbao/openbao",
    format: "mdx",
    paths: ["website/content/docs"],
    rootPath: "website/content/docs",
  }),

  // ─── Infisical ───────────────────────────────────────────────────

  // Mintlify docs from the main monorepo (platform, CLI, SDKs,
  // integrations, self-hosting, API reference). paths enumerates the
  // content dirs to skip the docs/snippets partials (13 .mdx fragments
  // that are transcluded into pages, not pages themselves) and static
  // assets.
  new DocSource({
    name: "infisical",
    type: "git",
    url: "https://github.com/Infisical/infisical",
    format: "mdx",
    paths: [
      "docs/documentation",
      "docs/cli",
      "docs/integrations",
      "docs/self-hosting",
      "docs/api-reference",
      "docs/sdks",
      "docs/internals",
      "docs/changelog",
    ],
    rootPath: "docs",
  }),

  // ─── tmux ──────────────────────────────────────────────────────

  // GitHub wiki - curated guides (getting started, advanced use, FAQ, etc.)
  new DocSource({
    name: "tmux",
    type: "git",
    url: "https://github.com/tmux/tmux.wiki",
    format: "markdown",
  }),

  // ─── OpenCode ────────────────────────────────────────────────────

  // Git sparse — Astro Starlight source (630 mdx files)
  new DocSource({
    name: "opencode",
    type: "git",
    url: "https://github.com/sst/opencode",
    format: "mdx",
    paths: ["packages/web/src/content/docs"],
    rootPath: "packages/web/src/content/docs",
  }),

  // ─── Pi (Earendil) ──────────────────────────────────────────────

  // Git sparse — earendil-works/pi monorepo. Site `pi.dev/docs/latest`
  // maps 1:1 to packages/coding-agent/docs/*.md; packages/agent/docs/
  // covers the underlying harness internals (hooks, durable runs,
  // observability). No llms.txt / sitemap; markdown straight from
  // source.
  new DocSource({
    name: "pi",
    type: "git",
    url: "https://github.com/earendil-works/pi",
    format: "markdown",
    paths: ["packages/coding-agent/docs", "packages/agent/docs"],
  }),

  // ─── Vitest ────────────────────────────────────────────────────

  // llms-full.txt — complete testing framework docs (~1.1MB)
  new DocSource({
    name: "vitest",
    type: "http",
    url: "https://vitest.dev/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://vitest.dev/llms-full.txt",
  }),

  // ─── Vite ──────────────────────────────────────────────────────

  // llms-full.txt — build tool docs (~350KB)
  new DocSource({
    name: "vite",
    type: "http",
    url: "https://vitejs.dev/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://vitejs.dev/llms-full.txt",
  }),

  // ─── Turborepo ─────────────────────────────────────────────────

  // Sitemap — monorepo build system (moved to turborepo.dev)
  new DocSource({
    name: "turborepo",
    type: "http",
    url: "https://turborepo.dev/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://turborepo.dev/sitemap.xml",
    urlPattern: "turborepo\\.dev/docs/",
  }),

  // ─── Deno ──────────────────────────────────────────────────────

  // llms-full.txt — complete runtime docs (~2MB)
  new DocSource({
    name: "deno",
    type: "http",
    url: "https://docs.deno.com/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://docs.deno.com/llms-full.txt",
  }),

  // ─── Svelte / SvelteKit ────────────────────────────────────────

  // llms-full.txt — both Svelte + SvelteKit in one dump (~1MB)
  new DocSource({
    name: "svelte",
    type: "http",
    url: "https://svelte.dev/docs/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://svelte.dev/llms-full.txt",
  }),

  // ─── TanStack ──────────────────────────────────────────────────

  // Git sparse — TanStack Query (React/Vue/Solid/Angular data fetching, 438 files)
  new DocSource({
    name: "tanstack-query",
    type: "git",
    url: "https://github.com/TanStack/query",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // Git sparse — TanStack Router + Start (type-safe routing + SSR, 237 files)
  new DocSource({
    name: "tanstack-router",
    type: "git",
    url: "https://github.com/TanStack/router",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // Git sparse — TanStack Table (headless table/grid, 75 files)
  new DocSource({
    name: "tanstack-table",
    type: "git",
    url: "https://github.com/TanStack/table",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // Git sparse — TanStack Form (type-safe forms, 213 files)
  new DocSource({
    name: "tanstack-form",
    type: "git",
    url: "https://github.com/TanStack/form",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Prettier ──────────────────────────────────────────────────

  // Git sparse — code formatter docs (24 md files in main repo)
  new DocSource({
    name: "prettier",
    type: "git",
    url: "https://github.com/prettier/prettier",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── ESLint ────────────────────────────────────────────────────

  // Git sparse — rules, config, extension, integration docs (408 files)
  new DocSource({
    name: "eslint",
    type: "git",
    url: "https://github.com/eslint/eslint",
    format: "markdown",
    paths: ["docs/src/rules", "docs/src/use", "docs/src/extend", "docs/src/integrate"],
    rootPath: "docs/src",
  }),

  // ─── SQLite ────────────────────────────────────────────────────

  // TOC-based — all docs from the table of contents page
  new DocSource({
    name: "sqlite",
    type: "http",
    url: "https://www.sqlite.org/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://www.sqlite.org/docs.html",
    urlPattern: "sqlite\\.org/",
    urlExclude: "(chronology|changes|session|capi3ref|c3ref|src/|docsrc/|download)",
  }),

  // ─── Prometheus ────────────────────────────────────────────────

  // Sitemap — monitoring system docs (filter to /docs/)
  // Git sparse — monitoring system. Site is Next.js (HTML retention
  // was 26/173); the docs/ tree in the docs repo is canonical markdown.
  new DocSource({
    name: "prometheus",
    type: "git",
    url: "https://github.com/prometheus/docs",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── OpenTelemetry ─────────────────────────────────────────────

  // Git sparse — Hugo source for opentelemetry.io (English docs only,
  // 406 md files)
  new DocSource({
    name: "opentelemetry",
    type: "git",
    url: "https://github.com/open-telemetry/opentelemetry.io",
    format: "markdown",
    paths: ["content/en/docs"],
    rootPath: "content/en/docs",
  }),

  // ─── Rspack ────────────────────────────────────────────────────

  // llms.txt — Rust-based bundler (~100 entries)
  new DocSource({
    name: "rspack",
    type: "http",
    url: "https://rspack.dev/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://rspack.dev/llms.txt",
    urlExclude: "/blog/",
  }),

  // ─── Effect ────────────────────────────────────────────────────

  // Effect - TypeScript effect system (concurrency, streams, schema).
  // Was http+llms-txt via effect.website/llms.txt until upstream dropped
  // it (the apex now 308s to www, which 404s). The docs are Starlight MDX
  // in the Effect-TS/website repo - fetch from git instead.
  new DocSource({
    name: "effect",
    type: "git",
    url: "https://github.com/Effect-TS/website",
    format: "mdx",
    paths: ["apps/web/src/content/docs/v3"],
    rootPath: "apps/web/src/content/docs/v3",
  }),

  // ─── Argo CD ───────────────────────────────────────────────────

  // Sitemap — GitOps CD for Kubernetes (~180 pages)
  // Git sparse — GitOps CD for Kubernetes. ReadTheDocs renders from
  // the docs/ tree of the main repo; pull from source instead.
  new DocSource({
    name: "argocd",
    type: "git",
    url: "https://github.com/argoproj/argo-cd",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Helm ──────────────────────────────────────────────────────

  // Git sparse — Kubernetes package manager (sitemap times out)
  new DocSource({
    name: "helm",
    type: "git",
    url: "https://github.com/helm/helm-www",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── mise ──────────────────────────────────────────────────────

  // Git sparse — polyglot dev tool manager. Live site is JS-rendered
  // (live audit produced ~0 usable markdown via sitemap+Turndown);
  // canonical docs in repo are clean VitePress markdown.
  new DocSource({
    name: "mise",
    type: "git",
    url: "https://github.com/jdx/mise",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── D2 ────────────────────────────────────────────────────────

  // Git sparse — diagramming language. Docs live in a separate repo
  // (terrastruct/d2-docs); main repo has none. Sitemap+Turndown of
  // d2lang.com produced low-quality output.
  new DocSource({
    name: "d2",
    type: "git",
    url: "https://github.com/terrastruct/d2-docs",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Grafana ───────────────────────────────────────────────────

  // Git sparse — observability platform. Live site is fully JS-rendered;
  // sitemap+Turndown produced 0 usable markdown across 708 pages
  // (HtmlNormaliser safety net retained the HTML, leaving them
  // unindexed). Canonical docs are Hugo markdown in the main repo.
  new DocSource({
    name: "grafana",
    type: "git",
    url: "https://github.com/grafana/grafana",
    format: "markdown",
    paths: ["docs/sources"],
    rootPath: "docs/sources",
  }),

  // ─── Grafana LGTM+ stack ───────────────────────────────────────
  // The rest of the Grafana Labs product line. The core `grafana`
  // source only covers these as *datasources configured inside
  // Grafana*; these pull the first-class product docs. All use the
  // same Hugo `docs/sources` layout as core Grafana, one version per
  // branch - except k6-docs, which bundles every released version in
  // one branch (v0.47.x ... + next), so we pull `next` (always-current
  // tip) to avoid mirroring N stale copies.

  // Git sparse - log aggregation (LogQL, operations, deployment).
  new DocSource({
    name: "loki",
    type: "git",
    url: "https://github.com/grafana/loki",
    format: "markdown",
    paths: ["docs/sources"],
    rootPath: "docs/sources",
  }),

  // Git sparse - distributed tracing backend (TraceQL, operations).
  new DocSource({
    name: "tempo",
    type: "git",
    url: "https://github.com/grafana/tempo",
    format: "markdown",
    paths: ["docs/sources"],
    rootPath: "docs/sources",
  }),

  // Git sparse - horizontally scalable Prometheus (long-term metrics).
  new DocSource({
    name: "mimir",
    type: "git",
    url: "https://github.com/grafana/mimir",
    format: "markdown",
    paths: ["docs/sources"],
    rootPath: "docs/sources",
  }),

  // Git sparse - continuous profiling backend.
  new DocSource({
    name: "pyroscope",
    type: "git",
    url: "https://github.com/grafana/pyroscope",
    format: "markdown",
    paths: ["docs/sources"],
    rootPath: "docs/sources",
  }),

  // Git sparse - OpenTelemetry Collector distribution (telemetry agent).
  new DocSource({
    name: "alloy",
    type: "git",
    url: "https://github.com/grafana/alloy",
    format: "markdown",
    paths: ["docs/sources"],
    rootPath: "docs/sources",
  }),

  // Git sparse - eBPF auto-instrumentation (zero-code observability).
  new DocSource({
    name: "beyla",
    type: "git",
    url: "https://github.com/grafana/beyla",
    format: "markdown",
    paths: ["docs/sources"],
    rootPath: "docs/sources",
  }),

  // Git sparse - load testing (JavaScript API, scenarios, extensions).
  // k6-docs bundles all versions in one branch; pull `next` only.
  new DocSource({
    name: "k6",
    type: "git",
    url: "https://github.com/grafana/k6-docs",
    format: "markdown",
    paths: ["docs/sources/k6/next"],
    rootPath: "docs/sources/k6/next",
  }),

  // Git sparse - on-call management. Upstream default branch is `dev`
  // (not main); the ingestor clones default HEAD so this resolves
  // automatically.
  new DocSource({
    name: "oncall",
    type: "git",
    url: "https://github.com/grafana/oncall",
    format: "markdown",
    paths: ["docs/sources"],
    rootPath: "docs/sources",
  }),

  // Git sparse - frontend observability web SDK (Faro).
  new DocSource({
    name: "faro",
    type: "git",
    url: "https://github.com/grafana/faro-web-sdk",
    format: "markdown",
    paths: ["docs/sources"],
    rootPath: "docs/sources",
  }),

  // ─── pnpm ──────────────────────────────────────────────────────

  // Git sparse — Docusaurus source for pnpm.io (111 md + 9 mdx files)
  new DocSource({
    name: "pnpm",
    type: "git",
    url: "https://github.com/pnpm/pnpm.io",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── npm ───────────────────────────────────────────────────────

  // Git sparse — markdown content from npm/cli (commands, configuring-npm, using-npm)
  new DocSource({
    name: "npm",
    type: "git",
    url: "https://github.com/npm/cli",
    format: "markdown",
    paths: ["docs/lib/content"],
    rootPath: "docs/lib/content",
  }),

  // ─── Resend ────────────────────────────────────────────────────

  // llms.txt — email API for developers (~200 entries)
  new DocSource({
    name: "resend",
    type: "http",
    url: "https://resend.com/docs/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://resend.com/docs/llms.txt",
  }),

  // ----- Stripe -----------------------------------------------------

  // llms.txt - ~470 guides. Index links point directly at .md URLs
  // served as text/plain, so content negotiation never fires; declared
  // format "markdown" skips the HTML pass-1 converter and the pages
  // land as-is (same shape as git-sourced markdown). urlPattern drops
  // the dashboard/support/stripe.com links the index also lists.
  new DocSource({
    name: "stripe",
    type: "http",
    url: "https://docs.stripe.com/",
    format: "markdown",
    discovery: "llms-txt",
    discoveryUrl: "https://docs.stripe.com/llms.txt",
    urlPattern: "docs\\.stripe\\.com/.+\\.md",
  }),

  // ─── Let's Encrypt ─────────────────────────────────────────────

  // Sitemap-index — TLS CA docs (English sub-sitemap)
  // Git sparse — TLS CA. Site is Hugo with extensive l10n; pull just
  // English content from source.
  new DocSource({
    name: "letsencrypt",
    type: "git",
    url: "https://github.com/letsencrypt/website",
    format: "markdown",
    paths: ["content/en"],
    rootPath: "content/en",
  }),

  // ─── rclone ────────────────────────────────────────────────────

  // Git sparse — Hugo source for rclone.org (190 md files)
  new DocSource({
    name: "rclone",
    type: "git",
    url: "https://github.com/rclone/rclone",
    format: "markdown",
    paths: ["docs/content"],
    rootPath: "docs/content",
  }),

  // ─── Redis ─────────────────────────────────────────────────────

  // Sitemap — in-memory data store (docs-only sitemap, not marketing)
  // Git sparse — in-memory data store. Site is Hugo over Tailwind;
  // canonical content/ in repo is clean markdown.
  new DocSource({
    name: "redis",
    type: "git",
    url: "https://github.com/redis/docs",
    format: "markdown",
    paths: ["content"],
    rootPath: "content",
  }),

  // ─── GitLab ────────────────────────────────────────────────────

  // Sitemap-index — DevSecOps platform docs (English sub-sitemap)
  // URLs at docs.gitlab.com/{section}/ (no /ee/ prefix since 2025 restructure)
  new DocSource({
    name: "gitlab",
    type: "http",
    url: "https://docs.gitlab.com/",
    format: "html",
    discovery: "sitemap-index",
    discoveryUrl: "https://docs.gitlab.com/sitemap.xml",
    urlPattern: "docs\\.gitlab\\.com/",
    urlExclude: "(docs\\.gitlab\\.com/(ja-jp|releases)/)",
  }),

  // ─── GitHub Docs ───────────────────────────────────────────────

  // Git sparse clone — markdown content from the github/docs repo
  new DocSource({
    name: "github",
    type: "git",
    url: "https://github.com/github/docs",
    format: "markdown",
    paths: ["content"],
    rootPath: "content",
  }),

  // ─── Playwright ────────────────────────────────────────────────

  // Git sparse — Microsoft's Playwright docs source (178 md files)
  new DocSource({
    name: "playwright",
    type: "git",
    url: "https://github.com/microsoft/playwright",
    format: "markdown",
    paths: ["docs/src"],
    rootPath: "docs/src",
  }),

  // ─── FastAPI ───────────────────────────────────────────────────

  // Git sparse — MkDocs source for fastapi.tiangolo.com (English docs
  // only, 153 md files)
  new DocSource({
    name: "fastapi",
    type: "git",
    url: "https://github.com/fastapi/fastapi",
    format: "markdown",
    paths: ["docs/en"],
    rootPath: "docs/en",
  }),

  // ─── Go ────────────────────────────────────────────────────────

  // Git sparse — go.dev's Hugo source (90 md files in _content/doc).
  new DocSource({
    name: "go",
    type: "git",
    url: "https://github.com/golang/website",
    format: "markdown",
    paths: ["_content/doc"],
    rootPath: "_content/doc",
  }),

  // ─── WireGuard ─────────────────────────────────────────────────

  // Sitemap — fast VPN tunnel docs (~18 pages, dense content)
  new DocSource({
    name: "wireguard",
    type: "http",
    url: "https://www.wireguard.com/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://www.wireguard.com/sitemap.xml",
  }),

  // strongSwan IPsec VPN - Sphinx HTML (the git repo ships reST, which
  // the pipeline can't convert), clean sitemap scoped to /docs/latest/.
  new DocSource({
    name: "strongswan",
    type: "http",
    url: "https://docs.strongswan.org/docs/latest/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://docs.strongswan.org/sitemap.xml",
    urlPattern: "^https://docs\\.strongswan\\.org/docs/latest/",
    urlExclude: "(genindex|search)\\.html",
  }),

  // OpenVPN community docs - static HTML with its own scoped sitemap
  // (54 pages). Access Server docs live behind a JS portal and are not
  // fetchable. The openvpn.net WAF 503s any request carrying
  // `Accept: text/markdown` (200 without it), so negotiation is off.
  new DocSource({
    name: "openvpn",
    type: "http",
    url: "https://openvpn.net/community-docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://openvpn.net/community-docs/sitemap.xml",
    urlPattern: "^https://openvpn\\.net/community-docs/",
    skipMarkdownNegotiation: true,
  }),

  // ─── Router firmware ─────────────────────────────────────────────

  // OpenWrt Wiki - DokuWiki with clean URLs. No XML sitemap and no git
  // mirror, so we BFS the `?do=index` namespace tree (dokuwiki
  // discovery). The wiki carries ~20 translation namespaces (top-level
  // lang codes) plus DokuWiki boilerplate (playground/talk/user) - all
  // excluded, which also prunes those subtrees from the crawl. Also
  // excluded: `packages` (27.5k auto-generated one-page-per-package
  // stubs - 97% of the raw crawl), `dataentry`/`tag` (auto-generated
  // device-data forms / tag indexes). What remains is the real doc
  // corpus: docs/faq/developers/releases + the `toh` Table of Hardware
  // subtree (one vendor namespace each, hence the raised crawl cap in
  // dokuwiki.ts). Verified: idx pages are server-rendered.
  new DocSource({
    name: "openwrt",
    type: "http",
    url: "https://openwrt.org/",
    format: "html",
    discovery: "dokuwiki",
    discoveryUrl: "https://openwrt.org/start?do=index",
    urlPattern: "^https://openwrt\\.org/",
    urlExclude:
      "openwrt\\.org/(ar|cs|de|es|fr|ga|hu|it|ja|jp|ko|pl|pt|pt-br|ru|tr|uk|zh|zh-cn|zh-tw|playground|talk|user|packages|dataentry|tag)/",
    pageConcurrency: 6,
    deadlineMs: 1_800_000,
  }),

  // DD-WRT Wiki - MediaWiki at wiki.dd-wrt.com (API under /wiki/,
  // articlepath /wiki/$1). The wiki is spam-infested, but the spam
  // pages all have "("-prefixed titles (sorts first in allpages;
  // verified 10/1048 pages) and encodeURIComponent leaves parens
  // unescaped, so the `wiki/\(` arm drops them. The %D[01] arm drops
  // Cyrillic-titled translation pages (UTF-8 Cyrillic encodes to
  // %D0/%D1 xx); their 9-bytes-per-char filenames also blow the 255-byte
  // filesystem filename cap (urlToPath now hash-truncates those, but
  // translated dupes are noise anyway).
  new DocSource({
    name: "ddwrt",
    type: "http",
    url: "https://wiki.dd-wrt.com/wiki/",
    format: "html",
    discovery: "mediawiki",
    discoveryUrl: "https://wiki.dd-wrt.com/wiki/api.php",
    urlPattern: "wiki\\.dd-wrt\\.com/wiki/",
    urlExclude:
      "(Special:|Talk:|User:|File:|Template:|Category:|Help:|MediaWiki:|wiki/\\(|%D[01][0-9A-F])",
    pageConcurrency: 6, // 15-wide burst trips ~14% connection failures on this shared host
  }),

  // FreshTomato Wiki - DokuWiki with doku.php PATH_INFO URLs. Original
  // Tomato docs (polarcloud.com) are dead; FreshTomato is the
  // maintained fork. Index tree is nearly flat (4 namespaces); drop
  // DokuWiki boilerplate namespaces.
  new DocSource({
    name: "freshtomato",
    type: "http",
    url: "https://wiki.freshtomato.org/doku.php/",
    format: "html",
    discovery: "dokuwiki",
    discoveryUrl: "https://wiki.freshtomato.org/doku.php?do=index",
    urlPattern: "wiki\\.freshtomato\\.org/doku\\.php/",
    urlExclude: "doku\\.php/(playground|wiki)/",
  }),

  // Turris user docs - CZ.NIC's OpenWrt-based router line (Omnia, MOX).
  // MkDocs markdown straight from the GitLab repo.
  new DocSource({
    name: "turris",
    type: "git",
    url: "https://gitlab.nic.cz/turris/user-docs",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // Asuswrt-Merlin firmware docs - the GitHub wiki is a plain git repo
  // of flat markdown files (clone with the .wiki suffix).
  new DocSource({
    name: "asuswrt-merlin",
    type: "git",
    url: "https://github.com/RMerl/asuswrt-merlin.ng.wiki",
    format: "markdown",
  }),

  // pfSense (Netgate) docs - Sphinx HTML, scoped sitemap (~996 pages:
  // manual, recipes, troubleshooting, release notes). No public git repo.
  new DocSource({
    name: "pfsense",
    type: "http",
    url: "https://docs.netgate.com/pfsense/en/latest/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://docs.netgate.com/pfsense/en/latest/sitemap.xml",
    urlPattern: "^https://docs\\.netgate\\.com/pfsense/en/latest/",
    urlExclude: "/(404|genindex|search)\\.html$",
  }),

  // OPNsense docs - Sphinx HTML. Upstream sitemap.xml is malformed
  // (every <loc> embeds the build-version HTML in the path), so scrape
  // the full toctree from the index page instead (110+ pages).
  new DocSource({
    name: "opnsense",
    type: "http",
    url: "https://docs.opnsense.org/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://docs.opnsense.org/",
    urlPattern: "^https://docs\\.opnsense\\.org/",
    urlExclude: "(genindex|search)\\.html",
  }),

  // GL.iNet router docs (firmware 4.x) - MkDocs Material, scoped
  // sitemap (~216 pages).
  new DocSource({
    name: "glinet",
    type: "http",
    url: "https://docs.gl-inet.com/router/en/4/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://docs.gl-inet.com/router/en/4/sitemap.xml",
    urlPattern: "^https://docs\\.gl-inet\\.com/router/en/4/",
  }),

  // ─── Firewall / netfilter ───────────────────────────────────────

  // nftables wiki - MediaWiki, small (~94 ns0 pages verified via API).
  new DocSource({
    name: "nftables",
    type: "http",
    url: "https://wiki.nftables.org/wiki-nftables/index.php/",
    format: "html",
    discovery: "mediawiki",
    discoveryUrl: "https://wiki.nftables.org/wiki-nftables/api.php",
    urlPattern: "wiki\\.nftables\\.org/wiki-nftables/index\\.php/",
    urlExclude: "(Special:|Talk:|User:|File:|Template:|Category:|Help:|MediaWiki:)",
    pageConcurrency: 2, // 15-wide burst trips connection failures on this old Apache
  }),

  // iptables / netfilter documentation - the canonical 2002-era
  // DocBook HOWTOs on netfilter.org. Frozen upstream, chunked HTML
  // (index page links NAME-N.html section pages), directory listing
  // forbidden, no sitemap: an explicit urls list is the durable option.
  new DocSource({
    name: "iptables",
    type: "http",
    url: "https://www.netfilter.org/documentation/",
    format: "html",
    urls: [
      "https://www.netfilter.org/documentation/FAQ/netfilter-faq.html",
      "https://www.netfilter.org/documentation/FAQ/netfilter-faq-1.html",
      "https://www.netfilter.org/documentation/FAQ/netfilter-faq-2.html",
      "https://www.netfilter.org/documentation/FAQ/netfilter-faq-3.html",
      "https://www.netfilter.org/documentation/FAQ/netfilter-faq-4.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-1.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-2.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-3.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-4.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-5.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-6.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-7.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-8.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-9.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-10.html",
      "https://www.netfilter.org/documentation/HOWTO/NAT-HOWTO-11.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-double-nat-HOWTO.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-double-nat-HOWTO-1.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-double-nat-HOWTO-2.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-double-nat-HOWTO-3.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-double-nat-HOWTO-4.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-double-nat-HOWTO-5.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-double-nat-HOWTO-6.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-double-nat-HOWTO-7.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO-1.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO-2.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO-3.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO-4.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO-5.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO-6.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO-7.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO-8.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-extensions-HOWTO-9.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-1.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-2.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-3.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-4.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-5.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-6.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-7.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-8.html",
      "https://www.netfilter.org/documentation/HOWTO/netfilter-hacking-HOWTO-9.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-1.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-2.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-3.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-4.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-5.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-6.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-7.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-8.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-9.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-10.html",
      "https://www.netfilter.org/documentation/HOWTO/networking-concepts-HOWTO-11.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-1.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-2.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-3.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-4.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-5.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-6.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-7.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-8.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-9.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-10.html",
      "https://www.netfilter.org/documentation/HOWTO/packet-filtering-HOWTO-11.html",
    ],
  }),

  // ─── DNS servers ────────────────────────────────────────────────

  // NSD (NLnet Labs) — authoritative-only DNS server.
  // Sphinx-built docs; the published sitemap.xml only lists the root,
  // so we use TOC discovery against the index page instead.
  new DocSource({
    name: "nsd",
    type: "http",
    url: "https://nsd.docs.nlnetlabs.nl/en/latest/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://nsd.docs.nlnetlabs.nl/en/latest/index.html",
    urlPattern: "nsd\\.docs\\.nlnetlabs\\.nl/en/latest/",
    urlExclude: "(genindex|py-modindex|search)\\.html",
  }),

  // Knot DNS (CZ.NIC) — authoritative DNS server.
  // No sitemap on knot-dns.cz; Sphinx HTML is published under
  // /docs/latest/html/. TOC discovery against the index page.
  new DocSource({
    name: "knot-dns",
    type: "http",
    url: "https://www.knot-dns.cz/docs/latest/html/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://www.knot-dns.cz/docs/latest/html/index.html",
    urlPattern: "knot-dns\\.cz/docs/latest/html/",
    urlExclude: "(genindex|search)\\.html",
  }),

  // PowerDNS Authoritative — sitemap-based (~156 pages).
  new DocSource({
    name: "powerdns",
    type: "http",
    url: "https://doc.powerdns.com/authoritative/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://doc.powerdns.com/authoritative/sitemap.xml",
  }),

  // BIND 9 (ISC) — Sphinx docs on readthedocs.
  // The sitemap lists every published version (v9.21.x, stable, latest),
  // so we use TOC discovery against /en/latest/ to stay on one version.
  new DocSource({
    name: "bind9",
    type: "http",
    url: "https://bind9.readthedocs.io/en/latest/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://bind9.readthedocs.io/en/latest/",
    urlPattern: "bind9\\.readthedocs\\.io/en/latest/",
    urlExclude: "(genindex|search|_static/|_sources/|#)",
  }),

  // Kea (ISC) - DHCPv4/DHCPv6/DDNS server. Sphinx docs on
  // readthedocs; same layout as bind9 (sitemap only lists version
  // roots), so TOC discovery against /en/latest/. requestTimeoutMs:
  // RTD honours Accept: text/markdown via Cloudflare's on-the-fly
  // conversion, which takes ~61s on the 1.7MB kea-messages.html -
  // double the 30s default or that one page deterministically fails.
  new DocSource({
    name: "kea",
    type: "http",
    url: "https://kea.readthedocs.io/en/latest/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://kea.readthedocs.io/en/latest/",
    urlPattern: "kea\\.readthedocs\\.io/en/latest/",
    urlExclude: "(genindex|search|_static/|_sources/|#)",
    requestTimeoutMs: 90_000,
  }),

  // Pi-hole docs - MkDocs markdown straight from the repo.
  new DocSource({
    name: "pihole",
    type: "git",
    url: "https://github.com/pi-hole/docs",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // AdGuard Home docs - the product docs are the AdGuard DNS knowledge
  // base (Docusaurus, server-rendered); filter the KB sitemap to the
  // adguard-home section.
  new DocSource({
    name: "adguard-home",
    type: "http",
    url: "https://adguard-dns.io/kb/adguard-home/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://adguard-dns.io/kb/sitemap.xml",
    urlPattern: "^https://adguard-dns\\.io/kb/adguard-home/",
  }),

  // ─── miekg/dns (Go DNS library) ────────────────────────────────

  // v1 — the original Go DNS library on GitHub. Maintenance-only
  // upstream (fixes only, will eventually be archived) but still what
  // most existing Go DNS code imports. `format: "godoc"` walks .go
  // files and extracts package doc + exported decls via GoNormaliser.
  new DocSource({
    name: "miekg-dns",
    type: "git",
    url: "https://github.com/miekg/dns",
    format: "godoc",
  }),

  // v2 — the active rewrite on Codeberg. ~2x faster, package split
  // (rdata / dnsutil / dnstest / svcb / deleg / dnshttp / pkg/pool /
  // cmd/atomdns). Same godoc extraction — see GoNormaliser.
  new DocSource({
    name: "miekg-dns-v2",
    type: "git",
    url: "https://codeberg.org/miekg/dns",
    format: "godoc",
  }),

  // --- DNS providers (registrar + management APIs) --------------

  // llms-full.txt -- complete API reference as a single markdown file.
  // Porkbun publishes AI-friendly docs per the acceptmarkdown.com
  // spec -- preNormalised=true, no Turndown pass needed.
  new DocSource({
    name: "porkbun",
    type: "http",
    url: "https://porkbun.com/api/json/v3/documentation",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://porkbun.com/llms-full.txt",
  }),

  // OpenAPI -- GoDaddy Domains API v1. Covers DNS records,
  // nameserver management, domain registration/renewal, contacts,
  // transfers, and availability search.
  new DocSource({
    name: "godaddy",
    type: "http",
    url: "https://developer.godaddy.com/en/docs/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://developer.godaddy.com/openapi/domains-v1.json",
  }),

  // --- Nix -------------------------------------------------------

  // Git sparse — nix.dev community docs source (55 md files)
  new DocSource({
    name: "nix",
    type: "git",
    url: "https://github.com/NixOS/nix.dev",
    format: "markdown",
    paths: ["source"],
    rootPath: "source",
  }),

  // ─── React Native ──────────────────────────────────────────────

  // llms-full.txt — complete mobile framework docs (~2MB)
  new DocSource({
    name: "react-native",
    type: "http",
    url: "https://reactnative.dev/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://reactnative.dev/llms-full.txt",
  }),

  // ─── Flutter ───────────────────────────────────────────────────

  // Git sparse — flutter.dev source (697 md files in sites/docs/src/content)
  new DocSource({
    name: "flutter",
    type: "git",
    url: "https://github.com/flutter/website",
    format: "markdown",
    paths: ["sites/docs/src/content"],
    rootPath: "sites/docs/src/content",
  }),

  // ─── Expo ──────────────────────────────────────────────────────

  // Git sparse — Next.js source for docs.expo.dev (1030 mdx files)
  new DocSource({
    name: "expo",
    type: "git",
    url: "https://github.com/expo/expo",
    format: "mdx",
    paths: ["docs/pages"],
    rootPath: "docs/pages",
  }),

  // ─── Tauri ─────────────────────────────────────────────────────

  // Git sparse — Astro Starlight source (496 mdx + 57 md files)
  new DocSource({
    name: "tauri",
    type: "git",
    url: "https://github.com/tauri-apps/tauri-docs",
    format: "mdx",
    paths: ["src/content/docs"],
    rootPath: "src/content/docs",
  }),

  // ─── htmx ──────────────────────────────────────────────────────

  // Git sparse — htmx site source (186 md files in www/)
  new DocSource({
    name: "htmx",
    type: "git",
    url: "https://github.com/bigskysoftware/htmx",
    format: "markdown",
    paths: ["www"],
    rootPath: "www",
  }),

  // ─── Jest ──────────────────────────────────────────────────────

  // Git sparse — jest docs source (37 md files; canonical content)
  new DocSource({
    name: "jest",
    type: "git",
    url: "https://github.com/jestjs/jest",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Cypress ───────────────────────────────────────────────────

  // Sitemap — E2E testing framework (comprehensive docs)
  // Git sparse — E2E testing framework. Site is Docusaurus, but the
  // source markdown lives in the docs/ tree of the docs repo.
  new DocSource({
    name: "cypress",
    type: "git",
    url: "https://github.com/cypress-io/cypress-documentation",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Wails ─────────────────────────────────────────────────────

  // Git sparse — Go+Web desktop apps (sitemap 403 from CDN; Docusaurus MDX)
  new DocSource({
    name: "wails",
    type: "git",
    url: "https://github.com/wailsapp/wails",
    format: "mdx",
    paths: ["website/docs"],
    rootPath: "website/docs",
  }),

  // ─── Prisma ────────────────────────────────────────────────────

  // llms.txt — TypeScript ORM (Postgres, MySQL, SQLite, MongoDB, ~300+ entries)
  new DocSource({
    name: "prisma",
    type: "http",
    url: "https://www.prisma.io/docs/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://www.prisma.io/docs/llms.txt",
  }),

  // ─── SST ───────────────────────────────────────────────────────

  // Git sparse — Astro source for sst.dev (97 mdx files in www/)
  new DocSource({
    name: "sst",
    type: "git",
    url: "https://github.com/sst/sst",
    format: "mdx",
    paths: ["www"],
    rootPath: "www",
  }),

  // ─── Valkey ──────────────────────────────────────────────────────

  // Git repo — Redis fork docs (topics + command reference)
  new DocSource({
    name: "valkey",
    type: "git",
    url: "https://github.com/valkey-io/valkey-doc",
    format: "markdown",
    paths: ["topics", "commands"],
  }),

  // ─── Bitwarden ─────────────────────────────────────────────────

  // Sitemap — user-facing help docs (~350 pages, each serves .md variant)
  new DocSource({
    name: "bitwarden",
    type: "http",
    url: "https://bitwarden.com/help/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://bitwarden.com/help/llms-full.txt",
  }),

  // ─── Vaultwarden ───────────────────────────────────────────────

  // GitHub wiki — self-hosted Bitwarden-compatible server (65 pages)
  new DocSource({
    name: "vaultwarden",
    type: "git",
    url: "https://github.com/dani-garcia/vaultwarden.wiki",
    format: "markdown",
  }),

  // ─── rbw ─────────────────────────────────────────────────────────

  // Unofficial Bitwarden CLI in Rust. The README is the complete manual
  // (config, agent, pinentry, rbw-* helpers); docs.rs/crate/rbw renders
  // the same README and the crate is a binary, so there is no API
  // surface worth adding beyond it.
  new DocSource({
    name: "rbw",
    type: "git",
    url: "https://github.com/doy/rbw",
    format: "markdown",
  }),

  // ─── curl ────────────────────────────────────────────────────────

  // "Everything curl" — comprehensive book covering CLI, libcurl, HTTP, TLS, proxies (~170 files)
  new DocSource({
    name: "curl",
    type: "git",
    url: "https://github.com/bagder/everything-curl",
    format: "markdown",
  }),

  // ─── ripgrep ───────────────────────────────────────────────────

  // GUIDE.md + FAQ.md — complete user guide and FAQ (~100KB total)
  new DocSource({
    name: "ripgrep",
    type: "git",
    url: "https://github.com/BurntSushi/ripgrep",
    format: "markdown",
  }),

  // ─── HTTPie ────────────────────────────────────────────────────

  // CLI docs from the httpie/cli repo (canonical single-file reference)
  new DocSource({
    name: "httpie",
    type: "git",
    url: "https://github.com/httpie/cli",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── jq ─────────────────────────────────────────────────────────

  // Single-page manual from jqlang.org - the canonical jq reference.
  // The manual is one large HTML page; `none` discovery with a direct
  // URL list fetches it as a single file.
  new DocSource({
    name: "jq",
    type: "http",
    url: "https://jqlang.org/manual/",
    format: "html",
    discovery: "none",
    urls: ["https://jqlang.org/manual/"],
    description: "jq manual - the definitive jq reference",
  }),

  // ─── yq ─────────────────────────────────────────────────────────

  // GitBook docs with llms.txt - each page available as .md directly.
  // Exclude v3.x (legacy version series).
  new DocSource({
    name: "yq",
    type: "http",
    url: "https://mikefarah.gitbook.io/yq/",
    format: "markdown",
    discovery: "llms-txt",
    discoveryUrl: "https://mikefarah.gitbook.io/yq/llms.txt",
    urlExclude: "v3\\.x/",
    description: "yq - YAML/JSON/XML processor with jq-like syntax",
  }),

  // ─── fd ─────────────────────────────────────────────────────────

  // README.md is the canonical fd documentation (~600 lines). No paths
  // filter - picks up README + CHANGELOG + CONTRIBUTING.
  new DocSource({
    name: "fd",
    type: "git",
    url: "https://github.com/sharkdp/fd",
    format: "markdown",
  }),

  // ─── Miller ─────────────────────────────────────────────────────

  // Compiled markdown docs from the miller repo (docs/src/*.md).
  // The .md.in source templates coexist but are skipped by the
  // markdown format filter.
  new DocSource({
    name: "miller",
    type: "git",
    url: "https://github.com/johnkerl/miller",
    format: "markdown",
    paths: ["docs/src"],
    rootPath: "docs/src",
    description: "Miller (mlr) - CLI data processing for CSV/TSV/JSON",
  }),

  // ─── GraphQL ───────────────────────────────────────────────────

  // Official spec — 12 markdown files covering language, type system, execution, etc.
  new DocSource({
    name: "graphql-spec",
    type: "git",
    url: "https://github.com/graphql/graphql-spec",
    format: "markdown",
    paths: ["spec"],
    rootPath: "spec",
  }),

  // Website docs — learn guides, FAQ, graphql-js reference (MDX)
  new DocSource({
    name: "graphql",
    type: "git",
    url: "https://github.com/graphql/graphql.github.io",
    format: "mdx",
    paths: ["src/pages"],
    rootPath: "src/pages",
  }),

  // ─── Multigres ──────────────────────────────────────────────────

  // Git sparse — Vitess-for-Postgres docs (25 md files in main repo)
  new DocSource({
    name: "multigres",
    type: "git",
    url: "https://github.com/multigres/multigres",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // Git repo — developer docs (architecture, HA decision log, query serving internals)
  new DocSource({
    name: "multigres-dev",
    type: "git",
    url: "https://github.com/multigres/multigres",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Excalidraw ─────────────────────────────────────────────────

  // MDX dev docs from the excalidraw monorepo (Docusaurus, 36 files)
  new DocSource({
    name: "excalidraw",
    type: "git",
    url: "https://github.com/excalidraw/excalidraw",
    format: "mdx",
    paths: ["dev-docs/docs"],
    rootPath: "dev-docs/docs",
  }),

  // ─── PostgreSQL Wiki ────────────────────────────────────────────

  // MediaWiki API enumeration — all 1,177 main-namespace articles
  new DocSource({
    name: "postgres-wiki",
    type: "http",
    url: "https://wiki.postgresql.org/wiki/",
    format: "html",
    discovery: "mediawiki",
    discoveryUrl: "https://wiki.postgresql.org/api.php",
    urlPattern: "wiki\\.postgresql\\.org/wiki/",
    urlExclude: "(Special:|Talk:|User:|File:|Template:|Category:|Help:|MediaWiki:)",
  }),

  // ─── pgvector ──────────────────────────────────────────────────

  // Vector similarity search for Postgres (README + CHANGELOG)
  new DocSource({
    name: "pgvector",
    type: "git",
    url: "https://github.com/pgvector/pgvector",
    format: "markdown",
  }),

  // ─── PostGIS ───────────────────────────────────────────────────

  // TOC-based — spatial database reference manual (~600 function pages)
  new DocSource({
    name: "postgis",
    type: "http",
    url: "https://postgis.net/docs/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://postgis.net/docs/",
    urlPattern: "postgis\\.net/docs/",
    urlExclude: "(postgis\\.net/docs/$|#)",
  }),

  // ─── PgBouncer ─────────────────────────────────────────────────

  // Connection pooler docs from the pgbouncer.github.io site
  new DocSource({
    name: "pgbouncer",
    type: "git",
    url: "https://github.com/pgbouncer/pgbouncer.github.io",
    format: "markdown",
  }),

  // ─── TimescaleDB ───────────────────────────────────────────────

  // llms-full.txt — time-series database for Postgres (~4.6MB, rebranded to TigerData)
  new DocSource({
    name: "timescaledb",
    type: "http",
    url: "https://www.tigerdata.com/docs/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://www.tigerdata.com/docs/llms-full.txt",
  }),

  // ─── pg_cron ───────────────────────────────────────────────────

  // Job scheduler for Postgres (README + CHANGELOG)
  new DocSource({
    name: "pg-cron",
    type: "git",
    url: "https://github.com/citusdata/pg_cron",
    format: "markdown",
  }),

  // ─── pgrx ──────────────────────────────────────────────────────

  // Rust framework for Postgres extensions (mdbook + articles)
  new DocSource({
    name: "pgrx",
    type: "git",
    url: "https://github.com/pgcentralfoundation/pgrx",
    format: "markdown",
    paths: ["docs/src", "articles"],
  }),

  // ─── Citus ─────────────────────────────────────────────────────

  // Distributed Postgres extension (README)
  new DocSource({
    name: "citus",
    type: "git",
    url: "https://github.com/citusdata/citus",
    format: "markdown",
  }),

  // ─── Neon ──────────────────────────────────────────────────────

  // llms-full.txt — serverless Postgres platform (~5MB)
  new DocSource({
    name: "neon",
    type: "http",
    url: "https://neon.com/docs/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://neon.com/docs/llms-full.txt",
  }),

  // ─── Electric SQL ──────────────────────────────────────────────

  // Git sparse — Postgres sync engine (47 md files in website/docs)
  new DocSource({
    name: "electric",
    type: "git",
    url: "https://github.com/electric-sql/electric",
    format: "markdown",
    paths: ["website/docs"],
    rootPath: "website/docs",
  }),

  // ─── ParadeDB ──────────────────────────────────────────────────

  // llms-full.txt — Postgres for search and analytics (~450KB)
  new DocSource({
    name: "paradedb",
    type: "http",
    url: "https://docs.paradedb.com/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://docs.paradedb.com/llms-full.txt",
  }),

  // ─── CockroachDB ──────────────────────────────────────────────

  // Sitemap — distributed SQL database (filter to stable docs)
  // Git sparse — distributed SQL database. Live site advisory pages
  // are JS-rendered; the docs repo's src/current/ holds Jekyll source.
  // We pull just the current major (v26.2), cloud docs, and advisories
  // to avoid grabbing 1.4 GB of historical version directories.
  new DocSource({
    name: "cockroachdb",
    type: "git",
    url: "https://github.com/cockroachdb/docs",
    format: "markdown",
    paths: ["src/current/v26.2", "src/current/cockroachcloud", "src/current/advisories", "src/current/molt", "src/current/releases"],
    rootPath: "src/current",
  }),

  // ─── YugabyteDB ───────────────────────────────────────────────

  // Sitemap — distributed Postgres-compatible database (filter to stable, skip partials)
  // Git sparse — distributed Postgres-compatible. Site is Hugo over
  // a heavy theme; canonical Markdown is content/latest/ in the docs
  // repo. (No /stable/ in the source tree; latest = current.)
  new DocSource({
    name: "yugabytedb",
    type: "git",
    url: "https://github.com/yugabyte/docs",
    format: "markdown",
    paths: ["content/latest"],
    rootPath: "content/latest",
  }),

  // ─── Supavisor ─────────────────────────────────────────────────

  // Postgres connection pooler by Supabase (mkdocs)
  new DocSource({
    name: "supavisor",
    type: "git",
    url: "https://github.com/supabase/supavisor",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── pg_graphql ────────────────────────────────────────────────

  // GraphQL for Postgres by Supabase (mkdocs, ~120KB)
  new DocSource({
    name: "pg-graphql",
    type: "git",
    url: "https://github.com/supabase/pg_graphql",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── pg_net ────────────────────────────────────────────────────

  // Async HTTP client for Postgres by Supabase (README + CONTRIBUTING).
  // Upstream removed the docs/ dir; root markdown is now the source.
  new DocSource({
    name: "pg-net",
    type: "git",
    url: "https://github.com/supabase/pg_net",
    format: "markdown",
  }),

  // ─── index_advisor ─────────────────────────────────────────────

  // Postgres index recommendation extension by Supabase
  new DocSource({
    name: "index-advisor",
    type: "git",
    url: "https://github.com/supabase/index_advisor",
    format: "markdown",
  }),

  // ─── supabase-grafana ──────────────────────────────────────────

  // Grafana dashboards for Supabase Postgres (metrics reference ~110KB)
  new DocSource({
    name: "supabase-grafana",
    type: "git",
    url: "https://github.com/supabase/supabase-grafana",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Modern SQL ────────────────────────────────────────────────

  // Sitemap — SQL standard features reference (421 pages)
  new DocSource({
    name: "modern-sql",
    type: "http",
    url: "https://modern-sql.com/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://modern-sql.com/sitemap.xml",
  }),

  // ─── Use The Index, Luke ───────────────────────────────────────

  // Sitemap — SQL indexing and performance tutorial (filter to English)
  new DocSource({
    name: "use-the-index-luke",
    type: "http",
    url: "https://use-the-index-luke.com/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://use-the-index-luke.com/sitemap.xml",
    urlExclude: "use-the-index-luke\\.com/(de|fr|ja|es)/",
  }),

  // ─── Patroni ───────────────────────────────────────────────────

  // TOC-based — Postgres HA template (RTD sitemap only has version roots)
  new DocSource({
    name: "patroni",
    type: "http",
    url: "https://patroni.readthedocs.io/en/latest/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://patroni.readthedocs.io/en/latest/",
    urlPattern: "patroni\\.readthedocs\\.io/en/latest/",
  }),

  // ─── pgpool ────────────────────────────────────────────────────

  // TOC-based — Postgres connection pooler + HA (Sphinx docs)
  new DocSource({
    name: "pgpool",
    type: "http",
    url: "https://www.pgpool.net/docs/latest/en/html/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://www.pgpool.net/docs/latest/en/html/index.html",
    urlPattern: "pgpool\\.net/docs/latest/en/html/",
  }),

  // ─── SQL Style Guide ───────────────────────────────────────────

  // SQL formatting conventions (single canonical markdown file)
  new DocSource({
    name: "sqlstyle",
    type: "git",
    url: "https://github.com/treffynnon/sqlstyle.guide",
    format: "markdown",
  }),

  // ─── SearXNG ───────────────────────────────────────────────────

  // TOC-based — Sphinx-rendered HTML site for the metasearch engine.
  // Repo docs/ is .rst (no native RST normaliser); HTML site is canonical.
  new DocSource({
    name: "searxng",
    type: "http",
    url: "https://docs.searxng.org/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://docs.searxng.org/",
    urlPattern: "docs\\.searxng\\.org/",
    urlExclude: "(_static/|_sources/|genindex|search\\.html|#)",
  }),

  // ─── ProjectDiscovery ──────────────────────────────────────────

  // Mintlify MDX source — nuclei, subfinder, httpx, katana, naabu, etc.
  new DocSource({
    name: "projectdiscovery",
    type: "git",
    url: "https://github.com/projectdiscovery/docs",
    format: "mdx",
    paths: [
      "tools",
      "opensource",
      "cloud",
      "help",
      "quickstart",
      "templates",
      "api-reference",
      "_snippets",
    ],
  }),

  // ─── OWASP Amass ───────────────────────────────────────────────

  // Wiki repo — asset discovery and attack surface mapping
  new DocSource({
    name: "amass",
    type: "git",
    url: "https://github.com/owasp-amass/amass.wiki",
    format: "markdown",
  }),

  // ─── SpiderFoot ────────────────────────────────────────────────

  // Wiki repo — OSINT automation framework (docs/ is .rst, wiki is markdown)
  new DocSource({
    name: "spiderfoot",
    type: "git",
    url: "https://github.com/smicallef/spiderfoot.wiki",
    format: "markdown",
  }),

  // ─── theHarvester ──────────────────────────────────────────────

  // Whole repo — email/subdomain/name harvester (README + small md count)
  new DocSource({
    name: "theharvester",
    type: "git",
    url: "https://github.com/laramies/theHarvester",
    format: "markdown",
  }),

  // ─── recon-ng ──────────────────────────────────────────────────

  // Wiki repo — modular reconnaissance framework
  new DocSource({
    name: "recon-ng",
    type: "git",
    url: "https://github.com/lanmaster53/recon-ng.wiki",
    format: "markdown",
  }),

  // ─── Sherlock ──────────────────────────────────────────────────

  // Whole repo — username hunter (README + minimal docs/ tree)
  new DocSource({
    name: "sherlock",
    type: "git",
    url: "https://github.com/sherlock-project/sherlock",
    format: "markdown",
  }),

  // ─── Maigret ───────────────────────────────────────────────────

  // TOC-based — ReadTheDocs sitemap only lists version roots; the
  // index page itself links to all sub-pages (Sphinx Furo theme).
  new DocSource({
    name: "maigret",
    type: "http",
    url: "https://maigret.readthedocs.io/en/latest/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://maigret.readthedocs.io/en/latest/",
    urlPattern: "maigret\\.readthedocs\\.io/en/latest/",
    urlExclude: "(_static/|_sources/|genindex|search\\.html|#)",
  }),

  // ─── BBOT ──────────────────────────────────────────────────────

  // Git sparse — recursive internet scanner (mkdocs markdown in docs/)
  new DocSource({
    name: "bbot",
    type: "git",
    url: "https://github.com/blacklanternsecurity/bbot",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── ExifTool ──────────────────────────────────────────────────

  // Direct URLs — canonical reference pages for image metadata extraction
  // (exiftool.org has no sitemap; TagNames/ has hundreds of vendor pages,
  //  so we pick just the umbrella + most-used tag groups).
  new DocSource({
    name: "exiftool",
    type: "http",
    url: "https://exiftool.org/",
    format: "html",
    urls: [
      "https://exiftool.org/index.html",
      "https://exiftool.org/install.html",
      "https://exiftool.org/exiftool_pod.html",
      "https://exiftool.org/faq.html",
      "https://exiftool.org/geotag.html",
      "https://exiftool.org/filename.html",
      "https://exiftool.org/struct.html",
      "https://exiftool.org/htmldump.html",
      "https://exiftool.org/TagNames/index.html",
      "https://exiftool.org/TagNames/EXIF.html",
      "https://exiftool.org/TagNames/GPS.html",
      "https://exiftool.org/TagNames/IPTC.html",
      "https://exiftool.org/TagNames/XMP.html",
      "https://exiftool.org/TagNames/MakerNotes.html",
      "https://exiftool.org/TagNames/Composite.html",
      "https://exiftool.org/TagNames/Extra.html",
    ],
  }),

  // ─── YaCy ──────────────────────────────────────────────────────

  // Whole repo — distributed P2P search server (README + a handful of md)
  new DocSource({
    name: "yacy",
    type: "git",
    url: "https://github.com/yacy/yacy_search_server",
    format: "markdown",
  }),

  // ─── Unraid ────────────────────────────────────────────────────

  // Git sparse — Docusaurus 3 MDX source for docs.unraid.net (~300 files)
  new DocSource({
    name: "unraid",
    type: "git",
    url: "https://github.com/unraid/docs",
    format: "mdx",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Turing Pi ─────────────────────────────────────────────────

  // docs.turingpi.com is a ReadMe.io-hosted site with no backing git
  // repo. Its llms.txt and sitemap are BOTH incomplete (~30 of ~62
  // pages; the sitemap even carries a malformed RK1 URL with a missing
  // slash), so discovery scrapes the full sidebar nav rendered into
  // every docs page (toc). Every docs page serves clean markdown at a
  // `.md`-suffixed URL (Content-Type: text/markdown), so urlSuffix
  // appends ".md" and pages arrive preNormalised. RK1 pages are split
  // into their own source below via urlExclude.
  new DocSource({
    name: "turingpi",
    type: "http",
    url: "https://docs.turingpi.com",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://docs.turingpi.com/docs/turing-pi2-intro",
    urlPattern: "docs\\.turingpi\\.com/docs/",
    urlExclude: "turing-rk1",
    urlSuffix: ".md",
  }),

  // Turing RK1 compute module (RK3588) - the turing-rk1-* subset of
  // docs.turingpi.com (specs/I/O, flashing OS, NPU/RKNN).
  new DocSource({
    name: "turingpi-rk1",
    type: "http",
    url: "https://docs.turingpi.com",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://docs.turingpi.com/docs/turing-rk1-specs-and-io-ports",
    urlPattern: "docs\\.turingpi\\.com/docs/turing-rk1-",
    urlSuffix: ".md",
  }),

  // Help-center repo - the older GitHub-hosted docs/FAQ/guide articles
  // (V1 board docs, Kickstarter FAQ, Docker Swarm / k3s guides) that
  // predate the ReadMe.io site and aren't fully mirrored there.
  new DocSource({
    name: "turingpi-help-center",
    type: "git",
    url: "https://github.com/turing-machines/help-center",
    format: "markdown",
    paths: ["Docs", "FAQ", "Guides", "V1 Docs"],
  }),

  // Community NixOS flake for the Turing RK1 (u-boot + latest stable
  // kernel; build/flashing guide). Whole repo - the README is the doc.
  new DocSource({
    name: "nixos-turing-rk1",
    type: "git",
    url: "https://github.com/GiyoMoon/nixos-turing-rk1",
    format: "markdown",
  }),

  // ─── PiKVM ───────────────────────────────────────────────────────

  // Git sparse - mkdocs-material source of docs.pikvm.org (the PiKVM
  // Handbook, ~180 md files). Default branch is `master`. Underscore-
  // prefixed files are markdown-include fragments transcluded into
  // other pages at build time; kept so their content stays searchable.
  new DocSource({
    name: "pikvm",
    type: "git",
    url: "https://github.com/pikvm/pikvm",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Talos Linux ─────────────────────────────────────────────────

  // Git sparse - siderolabs/docs is the Mintlify content repo behind
  // talos.dev (the talos repo itself now carries only generated
  // reference). Content is versioned per directory; pinned to v1.14 -
  // bump the path when a new minor lands. rootPath strips the
  // public/talos/v1.14 prefix.
  new DocSource({
    name: "talos",
    type: "git",
    url: "https://github.com/siderolabs/docs",
    format: "mdx",
    paths: ["public/talos/v1.14"],
    rootPath: "public/talos/v1.14",
  }),

  // ─── CachyOS Wiki ──────────────────────────────────────────────

  // Git sparse — Astro Starlight MDX. Default branch is `next`; English
  // content lives in topic-specific dirs at root of src/content/docs
  // (language-code subdirs hold translations — excluded here).
  new DocSource({
    name: "cachyos",
    type: "git",
    url: "https://github.com/CachyOS/wiki",
    format: "mdx",
    paths: [
      "src/content/docs/cachyos_basic",
      "src/content/docs/configuration",
      "src/content/docs/features",
      "src/content/docs/installation",
      "src/content/docs/policy",
      "src/content/docs/support",
      "src/content/docs/virtualization",
    ],
    rootPath: "src/content/docs",
  }),

  // ─── Arch Wiki ─────────────────────────────────────────────────

  // MediaWiki - English pages of wiki.archlinux.org. allpages returns
  // ns0 including translations ("Page (Language)" title suffixes).
  // urlExclude drops them two ways: any parens group containing a
  // URL-encoded byte (every non-ASCII language name, verified zero
  // collateral across all ns0 parens titles), plus the pure-ASCII
  // language names. English hardware pages like "Dell XPS 13 (9360)"
  // survive both arms. Concurrency 4 - 8 tripped HTTP 429s.
  new DocSource({
    name: "archwiki",
    type: "http",
    url: "https://wiki.archlinux.org/title/",
    format: "html",
    discovery: "mediawiki",
    discoveryUrl: "https://wiki.archlinux.org/api.php",
    urlPattern: "^https://wiki\\.archlinux\\.org/title/",
    urlExclude:
      "\\([^)]*%|\\((Magyar|Polski|Italiano|Suomi|Bosanski|Bahasa_Indonesia|Svenska|Dansk|Nederlands|Hrvatski|Qhichwa|Esperanto)",
    pageConcurrency: 4,
    deadlineMs: 1_800_000,
  }),

  // --- NixOS Wiki -------------------------------------------------

  // MediaWiki - the official NixOS wiki (wiki.nixos.org). ~461 articles
  // in the main namespace, covering ZFS, GPU passthrough, virt, and
  // other community-maintained NixOS HOWTOs the manual doesn't cover.
  new DocSource({
    name: "nixos-wiki",
    type: "http",
    url: "https://wiki.nixos.org/wiki/",
    format: "html",
    discovery: "mediawiki",
    discoveryUrl: "https://wiki.nixos.org/w/api.php",
    urlPattern: "^https://wiki\\.nixos\\.org/wiki/",
  }),

  // --- NixOS Manual ------------------------------------------------

  // Git sparse - the NixOS manual in nixpkgs (CommonMark, ~140 files,
  // self-contained: all {=include=} refs stay inside nixos/doc/manual).
  // The NixOS options reference is build-generated (@NIXOS_OPTIONS_JSON@)
  // and absent from git, so the mirror lacks it (options search lives at
  // search.nixos.org). The Nix package-manager manual redirects to
  // nix.dev, which the `nix` source already covers.
  new DocSource({
    name: "nixos",
    type: "git",
    url: "https://github.com/NixOS/nixpkgs",
    format: "markdown",
    paths: ["nixos/doc/manual"],
    rootPath: "nixos/doc/manual",
    urlExclude: "(README|contributing-to-this-manual)\\.md$",
  }),

  // --- nixpkgs Manual ----------------------------------------------

  // Git sparse - the full nixpkgs manual (doc/ tree, ~205 CommonMark
  // files). Covers build-helpers, functions, hooks, languages-frameworks,
  // stdenv, packages, module-system, and more. Complements the `nixos`
  // source (which only covers nixos/doc/manual). Same repo, different
  // sparse-checkout path. {=include=} directives are left raw - the
  // referenced files are still present as separate pages.
  new DocSource({
    name: "nixpkgs",
    type: "git",
    url: "https://github.com/NixOS/nixpkgs",
    format: "markdown",
    paths: ["doc"],
    rootPath: "doc",
    urlExclude: "^README\\.md$",
  }),

  // --- Debian Administrator's Handbook -----------------------------

  // TOC - debian-handbook.info serves per-chapter HTML (source is
  // Publican DocBook XML on salsa.debian.org; no markdown form exists).
  // ~20 chapter pages; index.html is the TOC itself.
  new DocSource({
    name: "debian-handbook",
    type: "http",
    url: "https://debian-handbook.info/browse/stable/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://debian-handbook.info/browse/stable/",
    urlExclude: "index\\.html$",
  }),

  // ─── Debian Reference ──────────────────────────────────────────

  // TOC - per-chapter HTML under www.debian.org/doc/manuals/. Language
  // is baked into filenames (ch01.en.html); urlPattern keeps English.
  new DocSource({
    name: "debian-reference",
    type: "http",
    url: "https://www.debian.org/doc/manuals/debian-reference/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://www.debian.org/doc/manuals/debian-reference/",
    urlPattern: "\\.en\\.html$",
  }),

  // ─── Ubuntu Server ─────────────────────────────────────────────

  // Sitemap - Canonical's server docs moved to ubuntu.com/server/docs
  // (docs.ubuntu.com/server is 404, documentation.ubuntu.com 301s).
  // The doc-sitemap is a clean flat urlset (~250 pages); the source
  // repo is Sphinx .rst, so published HTML is the right target.
  new DocSource({
    name: "ubuntu-server",
    type: "http",
    url: "https://ubuntu.com/server/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://ubuntu.com/server/docs/doc-sitemap.xml",
    urlPattern: "^https://ubuntu\\.com/server/docs/",
  }),

  // ─── VyOS ──────────────────────────────────────────────────────

  // Sitemap - the root sitemap covers the 1.5 release stream
  // (/en/latest/ 301s to rolling dev docs; swap to
  // /en/rolling/sitemap.xml to track rolling instead). docs.vyos.io is
  // behind Cloudflare with Markdown for Agents enabled, so pages arrive
  // as pre-normalised markdown.
  new DocSource({
    name: "vyos",
    type: "http",
    url: "https://docs.vyos.io/en/1.5/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://docs.vyos.io/sitemap.xml",
    urlPattern: "^https://docs\\.vyos\\.io/en/1\\.5/",
    urlExclude: "/(404|genindex|search)\\.html$",
  }),

  // ─── RHEL 9 (curated admin guides) ─────────────────────────────

  // TOC per guide - docs.redhat.com has no usable sitemap (the index
  // declared in robots.txt is Akamai 403), no docs API, and the product
  // landing page links only guide indexes, never chapters. Each guide
  // index links its own chapters, so: one source per curated guide.
  // robots.txt declares Crawl-delay: 10 and Akamai blocks aggressive
  // bots, hence pageConcurrency 3. ~16 pages/guide average.
  ...(() => {
    const guides: ReadonlyArray<readonly [string, string]> = [
      ["rhel9-basic-system-settings", "configuring_basic_system_settings"],
      ["rhel9-dnf", "managing_software_with_the_dnf_tool"],
      ["rhel9-networking", "configuring_and_managing_networking"],
      ["rhel9-network-infrastructure-services", "managing_networking_infrastructure_services"],
      ["rhel9-security-hardening", "security_hardening"],
      ["rhel9-selinux", "using_selinux"],
      ["rhel9-firewalls", "configuring_firewalls_and_packet_filters"],
      ["rhel9-storage", "managing_storage_devices"],
      ["rhel9-lvm", "configuring_and_managing_logical_volumes"],
      ["rhel9-file-systems", "managing_file_systems"],
      ["rhel9-performance", "monitoring_and_managing_system_status_and_performance"],
      ["rhel9-kernel", "managing_monitoring_and_updating_the_kernel"],
      ["rhel9-systemd", "using_systemd_unit_files_to_customize_and_optimize_your_system"],
      ["rhel9-containers", "building_running_and_managing_containers"],
    ];
    return guides.map(([name, slug]) => new DocSource({
      name,
      type: "http",
      url: `https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/${slug}/`,
      format: "html",
      discovery: "toc",
      discoveryUrl: `https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/${slug}/`,
      pageConcurrency: 3,
      deadlineMs: 600_000,
    }));
  })(),

  // ─── SteamOS / Steam Deck (Steamworks docs) ────────────────────

  // TOC - partner.steamgames.com/doc has been public since 2022. Every
  // page embeds the full nav (~357 links); urlPattern scopes to the
  // Deck/OS slice: steamdeck, proton, compat/verified, steamframe.
  new DocSource({
    name: "steamos",
    type: "http",
    url: "https://partner.steamgames.com/doc/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://partner.steamgames.com/doc/home",
    urlPattern: "^https://partner\\.steamgames\\.com/doc/steamhardware",
    pageConcurrency: 4,
  }),

  // ─── SteamDeckHQ guides ────────────────────────────────────────

  // Sitemap - community Steam Deck guides (WordPress/Yoast). The
  // tips-and-guides child sitemap is ~70 how-to guides; the post-*
  // sitemaps (~4k news posts) are deliberately not ingested.
  new DocSource({
    name: "steamdeckhq",
    type: "http",
    url: "https://steamdeckhq.com/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://steamdeckhq.com/tips-and-guides-sitemap.xml",
    urlPattern: "^https://steamdeckhq\\.com/tips-and-guides/",
    pageConcurrency: 4,
  }),

  // ─── OpenZFS ───────────────────────────────────────────────────

  // TOC — ZFS on Linux/FreeBSD docs (Sphinx, hosted on GitHub Pages).
  // Repo docs/ is .rst (no native RST normaliser); the Sphinx index page
  // links the full tree. Readthedocs-style sitemap only lists versions
  // and per-version 404 stubs.
  new DocSource({
    name: "openzfs",
    type: "http",
    url: "https://openzfs.github.io/openzfs-docs/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://openzfs.github.io/openzfs-docs/",
    urlPattern: "openzfs\\.github\\.io/openzfs-docs/",
    urlExclude: "(/en/v[0-9]|/404\\.html|genindex|search\\.html|_static/|_sources/|#)",
  }),

  // Man pages - same site, separate source: the root-index toc crawl never
  // reaches /man/, so zpool-attach.8 (raidz expansion semantics) and
  // zpool-add.8 (vdev striping) never got in. The sitemap lists every man
  // page but with a stale /en/ path prefix (all 404), so crawl the toc from
  // the version index instead; tocDepth 2 because the version index only
  // links section index pages (1/, 4/, 5/, 7/, 8/) that link the man pages.
  new DocSource({
    name: "openzfs-man",
    type: "http",
    url: "https://openzfs.github.io/openzfs-docs/man/v2.4/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://openzfs.github.io/openzfs-docs/man/v2.4/",
    urlPattern: "openzfs\\.github\\.io/openzfs-docs/man/v2\\.4/",
    urlExclude: "(genindex|search\\.html|_static/|_sources/|#)",
    tocDepth: 2,
  }),

  // cr0x.net ZFS ops posts (third-party guidance: raidz2 sizing, capacity
  // planning, vdev growth, expansion-adjacent decision rules). Origin
  // unreachable from the fetcher (connect timeout, 2026-08-27), so pinned
  // Wayback raw captures per the AGENTS.md pattern. The raidz expansion
  // post itself (zfs-raidz-expansion-workarounds) has no archive capture -
  // add it once the origin recovers or the archive picks it up.
  new DocSource({
    name: "cr0x-zfs",
    type: "http",
    url: "https://cr0x.net/en/",
    format: "html",
    description:
      "cr0x.net ZFS operations posts (Wayback raw captures, origin unreachable): raidz2 sizing, capacity planning, vdev/special-vdev decisions, ARC/L2ARC, resilver/scrub tuning",
    pageConcurrency: 4,
    urls: [
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-10gbe-network-bottleneck/",
      "https://web.archive.org/web/20260312042728id_/https://cr0x.net/en/zfs-3-metrics-predict-pool-crash/",
      "https://web.archive.org/web/20260406175104id_/https://cr0x.net/en/zfs-acl-mapping-for-smb/",
      "https://web.archive.org/web/20260406175054id_/https://cr0x.net/en/zfs-acltype-posix-vs-nfsv4/",
      "https://web.archive.org/web/20260317183415id_/https://cr0x.net/en/zfs-arc-ram-free-myth/",
      "https://web.archive.org/web/20260317183403id_/https://cr0x.net/en/zfs-arc-ram-sizing/",
      "https://web.archive.org/web/20260317183415id_/https://cr0x.net/en/zfs-arc-sizing-too-much-cache/",
      "https://web.archive.org/web/20260313065032id_/https://cr0x.net/en/zfs-ashift-mismatch-detection/",
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-atime-performance-trap/",
      "https://web.archive.org/web/20260430185408id_/https://cr0x.net/en/zfs-autotrim-ssd-pools/",
      "https://web.archive.org/web/20260406175104id_/https://cr0x.net/en/zfs-backups-send-receive/",
      "https://web.archive.org/web/20260218003726id_/https://cr0x.net/en/zfs-by-id-wwn-device-paths/",
      "https://web.archive.org/web/20260618071955id_/https://cr0x.net/en/zfs-capacity-planning-for-growth/",
      "https://web.archive.org/web/20260312152712id_/https://cr0x.net/en/zfs-corrupt-labels-import-fix/",
      "https://web.archive.org/web/20260417194536id_/https://cr0x.net/en/zfs-ddt-ram-sizing/",
      "https://web.archive.org/web/20260417194547id_/https://cr0x.net/en/zfs-ddt-what-they-are/",
      "https://web.archive.org/web/20260417194547id_/https://cr0x.net/en/zfs-dedup-eats-ram/",
      "https://web.archive.org/web/20260630184446id_/https://cr0x.net/en/zfs-disaster-what-fails-first/",
      "https://web.archive.org/web/20260417045502id_/https://cr0x.net/en/zfs-dnodes-metadata-bottleneck/",
      "https://web.archive.org/web/20260417045502id_/https://cr0x.net/en/zfs-dnodesize-auto-metadata-boost/",
      "https://web.archive.org/web/20260417050520id_/https://cr0x.net/en/zfs-encryption-compression-order/",
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-encryption-without-performance-loss/",
      "https://web.archive.org/web/20260128082748id_/https://cr0x.net/en/zfs-feature-flag-portability/",
      "https://web.archive.org/web/20260422003832id_/https://cr0x.net/en/zfs-fio-vm-reality-profiles/",
      "https://web.archive.org/web/20260417045502id_/https://cr0x.net/en/zfs-glossary-vdev-txg-arc-spa/",
      "https://web.archive.org/web/20260311121723id_/https://cr0x.net/en/zfs-hdd-only-pool-tuning/",
      "https://web.archive.org/web/20260630184434id_/https://cr0x.net/en/zfs-hot-swap-strategy/",
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-hybrid-hdd-ssd-nvme/",
      "https://web.archive.org/web/20260422003822id_/https://cr0x.net/en/zfs-iscsi-zvol-no-stutter/",
      "https://web.archive.org/web/20260417044855id_/https://cr0x.net/en/zfs-l2arc-cache-nothing/",
      "https://web.archive.org/web/20260417044856id_/https://cr0x.net/en/zfs-l2arc-on-nvme/",
      "https://web.archive.org/web/20260417044856id_/https://cr0x.net/en/zfs-l2arc-sata-ssd-worth-it/",
      "https://web.archive.org/web/20260417044856id_/https://cr0x.net/en/zfs-l2arc-sizing-small-wins/",
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-l2arc-ssd-cache/",
      "https://web.archive.org/web/20260613115512id_/https://cr0x.net/en/zfs-logbias-latency-throughput/",
      "https://web.archive.org/web/20260417050520id_/https://cr0x.net/en/zfs-lz4-compression-free-or-not/",
      "https://web.archive.org/web/20260311085537id_/https://cr0x.net/en/zfs-media-big-records-compression/",
      "https://web.archive.org/web/20260407151518id_/https://cr0x.net/en/zfs-metadata-only-reads-special-vdev/",
      "https://web.archive.org/web/20260417045502id_/https://cr0x.net/en/zfs-mirrors-random-io/",
      "https://web.archive.org/web/20260406175104id_/https://cr0x.net/en/zfs-mountpoint-mount-trap/",
      "https://web.archive.org/web/20260714150651id_/https://cr0x.net/en/zfs-mysql-write-burst-latency/",
      "https://web.archive.org/web/20260406175104id_/https://cr0x.net/en/zfs-no-space-left-lies/",
      "https://web.archive.org/web/20260618071943id_/https://cr0x.net/en/zfs-nvme-pool-latency-irqs-limits/",
      "https://web.archive.org/web/20260417045502id_/https://cr0x.net/en/zfs-partitions-thinking/",
      "https://web.archive.org/web/20260310191510id_/https://cr0x.net/en/zfs-pool-wont-import-fix-path/",
      "https://web.archive.org/web/20260317183415id_/https://cr0x.net/en/zfs-primarycache-arc-caching-rules/",
      "https://web.archive.org/web/20260222111125id_/https://cr0x.net/en/zfs-quota-vs-reservation/",
      "https://web.archive.org/web/20260422003833id_/https://cr0x.net/en/zfs-raidz2-sweet-spot/",
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-recordsize-compression-math/",
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-recordsize-file-performance/",
      "https://web.archive.org/web/20260417045502id_/https://cr0x.net/en/zfs-recordsize-migration-strategy/",
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-resilver-rebuild-speedup/",
      "https://web.archive.org/web/20260310105513id_/https://cr0x.net/en/zfs-scrub-silent-corruption/",
      "https://web.archive.org/web/20260406175105id_/https://cr0x.net/en/zfs-send-receive-dr-drill/",
      "https://web.archive.org/web/20260406175104id_/https://cr0x.net/en/zfs-send-stream-compatibility/",
      "https://web.archive.org/web/20260714150634id_/https://cr0x.net/en/zfs-sequential-read-throughput-tuning/",
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-sequential-resilver-speed/",
      "https://web.archive.org/web/20260613184228id_/https://cr0x.net/en/zfs-slog-sizing-how-much/",
      "https://web.archive.org/web/20260618071954id_/https://cr0x.net/en/zfs-slop-space-pools-feel-full/",
      "https://web.archive.org/web/20260407151518id_/https://cr0x.net/en/zfs-smart-zfs-error-correlation/",
      "https://web.archive.org/web/20260406175104id_/https://cr0x.net/en/zfs-snapshot-deletion-wont-delete/",
      "https://web.archive.org/web/20260406175104id_/https://cr0x.net/en/zfs-snapshot-naming-system/",
      "https://web.archive.org/web/20260220164102id_/https://cr0x.net/en/zfs-space-accounting-du-vs-zfs/",
      "https://web.archive.org/web/20260406175104id_/https://cr0x.net/en/zfs-special-small-blocks/",
      "https://web.archive.org/web/20260407151518id_/https://cr0x.net/en/zfs-special-vdev-failure-survival/",
      "https://web.archive.org/web/20260626142322id_/https://cr0x.net/en/zfs-special-vdev-metadata/",
      "https://web.archive.org/web/20260407151507id_/https://cr0x.net/en/zfs-special-vdev-sizing/",
      "https://web.archive.org/web/20260417045502id_/https://cr0x.net/en/zfs-ssd-pool-gc-collapse/",
      "https://web.archive.org/web/20260317183415id_/https://cr0x.net/en/zfs-sync-fast-or-unsafe/",
      "https://web.archive.org/web/20260313065043id_/https://cr0x.net/en/zfs-vdev-imbalance-slowest-vdev/",
      "https://web.archive.org/web/20260406175104id_/https://cr0x.net/en/zfs-vdev-removal-limits/",
      "https://web.archive.org/web/20260324205937id_/https://cr0x.net/en/zfs-vs-btrfs-snapshots-raid-recovery/",
      "https://web.archive.org/web/20260422003832id_/https://cr0x.net/en/zfs-vs-btrfs-where-it-hurts/",
      "https://web.archive.org/web/20260417050520id_/https://cr0x.net/en/zfs-vs-mdadm-mdraid-wins-loses/",
      "https://web.archive.org/web/20260311173407id_/https://cr0x.net/en/zfs-vs-storage-spaces-opaque/",
      "https://web.archive.org/web/20260407151518id_/https://cr0x.net/en/zfs-when-to-add-special-vdev/",
      "https://web.archive.org/web/20260309125903id_/https://cr0x.net/en/zfs-zpool-upgrade-when-to-wait/",
      "https://web.archive.org/web/20260417050510id_/https://cr0x.net/en/zfs-zstd-compression-levels/",
    ],
  }),

  // ─── Btrfs ─────────────────────────────────────────────────────

  // TOC — btrfs-progs Documentation/ is .rst; readthedocs sitemap only
  // lists version index pages, so we scrape the Sphinx index for the
  // full per-page list.
  new DocSource({
    name: "btrfs",
    type: "http",
    url: "https://btrfs.readthedocs.io/en/latest/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://btrfs.readthedocs.io/en/latest/",
    urlPattern: "btrfs\\.readthedocs\\.io/en/latest/",
    urlExclude: "(genindex|search\\.html|_static/|_sources/|#)",
  }),

  // ─── Linux Kernel Filesystems ──────────────────────────────────

  // TOC — covers xfs, ntfs/ntfs3, ext4, f2fs, btrfs (kernel-side), tmpfs,
  // fuse, overlayfs, etc. docs.kernel.org has no sitemap; the filesystems
  // index page lists all per-filesystem HTML files.
  new DocSource({
    name: "linux-fs",
    type: "http",
    url: "https://docs.kernel.org/filesystems/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://docs.kernel.org/filesystems/index.html",
    urlPattern: "docs\\.kernel\\.org/filesystems/",
    urlExclude: "(genindex|search\\.html|_static/|_sources/|#)",
  }),

  // ─── Samba ─────────────────────────────────────────────────────

  // MediaWiki — wiki.samba.org has the canonical setup/AD-DC/file-server
  // guides; project source-tree docs are XML manpages.
  new DocSource({
    name: "samba",
    type: "http",
    url: "https://wiki.samba.org/index.php/",
    format: "html",
    discovery: "mediawiki",
    discoveryUrl: "https://wiki.samba.org/api.php",
    urlPattern: "wiki\\.samba\\.org/index\\.php/",
    urlExclude:
      "(Special:|Talk:|User:|File:|Template:|Category:|Help:|MediaWiki:|SambaWiki:)",
  }),

  // ─── restic ────────────────────────────────────────────────────

  // TOC — fast, encrypted, deduplicating backup program. Repo doc/ is
  // .rst; readthedocs sitemap only lists per-version index pages, so
  // we scrape the Sphinx index for per-page URLs.
  new DocSource({
    name: "restic",
    type: "http",
    url: "https://restic.readthedocs.io/en/stable/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://restic.readthedocs.io/en/stable/",
    urlPattern: "restic\\.readthedocs\\.io/en/stable/",
    urlExclude: "(genindex|search\\.html|_static/|_sources/|#)",
  }),

  // ─── BorgBackup ────────────────────────────────────────────────

  // TOC — deduplicating archiver with compression + authenticated
  // encryption. Repo docs/ is .rst; same readthedocs sitemap limitation
  // as restic, so we use the Sphinx index.
  new DocSource({
    name: "borgbackup",
    type: "http",
    url: "https://borgbackup.readthedocs.io/en/stable/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://borgbackup.readthedocs.io/en/stable/",
    urlPattern: "borgbackup\\.readthedocs\\.io/en/stable/",
    urlExclude: "(genindex|search\\.html|_static/|_sources/|#)",
  }),

  // ─── Servarr (*arr stack) ──────────────────────────────────────

  // Servarr Wiki — unified MkDocs source for Sonarr, Radarr, Lidarr,
  // Readarr, Prowlarr, Whisparr + the shared 'servarr' platform docs.
  new DocSource({
    name: "servarr",
    type: "git",
    url: "https://github.com/Servarr/Wiki",
    format: "markdown",
    paths: ["servarr", "sonarr", "radarr", "lidarr", "readarr", "prowlarr", "whisparr"],
  }),

  // ─── TRaSH-Guides ──────────────────────────────────────────────

  // MkDocs source - canonical quality-profile / custom-format / hardlink
  // guides for the *arr stack (~90MB repo, docs/ tree is markdown).
  // `includes/` (repo root) is sparse-checked out too: the docs reference
  // it via `--8<--` and `{! include-markdown !}` directives, and
  // `resolveTrashGuides` inlines them during ingest.
  new DocSource({
    name: "trash-guides",
    type: "git",
    url: "https://github.com/TRaSH-Guides/Guides",
    format: "markdown",
    paths: ["docs", "includes"],
    rootPath: "docs",
    resolveTrashGuides: true,
  }),

  // ─── Recyclarr ─────────────────────────────────────────────────

  // CLI that syncs TRaSH-Guides config into Sonarr/Radarr. docs/ tree
  // has architecture, decisions, reference sections.
  new DocSource({
    name: "recyclarr",
    type: "git",
    url: "https://github.com/recyclarr/recyclarr",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Bazarr ────────────────────────────────────────────────────

  // GitHub wiki — subtitle automation for Sonarr/Radarr libraries.
  new DocSource({
    name: "bazarr",
    type: "git",
    url: "https://github.com/morpheus65535/bazarr.wiki",
    format: "markdown",
  }),

  // ─── Jellyfin ──────────────────────────────────────────────────

  // Docusaurus source for jellyfin.org (the previous jellyfin-docs
  // repo is archived; jellyfin.org is the live source).
  new DocSource({
    name: "jellyfin",
    type: "git",
    url: "https://github.com/jellyfin/jellyfin.org",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Overseerr ─────────────────────────────────────────────────

  // In-tree docs/ for the Plex-native request manager (markdown).
  new DocSource({
    name: "overseerr",
    type: "git",
    url: "https://github.com/sct/overseerr",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Jellyseerr ────────────────────────────────────────────────

  // Jellyfin/Emby-native Overseerr fork; in-tree docs/ mixes .mdx + .md.
  new DocSource({
    name: "jellyseerr",
    type: "git",
    url: "https://github.com/fallenbagel/jellyseerr",
    format: "mdx",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // --- *arr API specs ----------------------------------------------------

  // OpenAPI 3.0 JSON, auto-generated from C# controllers.

  // Sonarr V3 API - tv show management.
  new DocSource({
    name: "sonarr-api-v3",
    type: "http",
    url: "https://sonarr.tv/docs/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json",
  }),

  // Sonarr V5 API - tv show management (v5-only endpoints).
  new DocSource({
    name: "sonarr-api-v5",
    type: "http",
    url: "https://sonarr.tv/docs/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/Sonarr/Sonarr/v5-develop/src/Sonarr.Api.V5/openapi.json",
  }),

  // Radarr API - movie collection management.
  new DocSource({
    name: "radarr-api",
    type: "http",
    url: "https://radarr.video/docs/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json",
  }),

  // Lidarr API - music collection management.
  new DocSource({
    name: "lidarr-api",
    type: "http",
    url: "https://lidarr.audio/docs/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json",
  }),

  // Readarr API - book/audiobook collection management.
  new DocSource({
    name: "readarr-api",
    type: "http",
    url: "https://readarr.com/docs/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/Readarr/Readarr/develop/src/Readarr.Api.V1/openapi.json",
  }),

  // Prowlarr API - indexer/tracker management.
  new DocSource({
    name: "prowlarr-api",
    type: "http",
    url: "https://prowlarr.com/docs/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/Prowlarr/Prowlarr/develop/src/Prowlarr.Api.V1/openapi.json",
  }),

  // Whisparr API - adult content management.
  new DocSource({
    name: "whisparr-api",
    type: "http",
    url: "https://whisparr.com/docs/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/Whisparr/Whisparr/develop/src/Whisparr.Api.V3/openapi.json",
  }),

  // --- Infrastructure APIs --------------------------------------------------

  // Grafana HTTP API - Swagger 2.0 JSON, merged from go-swagger annotations.
  // Covers datasources, dashboards, folders, teams, users, orgs, alerts, annotations.
  new DocSource({
    name: "grafana-api",
    type: "http",
    url: "https://grafana.com/docs/grafana/latest/developers/http_api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/grafana/grafana/main/public/api-merged.json",
  }),

  // Prometheus HTTP API - OpenAPI 3.1 YAML, golden file from testdata.
  // Covers query, query_range, metadata, labels, series, targets, rules, alerts, status, admin.
  new DocSource({
    name: "prometheus-api",
    type: "http",
    url: "https://prometheus.io/docs/prometheus/latest/querying/api/",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://raw.githubusercontent.com/prometheus/prometheus/main/web/api/v1/testdata/openapi_3.1_golden.yaml",
  }),

  // Tailscale REST API - OpenAPI 3.x, served live by the Tailscale API.
  // Covers devices, DNS, keys, logging, ACL policy, invites, tailnet management.
  new DocSource({
    name: "tailscale-api",
    type: "http",
    url: "https://tailscale.com/api",
    format: "openapi",
    discovery: "openapi",
    discoveryUrl: "https://api.tailscale.com/api/v2?outputOpenapiSchema=true",
  }),

  // --- More tools & docs -------------------------------------------------

  // Helix editor - mdBook markdown in book/src/ (summary, commands, config, keymap).
  new DocSource({
    name: "helix",
    type: "git",
    url: "https://github.com/helix-editor/helix",
    format: "markdown",
    paths: ["book/src"],
    rootPath: "book/src",
  }),

  // Transmission - markdown docs in docs/ (RPC spec, building, config, blocklists).
  new DocSource({
    name: "transmission",
    type: "git",
    url: "https://github.com/transmission/transmission",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // Navidrome - Hugo/Docusaurus website (Subsonic-compatible music server docs).
  new DocSource({
    name: "navidrome",
    type: "git",
    url: "https://github.com/navidrome/website",
    format: "markdown",
    paths: ["content"],
    rootPath: "content",
  }),

  // --- qBittorrent --------------------------------------------------------

  // GitHub wiki - BitTorrent client setup, Web UI API, search plugins.
  new DocSource({
    name: "qbittorrent",
    type: "git",
    url: "https://github.com/qbittorrent/qBittorrent.wiki",
    format: "markdown",
  }),

  // ─── SABnzbd ───────────────────────────────────────────────────

  // Jekyll source for sabnzbd.org — wiki/ subdir holds the canonical
  // setup/configuration/scripts docs.
  new DocSource({
    name: "sabnzbd",
    type: "git",
    url: "https://github.com/sabnzbd/sabnzbd.github.io",
    format: "markdown",
    paths: ["wiki"],
    rootPath: "wiki",
  }),

  // ─── Gluetun ───────────────────────────────────────────────────

  // VPN container commonly fronting the *arr stack. Whole wiki repo
  // (setup/, faq/, errors/, contributing/).
  new DocSource({
    name: "gluetun",
    type: "git",
    url: "https://github.com/qdm12/gluetun-wiki",
    format: "markdown",
  }),

  // ─── ntfy ──────────────────────────────────────────────────────

  // Pub/sub push-notification service (HTTP POST → phone/desktop).
  // Site docs.ntfy.sh is mkdocs material — no llms.txt / sitemap —
  // but docs/ in the upstream repo is canonical markdown.
  new DocSource({
    name: "ntfy",
    type: "git",
    url: "https://github.com/binwiederhier/ntfy",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── slskd ─────────────────────────────────────────────────────

  // Modern client-server daemon for the Soulseek file-sharing network
  // (the headless counterpart to the closed-source SoulseekQt client).
  // No site docs / llms.txt / sitemap — docs/ in the upstream repo is
  // the canonical source (config, docker, relay, reverse-proxy, vpn).
  new DocSource({
    name: "slskd",
    type: "git",
    url: "https://github.com/slskd/slskd",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Liftosaur ─────────────────────────────────────────────────

  // Open-source weightlifting tracker PWA driven by Liftoscript, a
  // JavaScript-like DSL for describing workout programs / progressions.
  // No site llms.txt / sitemap — but the repo carries two canonical
  // markdown trees:
  //   docs/content/ — the published docs (liftoscript, REST api, mcp)
  //   llms/         — LLM-targeted reference (condensed Liftoscript ref,
  //                   worked examples, built-in exercise list)
  // Both are pulled; the subdir prefix keeps the tutorial docs distinct
  // from the LLM reference and avoids the liftoscript.md name collision.
  new DocSource({
    name: "liftosaur",
    type: "git",
    url: "https://github.com/astashov/liftosaur",
    format: "markdown",
    paths: ["docs/content", "llms"],
    description:
      "Liftosaur weightlifting tracker — Liftoscript DSL, REST API, MCP server, exercise reference",
  }),

  // ─── Smart home / IoT ──────────────────────────────────────────

  // Home Assistant - the git repo keeps content as Jekyll .markdown
  // files (outside the git ingestor's .md/.mdx walk), so the working
  // route is the flat 4040-URL sitemap on the server-rendered site.
  // urlPattern keeps the doc corpus (integrations + actions/triggers/
  // conditions/template-functions references + guides), drops the
  // 633-post blog and marketing pages (~3.3k pages remain).
  new DocSource({
    name: "home-assistant",
    type: "http",
    url: "https://www.home-assistant.io/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://www.home-assistant.io/sitemap.xml",
    urlPattern:
      "home-assistant\\.io/(integrations|actions|template-functions|triggers|conditions|docs|dashboards|more-info|faq|voice_control|installation|getting-started|common-tasks|help|cloud)/",
    pageConcurrency: 8, // 15-wide burst trips fetch timeouts on Netlify
    deadlineMs: 1_800_000, // ~3.3k pages blow the 10-min default
  }),

  // Zigbee2MQTT - VuePress site sourced from the repo's docs/ tree:
  // hand-written guides (guide/, advanced/) plus ~5.2k generated
  // per-device pairing/config pages (devices/). All markdown.
  new DocSource({
    name: "zigbee2mqtt",
    type: "git",
    url: "https://github.com/Koenkk/zigbee2mqtt.io",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // Z-Wave JS - the reference open Z-Wave stack (and the driver behind
  // Home Assistant's Z-Wave integration). Monorepo; docs/ is the whole
  // published site corpus (~135 markdown pages).
  new DocSource({
    name: "zwave-js",
    type: "git",
    url: "https://github.com/zwave-js/zwave-js",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ESPHome - Astro site; content lives as MDX under src/content/docs
  // (~837 pages: components, guides, cookbook). Repo was renamed from
  // esphome/esphome-docs; default branch is `current`.
  new DocSource({
    name: "esphome",
    type: "git",
    url: "https://github.com/esphome/esphome.io",
    format: "mdx",
    paths: ["src/content/docs"],
    rootPath: "src/content/docs",
  }),

  // Matter (CSA / Project CHIP) - docs/ tree of the connectedhomeip
  // monorepo: getting-started, guides, cluster/device-type dev, testing
  // (~196 markdown pages). Sparse checkout keeps the giant repo cheap.
  new DocSource({
    name: "matter",
    type: "git",
    url: "https://github.com/project-chip/connectedhomeip",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // OpenThread - the open Thread implementation; ot-docs is the
  // openthread.io site source (guides/codelabs/reference, ~62 markdown
  // pages under site/en; zh-cn translation dropped).
  new DocSource({
    name: "openthread",
    type: "git",
    url: "https://github.com/openthread/ot-docs",
    format: "markdown",
    paths: ["site/en"],
    rootPath: "site/en",
  }),

  // Athom (ESPHome/Tasmota pre-flashed devices) - Wix store whose
  // product pages double as the device docs (specs, GPIO pinouts,
  // setup steps), server-rendered so plain fetch works. The Wix
  // sitemap index lists them under /blank-1/ (~127 pages) plus the
  // per-protocol category pages. Wix pages are ~2.3MB of HTML each,
  // so keep the burst modest.
  new DocSource({
    name: "athom",
    type: "http",
    url: "https://www.athom.tech/",
    format: "html",
    discovery: "sitemap-index",
    discoveryUrl: "https://www.athom.tech/sitemap.xml",
    urlPattern:
      "athom\\.tech/(blank-1|esphome|wled|tasmota|bthome|zigbee|homekit|home-bridge)",
    pageConcurrency: 6,
  }),

  // AirGradient - open-hardware air-quality monitors. Docs are the
  // /documentation/ tree (build instructions + ~36 KB articles) on the
  // server-rendered Kirby site; no sitemap, so harvest the listing
  // page's hrefs. Bare /documentation/ (the listing itself) is dropped
  // by the urlPattern requiring a subpath.
  new DocSource({
    name: "airgradient",
    type: "http",
    url: "https://www.airgradient.com/documentation/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://www.airgradient.com/documentation/",
    urlPattern: "airgradient\\.com/documentation/[a-z0-9-]+/",
  }),

  // ─── S3-compatible object storage (MinIO alternatives) ─────────

  // Silo (pgsty/silo) - community-maintained MinIO fork. The docs site
  // carries BOTH the fork-specific pages (migration, compatibility audit,
  // manifesto, release notes) AND a full mirror of the MinIO server docs
  // tree (/administration, /operations, /reference, ...), which also covers
  // the "minio" content since min.io's own docs went AIStor-only. Every
  // page serves clean markdown at <url>/index.md (text/markdown), so we
  // harvest the /docs/ sidebar TOC and append the suffix (preNormalised
  // path, Turndown bypassed). baseUrl is the site ROOT (not /docs/)
  // because the sidebar links are root-absolute (/administration/...)
  // and toc filters harvested URLs to those under baseUrl. /_print/ is
  // the docsy print view (full duplicate), /zh/ the Chinese mirror.
  new DocSource({
    name: "silo",
    type: "http",
    url: "https://silo.pgsty.com/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://silo.pgsty.com/docs/",
    urlPattern: "silo\\.pgsty\\.com/",
    urlExclude: "(_print/|/zh/|/tags/|/categories/|favicon|\\.xml)",
    urlSuffix: "/index.md",
  }),

  // Garage (Deuxfleurs) - geo-distributed S3 store. Website documentation
  // is built from doc/book/ in the repo (Gitea; default branch is main-v2,
  // which plain clone follows).
  new DocSource({
    name: "garage",
    type: "git",
    url: "https://git.deuxfleurs.fr/Deuxfleurs/garage",
    format: "markdown",
    paths: ["doc/book"],
    rootPath: "doc/book",
  }),

  // SeaweedFS - docs live in the GitHub wiki (separate cloneable repo).
  new DocSource({
    name: "seaweedfs",
    type: "git",
    url: "https://github.com/seaweedfs/seaweedfs.wiki",
    format: "markdown",
  }),

  // RustFS - MinIO-clone in Rust. Fumadocs site; English content tree only
  // (de/fr/ja/zh siblings dropped).
  new DocSource({
    name: "rustfs",
    type: "git",
    url: "https://github.com/rustfs/docs.rustfs.com",
    format: "markdown",
    paths: ["content/en"],
    rootPath: "content/en",
  }),

  // Versity S3 Gateway - S3 facade over POSIX/other backends. Docs live in
  // the GitHub wiki (POSIX versioning design, terraform-backend notes, ...).
  new DocSource({
    name: "versitygw",
    type: "git",
    url: "https://github.com/versity/versitygw.wiki",
    format: "markdown",
  }),

  // Ceph RADOS Gateway - the broadest S3 API coverage of the self-hosted
  // set (versioning, object lock, policies, SSE). Sphinx dirhtml site;
  // scrape the radosgw section only (full Ceph docs are out of scope).
  new DocSource({
    name: "ceph-rgw",
    type: "http",
    url: "https://docs.ceph.com/en/latest/radosgw/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://docs.ceph.com/en/latest/radosgw/",
    urlPattern: "docs\\.ceph\\.com/en/latest/radosgw/",
    urlExclude: "(_static/|_sources/|genindex|search)",
  }),

  // ─── Data residency / sovereignty law, per Supabase region ──────
  //
  // Primary data-protection statutes (plus residency-adjacent material)
  // for every jurisdiction Supabase lets a user deploy a project to.
  // Jurisdiction list verified against the region enum in
  // supabase/supabase packages/shared-data/regions.ts (17 AWS regions:
  // 4x US, ca-central-1, eu-west-1/2/3, eu-central-1/2, eu-north-1,
  // ap-south-1, ap-southeast-1/2, ap-northeast-1/2, sa-east-1).
  //
  // Several official sources are unfetchable directly (AWS WAF JS
  // challenge: eur-lex.europa.eu, legislation.gov.uk; bot-blocked:
  // legifrance.gouv.fr; geo/egress-blocked from the fetcher: codes.ohio.gov)
  // so those come from Wayback Machine raw captures (the `id_` suffix
  // serves the original bytes without the Wayback toolbar). Statute text
  // changes slowly, so a pinned capture is acceptable - the capture date
  // is in the URL. Wayback rate-limits aggressively, hence the low
  // pageConcurrency and raised requestTimeoutMs on sources using it.

  // US regions (us-west-1 CA, us-west-2 OR, us-east-1 VA, us-east-2 OH).
  // No federal comprehensive privacy law exists; these are the four
  // states' statutes. Ohio has NO comprehensive consumer privacy law
  // (HB 376/HB 345 both died in committee) - ORC Chapter 1354 is the
  // 2018 Data Protection Act, a cybersecurity safe-harbor law, included
  // as the adjacent Ohio material. Oregon's official oregonlegislature.gov
  // blocks the fetcher network, so OCPA comes from oregon.public.law
  // (unofficial but current and complete, sections 646A.570-.589).
  new DocSource({
    name: "privacy-laws-us",
    type: "http",
    url: "https://law.lis.virginia.gov/",
    format: "html",
    description:
      "US state privacy laws for Supabase US regions: CCPA/CPRA (California), VCDPA (Virginia), OCPA (Oregon), Ohio ORC ch. 1354 cybersecurity safe harbor (Ohio has no comprehensive consumer privacy law)",
    urls: [
      // California - CCPA as amended by CPRA (Civ. Code title 1.81.5)
      "https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?division=3.&part=4.&lawCode=CIV&title=1.81.5",
      // Virginia - Consumer Data Protection Act (Va. Code ch. 53)
      "https://law.lis.virginia.gov/vacodefull/title59.1/chapter53/",
      // Ohio - ORC Chapter 1354 (Data Protection Act, cyber safe harbor)
      "https://web.archive.org/web/2025id_/https://codes.ohio.gov/ohio-revised-code/chapter-1354",
      "https://web.archive.org/web/20211015053417id_/https://codes.ohio.gov/ohio-revised-code/section-1354.01",
      "https://web.archive.org/web/20210702183838id_/https://codes.ohio.gov/ohio-revised-code/section-1354.02",
      "https://web.archive.org/web/20211015060427id_/https://codes.ohio.gov/ohio-revised-code/section-1354.03",
      "https://web.archive.org/web/20211015061619id_/https://codes.ohio.gov/ohio-revised-code/section-1354.04",
      "https://web.archive.org/web/20211015060309id_/https://codes.ohio.gov/ohio-revised-code/section-1354.05",
      // Oregon - Consumer Privacy Act (ORS 646A.570-646A.589)
      "https://oregon.public.law/statutes/ors_646a.570",
      "https://oregon.public.law/statutes/ors_646a.571",
      "https://oregon.public.law/statutes/ors_646a.572",
      "https://oregon.public.law/statutes/ors_646a.573",
      "https://oregon.public.law/statutes/ors_646a.574",
      "https://oregon.public.law/statutes/ors_646a.575",
      "https://oregon.public.law/statutes/ors_646a.576",
      "https://oregon.public.law/statutes/ors_646a.577",
      "https://oregon.public.law/statutes/ors_646a.578",
      "https://oregon.public.law/statutes/ors_646a.579",
      "https://oregon.public.law/statutes/ors_646a.580",
      "https://oregon.public.law/statutes/ors_646a.581",
      "https://oregon.public.law/statutes/ors_646a.582",
      "https://oregon.public.law/statutes/ors_646a.583",
      "https://oregon.public.law/statutes/ors_646a.584",
      "https://oregon.public.law/statutes/ors_646a.585",
      "https://oregon.public.law/statutes/ors_646a.586",
      "https://oregon.public.law/statutes/ors_646a.587",
      "https://oregon.public.law/statutes/ors_646a.588",
      "https://oregon.public.law/statutes/ors_646a.589",
    ],
    pageConcurrency: 3,
    requestTimeoutMs: 60_000,
  }),

  // Canada (ca-central-1 is in Montreal): federal PIPEDA applies everywhere,
  // Quebec's Law 25 (modernized private-sector act, P-39.1) is the
  // provincial statute with real residency teeth.
  new DocSource({
    name: "privacy-laws-canada",
    type: "http",
    url: "https://laws-lois.justice.gc.ca/",
    format: "html",
    description:
      "Canadian data protection law for the Supabase ca-central-1 region: PIPEDA (federal) and Quebec Law 25 (Act respecting the protection of personal information in the private sector)",
    urls: [
      "https://laws-lois.justice.gc.ca/eng/acts/P-8.6/FullText.html",
      "https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1",
    ],
    // legisquebec.gouv.qc.ca 403s the docs-ssh UA (browser UA passes).
    userAgent: BROWSER_UA,
  }),

  // Europe regions: eu-west-1 (Ireland), eu-west-2 (London), eu-west-3
  // (Paris), eu-central-1 (Frankfurt), eu-central-2 (Zurich), eu-north-1
  // (Stockholm). GDPR is the superset instrument; the rest are national
  // implementing/supplementing acts. Language caveats: France and Sweden
  // publish French/Swedish only; Germany's BDSG and Switzerland's FADP
  // are official English translations (fedlex marks EN as non-binding).
  // France's capture is the 2021 consolidated text (later amendments not
  // reflected). legislation.gov.uk `data.htm` = whole-act single page.
  new DocSource({
    name: "privacy-laws-europe",
    type: "http",
    url: "https://www.irishstatutebook.ie/",
    format: "html",
    description:
      "European data protection law for Supabase EU/UK/CH regions: EU GDPR, UK GDPR + UK DPA 2018, Ireland DPA 2018, Germany BDSG, France Loi Informatique et Libertes, Sweden Dataskyddslagen, Switzerland FADP",
    urls: [
      // EU GDPR (Regulation 2016/679)
      "https://web.archive.org/web/2024id_/https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679",
      // UK GDPR (retained EU law version) + Data Protection Act 2018
      "https://web.archive.org/web/2025id_/https://www.legislation.gov.uk/eur/2016/679/data.htm",
      "https://web.archive.org/web/2025id_/https://www.legislation.gov.uk/ukpga/2018/12/data.htm",
      // Ireland - Data Protection Act 2018
      "https://www.irishstatutebook.ie/eli/2018/act/7/enacted/en/html",
      // Germany - BDSG (official English translation)
      "https://www.gesetze-im-internet.de/englisch_bdsg/englisch_bdsg.html",
      // France - Loi 78-17 Informatique et Libertes (French, 2021 capture)
      "https://web.archive.org/web/20210123054454id_/https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000886460/",
      // Sweden - Dataskyddslagen 2018:218 (Swedish). riksdagen.se has a
      // broken IPv6 route that hangs undici's fetch (curl -6 times out
      // too); rkrattsbaser.gov.se is the official government
      // consolidated-statute DB and fetches cleanly.
      "https://rkrattsbaser.gov.se/sfst?bet=2018:218",
      // Switzerland - revFADP (fedlex filestore, English translation,
      // in-force 2023-09-01 version; the /eli/cc/2022/491/en landing
      // page is a JS app, the filestore URL is the raw document)
      "https://www.fedlex.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/2022/491/20230901/en/html/fedlex-data-admin-ch-eli-cc-2022-491-20230901-en-html.html",
    ],
    pageConcurrency: 3,
    requestTimeoutMs: 60_000,
  }),

  // APAC regions: ap-south-1 (Mumbai), ap-southeast-1 (Singapore),
  // ap-southeast-2 (Sydney), ap-northeast-1 (Tokyo), ap-northeast-2
  // (Seoul). Caveats: India's DPDP Act 2023 has no official HTML full
  // text (egazette/indiacode are PDF/JS-only) - the PRS page is the
  // act summary + key provisions; Korea's KLRI English translation lags
  // the current statute (lawViewContent.do is the real content URL - the
  // lawView.do wrapper is an iframe shell); Australia's Privacy Act URL
  // pins the 2026-06-04 compilation (the /latest/ path serves a JS shell
  // - the dated epub-extracted HTML is the real text; old compilations
  // stay fetchable but lag future recompilations).
  new DocSource({
    name: "privacy-laws-apac",
    type: "http",
    url: "https://sso.agc.gov.sg/",
    format: "html",
    description:
      "APAC data protection law for Supabase APAC regions: India DPDP Act 2023 (PRS summary), Singapore PDPA, Japan APPI, South Korea PIPA, Australia Privacy Act 1988 + OAIC Australian Privacy Principles",
    urls: [
      // India - DPDP Act 2023 (summary + key provisions; full text is
      // PDF-only on egazette)
      "https://prsindia.org/billtrack/digital-personal-data-protection-bill-2023",
      // Singapore - Personal Data Protection Act 2012
      "https://sso.agc.gov.sg/Act/PDPA2012",
      // Japan - Act on the Protection of Personal Information (official
      // English translation)
      "https://www.japaneselawtranslation.go.jp/en/laws/view/4241",
      // South Korea - Personal Information Protection Act (KLRI English)
      "https://elaw.klri.re.kr/eng_service/lawViewContent.do?hseq=53044&lang=ENG",
      // Australia - Privacy Act 1988 (current compilation, full text incl.
      // Schedule 1 APPs) + OAIC regulator pages
      "https://www.legislation.gov.au/C2004A03712/2026-06-04/2026-06-04/text/original/epub/OEBPS/document_1/document_1.html",
      "https://www.oaic.gov.au/privacy/the-privacy-act",
      "https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-quick-reference",
    ],
    pageConcurrency: 3,
    requestTimeoutMs: 60_000,
    // sso.agc.gov.sg 403s the docs-ssh UA (browser UA passes).
    userAgent: BROWSER_UA,
  }),

  // Brazil (sa-east-1): LGPD, Lei 13.709/2018. planalto.gov.br publishes
  // Portuguese only; that is the authoritative text.
  new DocSource({
    name: "privacy-laws-brazil",
    type: "http",
    url: "https://www.planalto.gov.br/",
    format: "html",
    description:
      "Brazil LGPD (Lei 13.709/2018, Portuguese) - data protection law for the Supabase sa-east-1 region",
    urls: ["https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm"],
    // planalto.gov.br ECONNRESETs the docs-ssh UA (browser UA passes).
    userAgent: BROWSER_UA,
  }),

  // ─── GPU / NVIDIA ────────────────────────────────────────────
  //
  // NVAPI reference (Doxygen HTML). The function docs live as anchors
  // inside per-group pages (group__*.html), all linked from
  // topics.html; struct pages (structNV_*.html) are linked from
  // annotated.html. `toc` discovery scrapes one page, so this is two
  // sources: `nvapi` (functions/groups) and `nvapi-structs` (structs).
  // No sitemap exists under docs.nvidia.com/gameworks (404). Stable,
  // decade-old Doxygen output; plain HTML, no JS rendering needed.
  new DocSource({
    name: "nvapi",
    type: "http",
    url: "https://docs.nvidia.com/gameworks/content/gameworkslibrary/coresdk/nvapi/",
    format: "html",
    discovery: "toc",
    discoveryUrl:
      "https://docs.nvidia.com/gameworks/content/gameworkslibrary/coresdk/nvapi/topics.html",
    urlPattern: "coresdk/nvapi/",
    description: "NVAPI function reference (per-group Doxygen pages)",
  }),

  new DocSource({
    name: "nvapi-structs",
    type: "http",
    url: "https://docs.nvidia.com/gameworks/content/gameworkslibrary/coresdk/nvapi/",
    format: "html",
    discovery: "toc",
    discoveryUrl:
      "https://docs.nvidia.com/gameworks/content/gameworkslibrary/coresdk/nvapi/annotated.html",
    urlPattern: "coresdk/nvapi/",
    description: "NVAPI struct/enum reference (annotated Doxygen index)",
  }),

  // The official NVAPI SDK headers from GitHub (the repo's docs/ dir is
  // a CHM+PDF, not mirrorable). Ground truth for struct byte layouts and
  // MAKE_NVAPI_VERSION constants when writing bindings - the Doxygen
  // pages don't carry those. Root-level *.h files are the payload;
  // TxtNormaliser wraps them as fenced markdown (same path as ietf-rfc).
  // No sparse paths: cone-mode sparse-checkout always includes root
  // files anyway, and restricting scanRoots would drop them.
  new DocSource({
    name: "nvapi-headers",
    type: "git",
    url: "https://github.com/NVIDIA/nvapi",
    format: "txt",
    description: "NVAPI SDK C headers (nvapi.h, NvApiDriverSettings.h, ...)",
  }),

  // PenguinBurner - Linux NVIDIA undervolt/OC tool. Its docs/ markdown
  // covers the NVAPI shim, adaptive/auto undervolt, curve editor, and
  // Afterburner profile import. drivers/nvidia/hidden_nvapi_vf.py is the
  // reverse-engineered reference for the undocumented client VF-points
  // API (struct layouts the official headers omit) - mirrored as fenced
  // text via penguinburner-src alongside the Afterburner importers and
  // the C++ NVAPI shim.
  new DocSource({
    name: "penguinburner",
    type: "git",
    url: "https://github.com/jpietek/PenguinBurner",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
    description: "PenguinBurner docs (Linux NVIDIA UV/OC, nvapi-shim, adaptive-uv)",
  }),

  new DocSource({
    name: "penguinburner-src",
    type: "git",
    url: "https://github.com/jpietek/PenguinBurner",
    format: "txt",
    paths: [
      "drivers/nvidia",
      "integrations/afterburner",
      "overlay/native/nvapi_shim",
    ],
    description:
      "PenguinBurner binding reference (hidden NVAPI VF-points, Afterburner import, C++ shim)",
  }),

  // ─── AWS, sharded per service (kept last - slowest tier) ──────
  //
  // Each AWS service publishes its own llms.txt with .md page URLs.
  // We shard the umbrella 'aws' DocSource into per-service entries so
  // (a) one slow/broken service doesn't drag the whole AWS fetch over
  //     the per-source deadline,
  // (b) the regression guard runs per-service (s3 dropping by 50%
  //     trips even if the rest of AWS looks fine),
  // (c) agents can scope searches to one service:
  //     docs_search(query='cold start', source='aws-lambda').
  //
  // The previous umbrella source pulled ~14k pages through llms-index
  // discovery; sharding splits that into independent fetches.
  // ─── Akamai ────────────────────────────────────────────────────────
  //
  // techdocs.akamai.com (ReadMe.io) publishes a top-level llms.txt that
  // now enumerates ~982 child llms.txt files (product + section + category
  // indexes, all levels flattened) rather than pages directly - hence
  // llms-index discovery. The leaves list per-page `.md` URLs (~8-9k pages
  // before URL dedup) across every PUBLIC product (Property
  // Manager, App & API Protector, EdgeWorkers, Edge DNS, NetStorage,
  // Cloudlets, Linode/cloud-computing, PowerShell, Terraform, all API
  // references). The `.md` variants return clean markdown directly.
  //
  // GATED PRODUCTS ARE EXCLUDED BY UPSTREAM: Bot Manager, Account
  // Protector, and Content Protector render only behind a Control Center
  // login - anonymous fetch of e.g. /bot-manager/docs returns a 325-byte
  // SPA shell titled "Control Center", and they have no llms.txt/sitemap
  // entry. There is no anonymous mirror path for them. What public
  // bot/abuse material exists (terraform/docs/bmgr-*, cloud-security
  // about-bots, security-ctr bot-reports, edgeworkers botscore-object,
  // ~49 pages) is already inside this index and captured automatically.
  //
  // ~8-9k pages makes this the second-largest source after AWS, so it
  // sits in the slow tier and is throttled (pageConcurrency: 6) with a
  // generous 40-min deadline. urlPattern keeps only `.md` page URLs and
  // drops the two stray `.html` links + the index self-reference.
  new DocSource({
    name: "akamai",
    type: "http",
    url: "https://techdocs.akamai.com/",
    format: "markdown",
    discovery: "llms-index",
    discoveryUrl: "https://techdocs.akamai.com/llms.txt",
    urlPattern: "techdocs\\.akamai\\.com/.+\\.md$",
    pageConcurrency: 6,
    deadlineMs: 2_400_000,
  }),

  ...((): readonly DocSource[] => {
    type AwsShard = readonly [name: string, llmsPath: string];
    const shards: readonly AwsShard[] = [
      ["aws-lambda",          "lambda/latest/dg"],
      ["aws-s3",              "AmazonS3/latest/userguide"],
      ["aws-cloudfront",      "AmazonCloudFront/latest/DeveloperGuide"],
      ["aws-iam",             "IAM/latest/UserGuide"],
      ["aws-dynamodb",        "amazondynamodb/latest/developerguide"],
      ["aws-cloudformation",  "AWSCloudFormation/latest/UserGuide"],
      ["aws-vpc",             "vpc/latest/userguide"],
      ["aws-ec2",             "AWSEC2/latest/UserGuide"],
      ["aws-rds",             "AmazonRDS/latest/UserGuide"],
      ["aws-dms",             "dms/latest/userguide"],
      ["aws-aurora",          "AmazonRDS/latest/AuroraUserGuide"],
      ["aws-redshift",        "redshift/latest/dg"],
      ["aws-glue",            "glue/latest/dg"],
      ["aws-kinesis",         "streams/latest/dev"],
      ["aws-sqs",             "AWSSimpleQueueService/latest/SQSDeveloperGuide"],
      ["aws-sns",             "sns/latest/dg"],
      ["aws-ecs",             "AmazonECS/latest/developerguide"],
      ["aws-eks",             "eks/latest/userguide"],
      ["aws-secretsmanager",  "secretsmanager/latest/userguide"],
      ["aws-systems-manager", "systems-manager/latest/userguide"],
      ["aws-cognito",         "cognito/latest/developerguide"],
      ["aws-apigateway",      "apigateway/latest/developerguide"],
      ["aws-eventbridge",     "eventbridge/latest/userguide"],
      ["aws-step-functions",  "step-functions/latest/dg"],
      ["aws-waf",             "waf/latest/developerguide"],
      ["aws-elb",             "elasticloadbalancing/latest/userguide"],
    ];
    return shards.map(([name, p]) => new DocSource({
      name,
      type: "http",
      url: `https://docs.aws.amazon.com/${p}/`,
      format: "markdown",
      discovery: "llms-txt",
      discoveryUrl: `https://docs.aws.amazon.com/${p}/llms.txt`,
    }));
  })(),

  // AWS API — multi-spec OpenAPI from APIs-guru/openapi-directory.
  // Sparse-clones APIs/amazonaws.com, converts latest version of each
  // core service spec to per-tag markdown.
  new DocSource({
    name: "aws-api",
    type: "git",
    url: "https://github.com/APIs-guru/openapi-directory",
    format: "openapi",
    paths: ["APIs/amazonaws.com"],
    rootPath: "APIs/amazonaws.com",
    discovery: "openapi-dir",
    urlPattern:
      "^(lambda|s3|cloudfront|iam|dynamodb|cloudformation|ec2|rds|sqs|sns|ecs|eks|secretsmanager|apigateway|apigatewayv2|eventbridge|stepfunctions|wafv2|elasticloadbalancingv2|cognito-idp|cognito-identity)$",
  }),

  // ─── Azure ────────────────────────────────────────────────────────────────
  //
  // MicrosoftDocs publishes Azure documentation across several GitHub
  // repos as Markdown. We use blobless git sparse-checkout to pull only
  // the service subdirectory from each repo, so even repos like the
  // main azure-docs monorepo (27 GB history) are cheap to fetch.
  //
  // Services from the main azure-docs monorepo are fetched as ONE source
  // with multiple sparse-checkout paths. Sharding into per-service sources
  // caused 8 parallel blobless clones of the same repo which exhausted
  // GitHub's concurrency throttle and all failed after retries.
  new DocSource({
    name: "azure",
    type: "git",
    url: "https://github.com/MicrosoftDocs/azure-docs",
    format: "markdown",
    paths: [
      "articles/app-service",
      "articles/azure-functions",
      "articles/container-apps",
      "articles/storage",
      "articles/service-bus-messaging",
      "articles/event-hubs",
      "articles/event-grid",
      "articles/api-management",
    ],
    rootPath: "articles",
  }),

  // Azure Kubernetes Service — lives in its own repo.
  new DocSource({
    name: "azure-aks",
    type: "git",
    url: "https://github.com/MicrosoftDocs/azure-aks-docs",
    format: "markdown",
    paths: ["articles/aks"],
    rootPath: "articles/aks",
  }),

  // Azure Virtual Machines + Container Instances — azure-compute-docs repo.
  new DocSource({
    name: "azure-virtual-machines",
    type: "git",
    url: "https://github.com/MicrosoftDocs/azure-compute-docs",
    format: "markdown",
    paths: ["articles/virtual-machines"],
    rootPath: "articles/virtual-machines",
  }),

  new DocSource({
    name: "azure-container-instances",
    type: "git",
    url: "https://github.com/MicrosoftDocs/azure-compute-docs",
    format: "markdown",
    paths: ["articles/container-instances"],
    rootPath: "articles/container-instances",
  }),

  // Azure Key Vault — azure-security-docs repo.
  new DocSource({
    name: "azure-key-vault",
    type: "git",
    url: "https://github.com/MicrosoftDocs/azure-security-docs",
    format: "markdown",
    paths: ["articles/key-vault"],
    rootPath: "articles/key-vault",
  }),

  // Azure Monitor — azure-monitor-docs repo.
  new DocSource({
    name: "azure-monitor",
    type: "git",
    url: "https://github.com/MicrosoftDocs/azure-monitor-docs",
    format: "markdown",
    paths: ["articles/azure-monitor"],
    rootPath: "articles/azure-monitor",
  }),

  // Microsoft Entra (Azure Active Directory) — entra-docs repo.
  new DocSource({
    name: "azure-entra",
    type: "git",
    url: "https://github.com/MicrosoftDocs/entra-docs",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),

  // ─── Windows / PowerShell ─────────────────────────────────────────
  //
  // Same MicrosoftDocs-git pattern as the Azure sources above (blobless
  // sparse-checkout of markdown subtrees).

  // PowerShell - language + cmdlet reference + conceptual docs.
  // reference/<version>/ holds the per-module cmdlet pages for each
  // supported version (5.1, 7.4 LTS, 7.5, plus preview dirs); we take
  // only 7.5 (current stable) plus the version-agnostic docs-conceptual
  // tree so we don't mirror ~90%-duplicated cmdlet pages across versions.
  new DocSource({
    name: "powershell",
    type: "git",
    url: "https://github.com/MicrosoftDocs/PowerShell-Docs",
    format: "markdown",
    paths: ["reference/7.5", "reference/docs-conceptual"],
    rootPath: "reference",
  }),

  // WSL - Windows Subsystem for Linux. Docs live in the WSL/ dir at the
  // repo root (install, config, networking, enterprise, troubleshooting).
  new DocSource({
    name: "wsl",
    type: "git",
    url: "https://github.com/MicrosoftDocs/WSL",
    format: "markdown",
    paths: ["WSL"],
    rootPath: "WSL",
  }),

  // Windows Server - command-line reference (netsh + the full cmd.exe
  // command set under windows-commands/), TCP/IP and network-stack docs
  // (networking/), plus the small OpenSSH and performance-tuning admin
  // guides. All four subtrees are fetched as ONE source with multiple
  // sparse-checkout paths - sharding the same repo into per-subtree
  // sources exhausts GitHub's parallel-clone throttle (see Azure note).
  // Served paths keep the administration/... and networking/... prefixes.
  new DocSource({
    name: "windows-server",
    type: "git",
    url: "https://github.com/MicrosoftDocs/windowsserverdocs",
    format: "markdown",
    paths: [
      "WindowsServerDocs/administration/windows-commands",
      "WindowsServerDocs/administration/OpenSSH",
      "WindowsServerDocs/administration/performance-tuning",
      "WindowsServerDocs/networking",
    ],
    rootPath: "WindowsServerDocs",
  }),

  // ─── GCP API ─────────────────────────────────────────────────────
  //
  // GCP prose docs (cloud.google.com) have no llms.txt and no per-product
  // sitemap — the global sitemap-index covers 3.4M URLs across 180 child
  // sitemaps so it remains skipped.
  //
  // API reference: multi-spec OpenAPI from APIs-guru/openapi-directory.
  // Sparse-clones APIs/googleapis.com, converts the latest spec for each
  // core service to per-tag markdown (same pattern as aws-api).
  new DocSource({
    name: "gcp-api",
    type: "git",
    url: "https://github.com/APIs-guru/openapi-directory",
    format: "openapi",
    paths: ["APIs/googleapis.com"],
    rootPath: "APIs/googleapis.com",
    discovery: "openapi-dir",
    urlPattern:
      "^(run|storage|bigquery|container|pubsub|iam|cloudfunctions|sqladmin|compute|secretmanager|cloudbuild|cloudkms|logging|monitoring|spanner|firestore|artifactregistry)$",
  }),

  // ─── IETF RFC corpus ────────────────────────────────────────────
  //
  // All RFCs (plus BCP/FYI/IEN/STD subseries), ~10k plain-text files,
  // ~560MB. rsync is the RFC Editor's only sanctioned bulk channel (the
  // RFC-all tarball was retired); it is incremental, so daily refresh
  // transfers only new/changed RFCs against the work-dir cache.
  // RsyncIngestor fetches, TxtNormaliser converts .txt -> fenced .md.
  new DocSource({
    name: "ietf-rfc",
    type: "rsync",
    format: "txt",
    url: "rsync.rfc-editor.org::rfcs-text-only",
    tags: ["standards", "networking"],
    description: "IETF RFCs (full corpus, all series)",
  }),
];
