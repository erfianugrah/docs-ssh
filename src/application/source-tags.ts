/**
 * Category tags for each doc source. Used to auto-generate:
 * - "Related source groups" in agents.sh
 * - README.md source table
 *
 * Sources can appear in multiple categories.
 * When adding a new source to sources.ts, add its tags here too.
 */
export const SOURCE_TAGS: Record<string, readonly string[]> = {
  // ─── Auth & identity ────────────────────────────────────────────
  supabase: ["auth", "databases", "cloud"],
  keycloak: ["auth"],
  authentik: ["auth"],
  openid: ["auth", "apis"],
  saml: ["auth", "apis"],
  bitwarden: ["auth", "secrets"],
  vaultwarden: ["auth", "secrets"],

  // ─── Databases & SQL ────────────────────────────────────────────
  postgres: ["databases"],
  "postgres-wiki": ["databases", "postgres-ecosystem"],
  drizzle: ["databases"],
  prisma: ["databases"],
  sqlite: ["databases"],
  redis: ["databases"],
  valkey: ["databases"],
  "modern-sql": ["databases"],
  "use-the-index-luke": ["databases"],
  sqlstyle: ["databases"],
  pglocks: ["databases"],

  // ─── Postgres ecosystem ─────────────────────────────────────────
  pgvector: ["postgres-ecosystem"],
  postgis: ["postgres-ecosystem"],
  pgbouncer: ["postgres-ecosystem"],
  "pg-cron": ["postgres-ecosystem"],
  pgrx: ["postgres-ecosystem"],
  citus: ["postgres-ecosystem"],
  "pg-graphql": ["postgres-ecosystem", "supabase-ecosystem"],
  "pg-net": ["postgres-ecosystem", "supabase-ecosystem"],
  "index-advisor": ["postgres-ecosystem", "supabase-ecosystem"],
  supavisor: ["postgres-ecosystem", "supabase-ecosystem"],
  "supabase-grafana": ["postgres-ecosystem", "supabase-ecosystem", "monitoring"],
  multigres: ["postgres-ecosystem"],
  "multigres-dev": ["postgres-ecosystem"],

  // ─── Postgres-compatible platforms ──────────────────────────────
  neon: ["postgres-compatible", "cloud"],
  cockroachdb: ["postgres-compatible"],
  yugabytedb: ["postgres-compatible"],
  paradedb: ["postgres-compatible"],
  timescaledb: ["postgres-compatible"],
  electric: ["postgres-compatible"],

  // ─── Postgres HA & ops ──────────────────────────────────────────
  patroni: ["postgres-ha"],
  pgpool: ["postgres-ha"],

  // ─── Infrastructure ─────────────────────────────────────────────
  docker: ["infrastructure"],
  kubernetes: ["infrastructure"],
  k3s: ["infrastructure"],
  terraform: ["infrastructure"],
  ansible: ["infrastructure"],
  flyio: ["infrastructure", "cloud"],
  helm: ["infrastructure"],
  argocd: ["infrastructure"],
  sst: ["infrastructure", "cloud"],

  // ─── Reverse proxy & networking ─────────────────────────────────
  cloudflare: ["networking", "cloud"],
  caddy: ["networking"],
  traefik: ["networking"],
  wireguard: ["networking"],

  // ─── Frontend frameworks ────────────────────────────────────────
  nextjs: ["frontend"],
  react: ["frontend"],
  astro: ["frontend"],
  hono: ["frontend"],
  tailwindcss: ["frontend"],
  shadcn: ["frontend"],
  svelte: ["frontend"],
  htmx: ["frontend"],
  "tanstack-query": ["frontend"],
  "tanstack-router": ["frontend"],
  "tanstack-table": ["frontend"],
  "tanstack-form": ["frontend"],
  effect: ["frontend", "languages"],

  // ─── Languages & runtimes ───────────────────────────────────────
  typescript: ["languages"],
  python: ["languages"],
  "rust-book": ["languages"],
  bun: ["languages"],
  deno: ["languages"],
  go: ["languages"],
  zod: ["languages"],
  nix: ["languages"],

  // ─── Cloud platforms ────────────────────────────────────────────
  aws: ["cloud"],
  vercel: ["cloud"],

  // ─── Build tools ────────────────────────────────────────────────
  vite: ["build-tools"],
  vitest: ["build-tools", "testing"],
  turborepo: ["build-tools"],
  rspack: ["build-tools"],
  eslint: ["build-tools"],
  prettier: ["build-tools"],
  pnpm: ["build-tools"],

  // ─── Testing ────────────────────────────────────────────────────
  jest: ["testing"],
  playwright: ["testing"],
  cypress: ["testing"],

  // ─── Mobile & desktop ──────────────────────────────────────────
  "react-native": ["mobile"],
  flutter: ["mobile"],
  expo: ["mobile"],
  tauri: ["mobile"],
  wails: ["mobile"],

  // ─── Monitoring & observability ─────────────────────────────────
  prometheus: ["monitoring"],
  opentelemetry: ["monitoring"],
  grafana: ["monitoring"],

  // ─── Secrets & encryption ───────────────────────────────────────
  age: ["secrets"],
  sops: ["secrets"],

  // ─── Terminal & editor ──────────────────────────────────────────
  neovim: ["terminal"],
  tmux: ["terminal"],
  wezterm: ["terminal"],
  zsh: ["terminal"],
  ohmyzsh: ["terminal"],
  zinit: ["terminal"],
  powerlevel10k: ["terminal"],
  mise: ["terminal"],

  // ─── CLI tools ──────────────────────────────────────────────────
  curl: ["cli-tools"],
  ripgrep: ["cli-tools"],
  httpie: ["cli-tools"],
  rclone: ["cli-tools"],

  // ─── Git forges ─────────────────────────────────────────────────
  github: ["git-forges"],
  gitlab: ["git-forges"],
  gitea: ["git-forges"],

  // ─── APIs & specs ───────────────────────────────────────────────
  graphql: ["apis"],
  "graphql-spec": ["apis"],
  mcp: ["apis", "diagrams"],

  // ─── Docs & diagrams ───────────────────────────────────────────
  mdn: ["diagrams"],
  d2: ["diagrams"],
  mermaid: ["diagrams"],
  starlight: ["diagrams"],
  excalidraw: ["diagrams"],

  // ─── Email & services ──────────────────────────────────────────
  resend: ["email"],
  letsencrypt: ["email"],

  // ─── Blogs & changelogs ─────────────────────────────────────────
  "supabase-blog": ["blogs"],
  "cloudflare-blog": ["blogs"],
  "cloudflare-changelog": ["blogs"],
  "vercel-blog": ["blogs"],
  "vercel-changelog": ["blogs"],

  // ─── API specs ──────────────────────────────────────────────────
  "aws-api": ["api-specs"],
  "cloudflare-api": ["api-specs"],
  "docker-api": ["api-specs"],
  "kubernetes-api": ["api-specs"],
  "supabase-api": ["api-specs"],
  "supabase-auth-api": ["api-specs"],
  "flyio-api": ["api-specs"],
  "gitea-api": ["api-specs"],
  "authentik-api": ["api-specs"],
  "keycloak-api": ["api-specs"],

  // ─── Other ──────────────────────────────────────────────────────
  opencode: ["build-tools"],
  fastapi: ["languages", "frontend"],
  "erfi-technical-blog": ["blogs"],
  "erfi-personal-blog": ["blogs"],
};

