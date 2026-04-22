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

  // ─── Docker ──────────────────────────────────────────────────────

  // llms.txt — TOC with ~400+ page links
  new DocSource({
    name: "docker",
    type: "http",
    url: "https://docs.docker.com/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://docs.docker.com/llms.txt",
  }),

  // ─── Shadcn/UI ─────────────────────────────────────────────────

  // llms.txt — component docs index
  new DocSource({
    name: "shadcn",
    type: "http",
    url: "https://ui.shadcn.com/docs/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://ui.shadcn.com/llms.txt",
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

  // ─── D2 ────────────────────────────────────────────────────────

  // Sitemap — D2 diagramming language docs (tour + examples)
  new DocSource({
    name: "d2",
    type: "http",
    url: "https://d2lang.com/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://d2lang.com/sitemap.xml",
    urlPattern: "d2lang\\.com/(tour|examples)/.+",
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

  // llms.txt — ultrafast web framework for CF Workers + Bun
  new DocSource({
    name: "hono",
    type: "http",
    url: "https://hono.dev/docs/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://hono.dev/llms.txt",
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

  // llms.txt — TypeScript ORM for Postgres/MySQL/SQLite
  new DocSource({
    name: "drizzle",
    type: "http",
    url: "https://orm.drizzle.team/docs/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://orm.drizzle.team/llms.txt",
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

  // Sitemap — lightweight Kubernetes distribution docs
  new DocSource({
    name: "k3s",
    type: "http",
    url: "https://docs.k3s.io/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://docs.k3s.io/sitemap.xml",
    urlPattern: "docs\\.k3s\\.io/(add-ons|advanced|architecture|cli|cluster-access|datastore|faq|installation|known-issues|networking|quick-start|reference|security|upgrades)",
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

  // Sitemap — self-hosted Git forge docs (unversioned = latest stable)
  new DocSource({
    name: "gitea",
    type: "http",
    url: "https://docs.gitea.com/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://docs.gitea.com/sitemap.xml",
    urlPattern:
      "docs\\.gitea\\.com/(administration|installation|usage|development|contributing|help|packages|actions)",
    urlExclude: "/category/",
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

  // ─── tmux ──────────────────────────────────────────────────────

  // GitHub wiki — curated guides (getting started, advanced use, FAQ, etc.)
  new DocSource({
    name: "tmux",
    type: "git",
    url: "https://github.com/tmux/tmux.wiki",
    format: "markdown",
  }),

  // ─── OpenCode ────────────────────────────────────────────────────

  // Sitemap — English docs only (34 pages). Starlight/Astro site.
  // urlPattern filters to single-segment paths after /docs/ (excludes locales like /docs/zh-cn/).
  new DocSource({
    name: "opencode",
    type: "http",
    url: "https://opencode.ai/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://opencode.ai/sitemap.xml",
    urlPattern: "opencode\\.ai/docs/[^/]+$",
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

  // llms.txt — monorepo build system (~130 entries)
  new DocSource({
    name: "turborepo",
    type: "http",
    url: "https://turbo.build/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://turbo.build/llms.txt",
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

  // llms.txt — Query, Router, Table, Form, and more
  new DocSource({
    name: "tanstack",
    type: "http",
    url: "https://tanstack.com/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://tanstack.com/llms.txt",
  }),

  // ─── Prettier ──────────────────────────────────────────────────

  // llms.txt — code formatter docs (~23 pages)
  new DocSource({
    name: "prettier",
    type: "http",
    url: "https://prettier.io/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://prettier.io/llms.txt",
  }),

  // ─── ESLint ────────────────────────────────────────────────────

  // Sitemap — linting rules, config, plugins (filter to current docs)
  new DocSource({
    name: "eslint",
    type: "http",
    url: "https://eslint.org/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://eslint.org/docs/latest/sitemap.xml",
    urlPattern: "eslint\\.org/docs/latest/",
    urlExclude: "eslint\\.org/docs/latest/(blog|team)",
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
  new DocSource({
    name: "prometheus",
    type: "http",
    url: "https://prometheus.io/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://prometheus.io/sitemap.xml",
    urlPattern: "prometheus\\.io/docs/",
  }),

  // ─── OpenTelemetry ─────────────────────────────────────────────

  // llms.txt — observability standard (concepts, SDK guides, collector)
  new DocSource({
    name: "opentelemetry",
    type: "http",
    url: "https://opentelemetry.io/docs/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://opentelemetry.io/llms.txt",
    urlPattern: "opentelemetry\\.io/docs/",
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

  // llms.txt — TypeScript effect system (concurrency, streams, schema)
  new DocSource({
    name: "effect",
    type: "http",
    url: "https://effect.website/docs/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://effect.website/llms.txt",
  }),

  // ─── Argo CD ───────────────────────────────────────────────────

  // Sitemap — GitOps CD for Kubernetes (~180 pages)
  new DocSource({
    name: "argocd",
    type: "http",
    url: "https://argo-cd.readthedocs.io/en/stable/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://argo-cd.readthedocs.io/en/stable/sitemap.xml",
  }),

  // ─── Helm ──────────────────────────────────────────────────────

  // Sitemap — Kubernetes package manager (filter to /docs/)
  new DocSource({
    name: "helm",
    type: "http",
    url: "https://helm.sh/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://helm.sh/sitemap.xml",
    urlPattern: "helm\\.sh/docs/",
  }),

  // ─── mise ──────────────────────────────────────────────────────

  // Sitemap — polyglot dev tool manager (asdf successor, ~170 pages)
  new DocSource({
    name: "mise",
    type: "http",
    url: "https://mise.jdx.dev/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://mise.jdx.dev/sitemap.xml",
  }),

  // ─── pnpm ──────────────────────────────────────────────────────

  // Sitemap — fast, disk-efficient package manager (filter to current version)
  // Docs live at top-level (/installation) and under /cli/ (/cli/add, /cli/install)
  new DocSource({
    name: "pnpm",
    type: "http",
    url: "https://pnpm.io/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://pnpm.io/sitemap.xml",
    urlExclude: "(/blog|/\\d+\\.x/|/next/|/benchmarks|/crypto-donations|/users|/logos|/search)",
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

  // ─── Let's Encrypt ─────────────────────────────────────────────

  // Sitemap-index — TLS CA docs (English sub-sitemap)
  new DocSource({
    name: "letsencrypt",
    type: "http",
    url: "https://letsencrypt.org/",
    format: "html",
    discovery: "sitemap-index",
    discoveryUrl: "https://letsencrypt.org/sitemap.xml",
    urlPattern: "letsencrypt\\.org/(docs|getting-started|how-it-works|about|donate|stats|contact|repository|privacy|trademarks)/",
    urlExclude: "letsencrypt\\.org/(de|fr|es|pt|ja|zh|ko|ru|he|uk|sr|vi|id)/",
  }),

  // ─── rclone ────────────────────────────────────────────────────

  // Sitemap — cloud storage sync tool (~130 pages)
  new DocSource({
    name: "rclone",
    type: "http",
    url: "https://rclone.org/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://rclone.org/sitemap.xml",
  }),

  // ─── Redis ─────────────────────────────────────────────────────

  // Sitemap — in-memory data store (docs-only sitemap, not marketing)
  new DocSource({
    name: "redis",
    type: "http",
    url: "https://redis.io/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://redis.io/docs/latest/sitemap.xml",
    urlPattern: "redis\\.io/docs/latest/",
  }),

  // ─── Grafana ───────────────────────────────────────────────────

  // Sitemap — observability platform (filter to docs paths from English sitemap)
  new DocSource({
    name: "grafana",
    type: "http",
    url: "https://grafana.com/docs/grafana/latest/",
    format: "html",
    discovery: "sitemap-index",
    discoveryUrl: "https://grafana.com/sitemap.xml",
    urlPattern: "grafana\\.com/docs/grafana/latest/",
  }),

  // ─── GitLab ────────────────────────────────────────────────────

  // Sitemap-index — DevSecOps platform docs (English sub-sitemap)
  new DocSource({
    name: "gitlab",
    type: "http",
    url: "https://docs.gitlab.com/",
    format: "html",
    discovery: "sitemap-index",
    discoveryUrl: "https://docs.gitlab.com/sitemap.xml",
    urlPattern: "docs\\.gitlab\\.com/ee/",
    urlExclude: "docs\\.gitlab\\.com/ee/api/",
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

  // Sitemap — browser testing framework (filter to current docs)
  new DocSource({
    name: "playwright",
    type: "http",
    url: "https://playwright.dev/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://playwright.dev/sitemap.xml",
    urlPattern: "playwright\\.dev/docs/",
    urlExclude: "/docs/next/",
  }),

  // ─── FastAPI ───────────────────────────────────────────────────

  // Sitemap — modern Python web framework (~130 pages)
  new DocSource({
    name: "fastapi",
    type: "http",
    url: "https://fastapi.tiangolo.com/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://fastapi.tiangolo.com/sitemap.xml",
    urlPattern: "fastapi\\.tiangolo\\.com/(tutorial|advanced|deployment|how-to|reference|about|features|alternatives|help|learn|project-generation|external-links|fastapi-cli|environment-variables)",
    urlExclude: "(de/|fr/|es/|pt/|ja/|zh/|ko/|ru/|tr/|vi/|uk/|bn/|az/|em/|fa/|he/|hy/|id/|pl/|nl/|yo/)",
  }),

  // ─── Go ────────────────────────────────────────────────────────

  // TOC-based — core Go docs from /doc/ (tutorials, effective go, modules, etc.)
  new DocSource({
    name: "go",
    type: "http",
    url: "https://go.dev/doc/",
    format: "html",
    discovery: "toc",
    discoveryUrl: "https://go.dev/doc/",
    urlPattern: "go\\.dev/(doc|ref|blog)/",
    urlExclude: "(devel/release|codereview|contribute|play)",
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

  // ─── Nix ───────────────────────────────────────────────────────

  // Sitemap — nix.dev community docs (tutorials, guides, recipes, ~57 pages)
  new DocSource({
    name: "nix",
    type: "http",
    url: "https://nix.dev/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://nix.dev/sitemap.xml",
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

  // llms.txt — cross-platform UI toolkit (~100 curated pages)
  new DocSource({
    name: "flutter",
    type: "http",
    url: "https://docs.flutter.dev/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://docs.flutter.dev/llms.txt",
  }),

  // ─── Expo ──────────────────────────────────────────────────────

  // llms.txt — React Native framework (EAS, Router, modules, ~200+ pages)
  new DocSource({
    name: "expo",
    type: "http",
    url: "https://docs.expo.dev/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://docs.expo.dev/llms.txt",
  }),

  // ─── Tauri ─────────────────────────────────────────────────────

  // llms.txt — Rust+Web desktop/mobile app framework (~80 pages)
  new DocSource({
    name: "tauri",
    type: "http",
    url: "https://v2.tauri.app/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://tauri.app/llms.txt",
  }),

  // ─── htmx ──────────────────────────────────────────────────────

  // Sitemap — HTML-driven interactivity (attributes, headers, events, examples)
  new DocSource({
    name: "htmx",
    type: "http",
    url: "https://htmx.org/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://htmx.org/sitemap.xml",
    urlPattern: "htmx\\.org/(docs|attributes|headers|events|examples|extensions)/",
    urlExclude: "/posts/",
  }),

  // ─── Jest ──────────────────────────────────────────────────────

  // Sitemap — JavaScript testing framework (filter to current docs)
  new DocSource({
    name: "jest",
    type: "http",
    url: "https://jestjs.io/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://jestjs.io/sitemap.xml",
    urlPattern: "jestjs\\.io/docs/[^/]+$",
    urlExclude: "(blog|/next/|/\\d+\\.)",
  }),

  // ─── Cypress ───────────────────────────────────────────────────

  // Sitemap — E2E testing framework (comprehensive docs)
  new DocSource({
    name: "cypress",
    type: "http",
    url: "https://docs.cypress.io/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://docs.cypress.io/sitemap.xml",
  }),

  // ─── Wails ─────────────────────────────────────────────────────

  // Sitemap — Go+Web desktop apps (filter to latest docs)
  new DocSource({
    name: "wails",
    type: "http",
    url: "https://wails.io/docs/",
    format: "html",
    discovery: "sitemap",
    discoveryUrl: "https://wails.io/sitemap.xml",
    urlPattern: "wails\\.io/docs/(introduction|getting-started|guides|reference|tutorials|community)",
    urlExclude: "(/next/|/v2\\.|/category/)",
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

  // llms.txt — infrastructure framework (AWS, Cloudflare, Vercel, ~200+ entries)
  new DocSource({
    name: "sst",
    type: "http",
    url: "https://sst.dev/docs/",
    format: "html",
    discovery: "llms-txt",
    discoveryUrl: "https://sst.dev/llms.txt",
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
    discovery: "sitemap",
    discoveryUrl: "https://bitwarden.com/sitemap.xml",
    urlPattern: "bitwarden\\.com/help/.+",
    urlSuffix: ".md",
  }),

  // ─── Vaultwarden ───────────────────────────────────────────────

  // GitHub wiki — self-hosted Bitwarden-compatible server (65 pages)
  new DocSource({
    name: "vaultwarden",
    type: "git",
    url: "https://github.com/dani-garcia/vaultwarden.wiki",
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

  // GCP: skipped — sitemap-index has 180 generic child sitemaps (3.4M URLs).
];
