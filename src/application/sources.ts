import { DocSource } from "../domain/DocSource.js";

/**
 * Canonical definitions of all doc sources.
 *
 * Each source uses the best available fetch method:
 * - Supabase: official pre-built tarball (cleanest)
 * - Cloudflare: llms-full.txt (40MB full dump) + git repo for raw MDX
 * - Vercel: llms-full.txt (11MB full dump)
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

  // Blog — HTML pages from sitemap
  new DocSource({
    name: "supabase-blog",
    type: "http",
    url: "https://supabase.com/blog/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://supabase.com/sitemap_www.xml",
    urlPattern: "supabase\\.com/blog/.+",
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

  // Blog — HTML from sitemap
  new DocSource({
    name: "vercel-blog",
    type: "http",
    url: "https://vercel.com/blog/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://vercel.com/sitemap.xml",
    urlPattern: "vercel\\.com/blog/.+",
  }),

  // Changelog — HTML from sitemap
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
];