/**
 * Human-readable names for each category tag.
 */
export const TAG_LABELS: Record<string, string> = {
  auth: "Auth & identity",
  databases: "Databases & SQL",
  "postgres-ecosystem": "Postgres ecosystem",
  "supabase-ecosystem": "Supabase ecosystem",
  "postgres-compatible": "Postgres-compatible",
  "postgres-ha": "Postgres HA & ops",
  infrastructure: "Infrastructure",
  networking: "Reverse proxy & networking",
  frontend: "Frontend frameworks",
  languages: "Languages & runtimes",
  cloud: "Cloud platforms",
  "build-tools": "Build tools",
  testing: "Testing",
  mobile: "Mobile & desktop",
  monitoring: "Monitoring & observability",
  secrets: "Secrets & encryption",
  terminal: "Terminal & editor",
  "cli-tools": "CLI tools",
  "git-forges": "Git forges",
  apis: "APIs & specs",
  diagrams: "Docs & diagrams",
  email: "Email & services",
  blogs: "Blogs & changelogs",
  "api-specs": "API specs",
};

/**
 * Build a map of tag → source names for agent instructions.
 * Only includes tags that appear in TAG_LABELS (skip internal-only tags).
 */
export function buildSourceGroups(): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [source, tags] of Object.entries(SOURCE_TAGS)) {
    for (const tag of tags) {
      if (!TAG_LABELS[tag]) continue;
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(source);
    }
  }
  return groups;
}
