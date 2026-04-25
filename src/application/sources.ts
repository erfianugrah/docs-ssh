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

  // Git sparse — Astro Starlight source (630 mdx files)
  new DocSource({
    name: "opencode",
    type: "git",
    url: "https://github.com/sst/opencode",
    format: "mdx",
    paths: ["packages/web/src/content/docs"],
    rootPath: "packages/web/src/content/docs",
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

  // ─── Nix ───────────────────────────────────────────────────────

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

  // Git sparse — flutter.dev source (695 md files in src/content)
  new DocSource({
    name: "flutter",
    type: "git",
    url: "https://github.com/flutter/website",
    format: "markdown",
    paths: ["src/content"],
    rootPath: "src/content",
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

  // Async HTTP client for Postgres by Supabase
  new DocSource({
    name: "pg-net",
    type: "git",
    url: "https://github.com/supabase/pg_net",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
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

  // ─── AWS, sharded per service (kept last — slowest tier) ──────
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

  // GCP: skipped — sitemap-index has 180 generic child sitemaps (3.4M URLs).
];
