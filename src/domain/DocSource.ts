export type DocFormat = "markdown" | "mdx" | "html" | "openapi" | "godoc" | "adoc" | "txt";
export type DocSourceType = "git" | "http" | "rsync";

/**
 * How to discover/fetch pages for an HTTP source:
 * - "none":          uses explicit source.urls list
 * - "tarball":       downloads a .tar.gz and extracts markdown files
 * - "texinfo":       downloads a GNU info .zip (texinfo manual) and splits into per-node markdown
 * - "llms-full":     downloads a single llms-full.txt and splits into per-page files
 * - "sitemap":       parses a single XML sitemap for <loc> entries
 * - "sitemap-index": parses a sitemap index, then fetches child sitemaps
 * - "toc":           scrapes href links from an HTML table-of-contents page
 * - "llms-index":    parses a top-level llms.txt for child llms.txt URLs, then uses those as TOCs
 * - "llms-txt":     parses a llms.txt for page URLs and fetches each one directly
 * - "rss":          parses an RSS feed for <link> URLs within <item> elements
 * - "dokuwiki":     BFS over a DokuWiki `?do=index` namespace tree (idx= links)
 * - "openapi":      downloads a single OpenAPI/Swagger spec and converts to per-tag markdown
 * - "openapi-dir":  git repo containing multiple OpenAPI specs in a directory structure
 * - "statuspage":   paginates an Atlassian Statuspage /history.json, then fetches each
 *                   /incidents/<code>.json and converts to one markdown file per incident
 */
export type DiscoveryMethod =
  | "none"
  | "tarball"
  | "texinfo"
  | "llms-full"
  | "sitemap"
  | "sitemap-index"
  | "toc"
  | "llms-index"
  | "llms-txt"
  | "rss"
  | "dokuwiki"
  | "openapi"
  | "openapi-dir"
  | "mediawiki"
  | "statuspage";

export interface DocSourceConfig {
  readonly name: string;
  readonly type: DocSourceType;
  readonly format: DocFormat;
  /** For git sources: the repo URL. For http: the base URL. */
  readonly url: string;
  /** For git sources: sparse-checkout paths within the repo */
  readonly paths?: readonly string[];
  /** For http sources: explicit list of URLs to fetch (overrides discovery) */
  readonly urls?: readonly string[];
  /** Subpath within the source to use as the root (strips prefix) */
  readonly rootPath?: string;
  /** How to discover pages */
  readonly discovery?: DiscoveryMethod;
  /** URL to discover pages from (sitemap, tarball, llms-full.txt, TOC page, etc) */
  readonly discoveryUrl?: string;
  /**
   * Mirror to try when discoveryUrl fails with a non-retryable status
   * (4xx). Used by mysql: Oracle's CDN 403s downloads.mysql.com from CI
   * runner and residential IP ranges, so the texinfo ingestor falls back
   * to a Wayback Machine capture of the info archive. Only consulted on
   * non-retryable failures - a stalled/timed-out primary retries instead,
   * since the fallback is usually a stale snapshot.
   */
  readonly fallbackDiscoveryUrl?: string;
  /** Regex pattern — only include URLs matching this */
  readonly urlPattern?: string;
  /** Regex pattern — exclude URLs matching this */
  readonly urlExclude?: string;
  /** Suffix to append to discovered URLs (e.g. ".md") */
  readonly urlSuffix?: string;
  /** Category tags for grouping in agent instructions and README (e.g. ["databases", "postgres-ecosystem"]) */
  readonly tags?: readonly string[];
  /** Short human-readable description for README table */
  readonly description?: string;
  /**
   * Resolve Supabase `<$Partial path="..." />` transclusion directives by
   * inlining `_partials/**` content into referencing pages, then drop the
   * partials from the served set. Only meaningful for the supabase source.
   */
  readonly resolvePartials?: boolean;
  /**
   * Override the global per-page fetch parallelism (http sources only).
   * Lower it for large scrapes on rate-limit-prone hosts (e.g.
   * cloudflare-blog) so 15-wide bursts don't trip the upstream's bot /
   * rate limiter and collapse the whole source to zero files. Falls back
   * to the shared CONCURRENCY constant when unset.
   */
  readonly pageConcurrency?: number;
  /**
   * Override the global per-source hard deadline (milliseconds). Raise it
   * for sources that are both large and deliberately throttled (lower
   * `pageConcurrency`), so the gentler fetch has time to finish before the
   * deadline aborts it. Falls back to UpdateDocSets' sourceDeadline default.
   */
  readonly deadlineMs?: number;
  /**
   * Override the global per-page request timeout (milliseconds). Raise it
   * for sources behind Cloudflare's Markdown-for-Agents: the on-the-fly
   * HTML->markdown conversion is synchronous and can exceed the default
   * 30s on multi-MB pages (verified: kea-messages.html takes ~61s).
   * Falls back to REQUEST_TIMEOUT when unset.
   */
  readonly requestTimeoutMs?: number;
  /**
   * Skip markdown content negotiation (http sources only). The fetcher
   * normally sends `Accept: text/markdown, text/html;q=0.9`; some origins'
   * WAFs hard-reject that header (verified: openvpn.net 503s every page
   * carrying it, 200s without). Set to fetch plain `text/html` instead.
   */
  readonly skipMarkdownNegotiation?: boolean;
  /**
   * Override the User-Agent sent for this source's page fetches (http
   * sources only). Some government legislation sites block non-browser
   * UAs at the WAF/TLS layer (verified: planalto.gov.br ECONNRESETs,
   * legisquebec.gouv.qc.ca and sso.agc.gov.sg 403 the docs-ssh UA; all
   * 200 with a browser UA). Falls back to the shared UA when unset.
   */
  readonly userAgent?: string;
  /**
   * BFS depth for `toc` discovery (http sources only). Default 1 = scrape
   * links off the single toc page. Raise to 2 when the toc page only links
   * section index pages that in turn link the actual doc pages (verified:
   * openzfs-docs /man/v2.4/ index links 5 section indexes, each of which
   * links its man pages; depth 1 found only 6 URLs). Bounded by an
   * internal 5000-visited-page cap.
   */
  readonly tocDepth?: number;
}

