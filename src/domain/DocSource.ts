export type DocFormat = "markdown" | "mdx" | "html";
export type DocSourceType = "git" | "http";

/**
 * How to discover/fetch pages for an HTTP source:
 * - "none":          uses explicit source.urls list
 * - "tarball":       downloads a .tar.gz and extracts markdown files
 * - "llms-full":     downloads a single llms-full.txt and splits into per-page files
 * - "sitemap":       parses a single XML sitemap for <loc> entries
 * - "sitemap-index": parses a sitemap index, then fetches child sitemaps
 * - "toc":           scrapes href links from an HTML table-of-contents page
 * - "llms-index":    parses a top-level llms.txt for child llms.txt URLs, then uses those as TOCs
 */
export type DiscoveryMethod =
  | "none"
  | "tarball"
  | "llms-full"
  | "sitemap"
  | "sitemap-index"
  | "toc"
  | "llms-index";

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
  /** Regex pattern — only include URLs matching this */
  readonly urlPattern?: string;
  /** Regex pattern — exclude URLs matching this */
  readonly urlExclude?: string;
  /** Suffix to append to discovered URLs (e.g. ".md") */
  readonly urlSuffix?: string;
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
  readonly urlPattern: string | undefined;
  readonly urlExclude: string | undefined;
  readonly urlSuffix: string | undefined;

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
    this.urlPattern = config.urlPattern;
    this.urlExclude = config.urlExclude;
    this.urlSuffix = config.urlSuffix;
  }

  equals(other: DocSource): boolean {
    return this.name === other.name && this.url === other.url;
  }

  toString(): string {
    return `DocSource(${this.name}, ${this.type}, ${this.url})`;
  }
}
