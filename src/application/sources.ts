import { DocSource } from "../domain/DocSource.js";

/**
 * Canonical definitions of all doc sources.
 *
 * Each source uses the best available fetch method:
 * - Supabase: official pre-built tarball (cleanest)
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

  // Pre-built tarball — the same approach supabase.sh uses
  new DocSource({
    name: "supabase",
    type: "http",
    url: "https://supabase.com/docs/",
    format: "markdown",
    discovery: "tarball",
    discoveryUrl: "https://supabase.com/docs/docs.tar.gz",
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

  // Blog — HTML pages from sitemap
  new DocSource({
    name: "cloudflare-blog",
    type: "http",
    url: "https://blog.cloudflare.com/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://blog.cloudflare.com/sitemap-posts.xml",
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

  // Blog — each page supports .md suffix for clean markdown
  new DocSource({
    name: "vercel-blog",
    type: "http",
    url: "https://vercel.com/blog/",
    format: "markdown",
    discovery: "sitemap",
    discoveryUrl: "https://vercel.com/sitemap.xml",
    urlPattern: "vercel\\.com/blog/.+",
    urlSuffix: ".md",
  }),

  // Changelog — each page supports .md suffix for clean markdown
  new DocSource({
    name: "vercel-changelog",
    type: "http",
    url: "https://vercel.com/changelog/",
    format: "markdown",
    discovery: "sitemap",
    discoveryUrl: "https://vercel.com/sitemap.xml",
    urlPattern: "vercel\\.com/changelog/.+",
    urlSuffix: ".md",
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

  // ─── AWS ───────────────────────────────────────────────────────────

  // llms-index — uses the top-level llms.txt to find per-service llms.txt,
  // which list all HTML page URLs. Pre-filtered to core services.
  new DocSource({
    name: "aws",
    type: "http",
    url: "https://docs.aws.amazon.com/",
    format: "html",
    discovery: "llms-index",
    discoveryUrl: "https://docs.aws.amazon.com/llms.txt",
    urlPattern:
      "(lambda|AmazonS3|AmazonCloudFront|IAM|amazondynamodb|AWSCloudFormation|vpc|AWSEC2|AmazonRDS|AWSSimpleQueueService|sns|AmazonECS|eks|secretsmanager|systems-manager|cognito|apigateway|eventbridge|step-functions|waf|elasticloadbalancing)",
    urlExclude: "(de_de|ja_jp|zh_cn|fr_fr|ko_kr|es_es|pt_br|it_it|id_id|/APIReference/)",
  }),

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

  // llms-full.txt — complete documentation
  new DocSource({
    name: "astro",
    type: "http",
    url: "https://docs.astro.build/",
    format: "markdown",
    discovery: "llms-full",
    discoveryUrl: "https://docs.astro.build/llms-full.txt",
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

  // GCP: skipped — sitemap-index has 180 generic child sitemaps (3.4M URLs).
  // Revisit when cloud.google.com adds llms.txt or a scoped sitemap.
];
