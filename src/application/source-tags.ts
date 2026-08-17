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
  "better-auth": ["auth"],
  clerk: ["auth", "cloud"],
  openid: ["auth", "apis"],
  saml: ["auth", "apis"],
  bitwarden: ["auth", "secrets"],
  vaultwarden: ["auth", "secrets"],

  // ─── Databases & SQL ────────────────────────────────────────────
  postgres: ["databases"],
  mysql: ["databases"],
  debezium: ["databases"],
  "postgres-wiki": ["databases", "postgres-ecosystem"],
  drizzle: ["databases"],
  prisma: ["databases"],
  sqlite: ["databases"],
  redis: ["databases"],
  valkey: ["databases"],
  "modern-sql": ["databases"],
  "use-the-index-luke": ["databases"],
  sqlstyle: ["databases"],
  duckdb: ["databases"],
  planetscale: ["databases", "cloud"],

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
  "supabase-wrappers": ["postgres-ecosystem", "supabase-ecosystem", "databases"],
  "supabase-etl": ["postgres-ecosystem", "supabase-ecosystem", "databases"],
  "supabase-cli": ["supabase-ecosystem"],
  postgrest: ["postgres-ecosystem", "supabase-ecosystem"],
  pgloader: ["postgres-ecosystem", "databases"],
  multigres: ["postgres-ecosystem"],
  "multigres-dev": ["postgres-ecosystem"],
  pgmustard: ["postgres-ecosystem"],
  "pganalyze-blog": ["postgres-ecosystem"],
  "planet-postgres": ["postgres-ecosystem"],
  "postgres-weekly": ["postgres-ecosystem"],

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
  akamai: ["networking", "cloud"],
  fastly: ["networking", "cloud"],
  bunnycdn: ["networking", "cloud"],
  caddy: ["networking"],
  "caddy-cache-handler": ["networking", "caching"],
  souin: ["networking", "caching"],
  varnish: ["networking", "caching"],
  squid: ["networking", "caching"],
  nginx: ["networking", "caching"],
  "apache-traffic-server": ["networking", "caching"],
  "ietf-rfc": ["standards", "networking"],
  "http-caching-rfcs": ["caching", "apis"],
  "http-caching-tutorial": ["caching"],
  traefik: ["networking"],
  wireguard: ["networking", "vpn"],
  strongswan: ["networking", "vpn"],
  openvpn: ["networking", "vpn"],

  // ─── Router firmware ──────────────────────────────────────────────
  openwrt: ["networking", "router-firmware"],
  ddwrt: ["networking", "router-firmware"],
  freshtomato: ["networking", "router-firmware"],
  turris: ["networking", "router-firmware"],
  "asuswrt-merlin": ["networking", "router-firmware"],
  pfsense: ["networking", "router-firmware", "firewall"],
  opnsense: ["networking", "router-firmware", "firewall"],
  glinet: ["networking", "router-firmware"],

  // ─── Firewall / netfilter ─────────────────────────────────────────
  nftables: ["networking", "firewall"],
  iptables: ["networking", "firewall"],

  // ─── DNS servers ────────────────────────────────────────────────
  nsd: ["dns", "networking"],
  "knot-dns": ["dns", "networking"],
  powerdns: ["dns", "networking"],
  bind9: ["dns", "networking"],
  kea: ["dns", "networking"],
  pihole: ["dns", "networking"],
  "adguard-home": ["dns", "networking"],
  "miekg-dns": ["dns", "languages"],
  "miekg-dns-v2": ["dns", "languages"],

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
  // AWS is sharded per-service (see sources.ts). Each shard tagged
  // 'cloud'; the umbrella 'aws' tag is gone with the umbrella source.
  "aws-lambda": ["cloud"],
  "aws-s3": ["cloud"],
  "aws-cloudfront": ["cloud"],
  "aws-iam": ["cloud"],
  "aws-dynamodb": ["cloud", "databases"],
  "aws-cloudformation": ["cloud"],
  "aws-vpc": ["cloud"],
  "aws-ec2": ["cloud"],
  "aws-rds": ["cloud", "databases"],
  "aws-dms": ["cloud", "databases"],
  "aws-aurora": ["cloud", "databases"],
  "aws-redshift": ["cloud", "databases"],
  "aws-glue": ["cloud", "databases"],
  "aws-kinesis": ["cloud"],
  "aws-sqs": ["cloud"],
  "aws-sns": ["cloud"],
  "aws-ecs": ["cloud"],
  "aws-eks": ["cloud", "infrastructure"],
  "aws-secretsmanager": ["cloud", "secrets"],
  "aws-systems-manager": ["cloud"],
  "aws-cognito": ["cloud", "auth"],
  "aws-apigateway": ["cloud"],
  "aws-eventbridge": ["cloud"],
  "aws-step-functions": ["cloud"],
  "aws-waf": ["cloud", "networking"],
  "aws-elb": ["cloud", "networking"],
  vercel: ["cloud"],

  // ─── Build tools ────────────────────────────────────────────────
  vite: ["build-tools"],
  vitest: ["build-tools", "testing"],
  turborepo: ["build-tools"],
  rspack: ["build-tools"],
  eslint: ["build-tools"],
  prettier: ["build-tools"],
  pnpm: ["build-tools"],
  npm: ["build-tools"],

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
  loki: ["monitoring"],
  tempo: ["monitoring"],
  mimir: ["monitoring"],
  pyroscope: ["monitoring"],
  alloy: ["monitoring"],
  beyla: ["monitoring"],
  k6: ["monitoring"],
  oncall: ["monitoring"],
  faro: ["monitoring"],
  ntfy: ["monitoring"],

  // ─── Secrets & encryption ───────────────────────────────────────
  age: ["secrets"],
  sops: ["secrets"],
  vault: ["secrets", "infrastructure"],
  openbao: ["secrets", "infrastructure"],
  infisical: ["secrets", "infrastructure"],
  rbw: ["auth", "secrets"],

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

  // ─── Technical writing & docs craft ────────────────────────────
  diataxis: ["tech-writing"],
  "writethedocs-guide": ["tech-writing"],
  idratherbewriting: ["tech-writing", "apis"],
  "microsoft-style-guide": ["tech-writing"],

  // ─── Docs & diagrams ───────────────────────────────────────────
  mdn: ["diagrams"],
  d2: ["diagrams"],
  mermaid: ["diagrams"],
  quarto: ["diagrams"],
  starlight: ["diagrams"],
  excalidraw: ["diagrams"],

  // ----- Email & services -------------------------------------------
  resend: ["email"],
  letsencrypt: ["email"],
  stripe: ["apis", "cloud"],

  // ─── Blogs & changelogs ─────────────────────────────────────────
  "supabase-blog": ["blogs"],
  "supabase-changelog": ["blogs", "supabase-ecosystem"],
  "supabase-status": ["supabase-ecosystem", "monitoring"],
  "cloudflare-blog": ["blogs"],
  "cloudflare-changelog": ["blogs"],
  "vercel-blog": ["blogs"],
  "vercel-changelog": ["blogs"],

  // ─── Azure ────────────────────────────────────────────────────────────────
  azure:                       ["cloud"],
  "azure-aks":                 ["cloud", "infrastructure"],
  "azure-virtual-machines":    ["cloud", "infrastructure"],
  "azure-container-instances": ["cloud", "infrastructure"],
  "azure-key-vault":           ["cloud", "secrets"],
  "azure-monitor":             ["cloud", "monitoring"],
  "azure-entra":               ["cloud", "auth"],

  // ─── Windows ──────────────────────────────────────────────────────
  powershell: ["windows", "terminal", "languages"],
  wsl: ["windows", "linux"],
  "windows-server": ["windows", "networking"],

    // ─── API specs ──────────────────────────────────────────────────
  "aws-api": ["api-specs"],
  "gcp-api": ["api-specs"],
  "cloudflare-api": ["api-specs"],
  "docker-api": ["api-specs"],
  "kubernetes-api": ["api-specs"],
  "supabase-api": ["api-specs"],
  "supabase-auth-api": ["api-specs"],
  "flyio-api": ["api-specs"],
  "gitea-api": ["api-specs"],
  "authentik-api": ["api-specs"],
  "keycloak-api": ["api-specs"],
  "stripe-api": ["api-specs"],

  // ─── Supabase ecosystem (non-Postgres) ──────────────────────────
  "supabase-server": ["supabase-ecosystem", "auth"],
  logflare: ["supabase-ecosystem", "monitoring"],

  // ─── OSINT & reconnaissance ─────────────────────────────────────
  searxng: ["osint"],
  projectdiscovery: ["osint"],
  amass: ["osint"],
  spiderfoot: ["osint"],
  theharvester: ["osint"],
  "recon-ng": ["osint"],
  sherlock: ["osint"],
  maigret: ["osint"],
  bbot: ["osint"],
  exiftool: ["osint"],
  yacy: ["osint"],

  // ─── Linux distros ──────────────────────────────────────────────
  cachyos: ["linux"],
  archwiki: ["linux"],
  nixos: ["linux"],
  "debian-handbook": ["linux"],
  "debian-reference": ["linux"],
  "ubuntu-server": ["linux"],
  vyos: ["linux", "networking"],
  steamos: ["linux"],
  steamdeckhq: ["linux"],
  "rhel9-basic-system-settings": ["linux"],
  "rhel9-dnf": ["linux"],
  "rhel9-networking": ["linux", "networking"],
  "rhel9-network-infrastructure-services": ["linux", "networking"],
  "rhel9-security-hardening": ["linux"],
  "rhel9-selinux": ["linux"],
  "rhel9-firewalls": ["linux", "networking"],
  "rhel9-storage": ["linux"],
  "rhel9-lvm": ["linux"],
  "rhel9-file-systems": ["linux"],
  "rhel9-performance": ["linux"],
  "rhel9-kernel": ["linux"],
  "rhel9-systemd": ["linux"],
  "rhel9-containers": ["linux"],

  // ─── Filesystems ────────────────────────────────────────────────
  openzfs: ["filesystems", "nas"],
  btrfs: ["filesystems"],
  "linux-fs": ["filesystems", "linux"],
  samba: ["filesystems", "networking", "nas"],

  // ─── Backups & NAS ──────────────────────────────────────────────
  restic: ["backup"],
  borgbackup: ["backup"],
  unraid: ["nas", "filesystems", "infrastructure"],

  // ─── Object storage (S3-compatible) ─────────────────────────────
  silo: ["object-storage", "infrastructure"],
  garage: ["object-storage", "infrastructure"],
  seaweedfs: ["object-storage", "infrastructure"],
  rustfs: ["object-storage", "infrastructure"],
  versitygw: ["object-storage", "infrastructure"],
  "ceph-rgw": ["object-storage", "infrastructure"],

  // ─── Hardware & SBCs ────────────────────────────────────────────
  turingpi: ["hardware", "infrastructure"],
  "turingpi-rk1": ["hardware"],
  "turingpi-help-center": ["hardware"],
  pikvm: ["hardware"],
  "nixos-turing-rk1": ["hardware", "linux"],
  talos: ["infrastructure", "linux"],

  // ─── Media servers & automation ────────────────────────────────
  servarr: ["media"],
  "trash-guides": ["media"],
  recyclarr: ["media", "cli-tools"],
  bazarr: ["media"],
  jellyfin: ["media"],
  overseerr: ["media"],
  jellyseerr: ["media"],
  qbittorrent: ["media"],
  sabnzbd: ["media"],
  slskd: ["media"],
  gluetun: ["media", "networking"],

  // ─── Smart home & IoT ───────────────────────────────────────────
  "home-assistant": ["smarthome"],
  zigbee2mqtt: ["smarthome"],
  "zwave-js": ["smarthome"],
  esphome: ["smarthome"],
  matter: ["smarthome"],
  openthread: ["smarthome"],
  athom: ["smarthome", "hardware"],
  airgradient: ["smarthome", "hardware"],

  // ─── Other ──────────────────────────────────────────────────────
  opencode: ["build-tools"],
  pi: ["build-tools"],
  liftosaur: ["languages", "apis"],
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
  caching: "HTTP caching",
  dns: "DNS servers",
  vpn: "VPN",
  "router-firmware": "Router firmware",
  firewall: "Firewall & packet filtering",
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
  standards: "Standards & RFCs",
  diagrams: "Docs & diagrams",
  "tech-writing": "Technical writing & docs craft",
  email: "Email & services",
  blogs: "Blogs & changelogs",
  "api-specs": "API specs",
  osint: "OSINT & reconnaissance",
  linux: "Linux distros",
  windows: "Windows",
  filesystems: "Filesystems",
  backup: "Backups",
  "object-storage": "Object storage (S3-compatible)",
  nas: "NAS & home server",
  hardware: "Hardware & SBCs",
  media: "Media servers & automation",
  smarthome: "Smart home & IoT",
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

/**
 * Build the `_source_groups.json` payload (label + filtered sources)
 * for the given set of source names. Pure function — no I/O, no
 * filesystem. Both `commands/generate-source-groups.ts` (standalone
 * CLI) and `index.ts` (in-process post-fetch) call this.
 *
 * Drops empty groups (no surviving sources) so the JSON output stays
 * compact.
 */
export function buildSourceGroupsPayload(
  sourceNames: ReadonlySet<string>,
): Record<string, { label: string; sources: string[] }> {
  const groups = buildSourceGroups();
  const out: Record<string, { label: string; sources: string[] }> = {};
  for (const [tag, names] of groups) {
    const existing = names.filter((n) => sourceNames.has(n));
    if (existing.length) {
      out[tag] = { label: TAG_LABELS[tag] ?? tag, sources: existing };
    }
  }
  return out;
}