/**
 * Value object representing a documentation source.
 * Immutable — equality is by value.
 */
export class DocSource {
  readonly name: string;
  readonly type: DocSourceType;
  readonly format: DocFormat;
  readonly url: string;
  readonly paths: readonly string[];
  readonly urls: readonly string[];
  readonly rootPath: string | undefined;
  readonly discovery: DiscoveryMethod;
  readonly discoveryUrl: string | undefined;
  readonly fallbackDiscoveryUrl: string | undefined;
  readonly urlPattern: string | undefined;
  readonly urlExclude: string | undefined;
  readonly urlSuffix: string | undefined;
  readonly tags: readonly string[];
  readonly description: string | undefined;
  readonly resolvePartials: boolean;
  readonly pageConcurrency: number | undefined;
  readonly deadlineMs: number | undefined;
  readonly requestTimeoutMs: number | undefined;
  readonly skipMarkdownNegotiation: boolean | undefined;
  readonly userAgent: string | undefined;
  readonly tocDepth: number | undefined;

  constructor(config: DocSourceConfig) {
    if (!config.name || config.name.trim() === "") {
      throw new Error("DocSource: name must not be empty");
    }
    if (!config.url || config.url.trim() === "") {
      throw new Error("DocSource: url must not be empty");
    }
    this.name = config.name;
    this.type = config.type;
    this.format = config.format;
    this.url = config.url;
    this.paths = config.paths ?? [];
    this.urls = config.urls ?? [];
    this.rootPath = config.rootPath;
    this.discovery = config.discovery ?? "none";
    this.discoveryUrl = config.discoveryUrl;
    this.fallbackDiscoveryUrl = config.fallbackDiscoveryUrl;
    this.urlPattern = config.urlPattern;
    this.urlExclude = config.urlExclude;
    this.urlSuffix = config.urlSuffix;
    this.tags = config.tags ?? [];
    this.description = config.description;
    this.resolvePartials = config.resolvePartials ?? false;
    this.pageConcurrency = config.pageConcurrency;
    this.deadlineMs = config.deadlineMs;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.skipMarkdownNegotiation = config.skipMarkdownNegotiation;
    this.userAgent = config.userAgent;
    this.tocDepth = config.tocDepth;
  }

  equals(other: DocSource): boolean {
    return this.name === other.name && this.url === other.url;
  }

  toString(): string {
    return `DocSource(${this.name}, ${this.type}, ${this.url})`;
  }
}
