/**
 * Per-source overrides mapping a repo-relative path to the file's real
 * public URL, for sources whose published site does not mirror the repo
 * layout. Used by GitIngestor in preference to the generic blob URL.
 */

/**
 * lexicanum (erfi-technical-blog) - Astro Starlight site published at
 * https://erfi.dev. Starlight maps `src/content/docs/<slug>.mdx` to
 * `/<slug>/` and `index.mdx` to the containing directory, lowercasing
 * the slug. Verified live 2026-09:
 *   https://erfi.dev/guides/supabase-shared-tenancy/            -> 200
 *   https://erfi.dev/reference/supabase-multi-tenant-placement/ -> 200
 *
 * Limitation: a `slug:` frontmatter override would not be honoured (none
 * exist in the corpus today).
 */
export function lexicanumPublicUrl(repoRelPath: string): string | undefined {
  const prefix = "src/content/docs/";
  const p = repoRelPath.replace(/\\/g, "/");
  if (!p.startsWith(prefix)) return undefined;
  const rel = p.slice(prefix.length);
  if (!/\.(md|mdx|markdown)$/i.test(rel)) return undefined;

  let slug = rel.replace(/\.(md|mdx|markdown)$/i, "");
  // index.mdx is the directory itself: guides/index.mdx -> /guides/
  slug = slug.replace(/(^|\/)index$/i, "$1").replace(/\/+$/, "");
  const lower = slug.toLowerCase();
  if (lower === "") return "https://erfi.dev/";
  return `https://erfi.dev/${lower}/`;
}

// ── learn.microsoft.com URL mappers ──────────────────────────────

const LEARN_BASE = "https://learn.microsoft.com/en-us";

/**
 * win32-api (MicrosoftDocs/sdk-api). Repo paths:
 *   sdk-api-src/content/<header>/<file>.md
 * Public:
 *   https://learn.microsoft.com/en-us/windows/win32/api/<header>/<file>
 * Verified live 2026-11:
 *   /en-us/windows/win32/api/winreg/nf-winreg-regopenkeyexw  -> 200
 *   /en-us/windows/win32/api/setupapi/nf-setupapi-setupdigetclassdevsw -> 200
 */
export function win32ApiPublicUrl(repoRelPath: string): string | undefined {
  const prefix = "sdk-api-src/content/";
  const p = repoRelPath.replace(/\\/g, "/");
  if (!p.startsWith(prefix)) return undefined;
  let rel = p.slice(prefix.length);
  if (!/\.md$/i.test(rel)) return undefined;
  rel = rel.replace(/\.md$/i, "");
  return `${LEARN_BASE}/windows/win32/api/${rel.toLowerCase()}`;
}

/**
 * win32-docs (MicrosoftDocs/win32). Repo paths:
 *   desktop-src/<dir>/<file>.md
 * Public:
 *   https://learn.microsoft.com/en-us/windows/win32/<dir>/<file>
 * Verified live 2026-11:
 *   /en-us/windows/win32/coreaudio/wasapi  -> 200
 */
export function win32DocsPublicUrl(repoRelPath: string): string | undefined {
  const prefix = "desktop-src/";
  const p = repoRelPath.replace(/\\/g, "/");
  if (!p.startsWith(prefix)) return undefined;
  let rel = p.slice(prefix.length);
  if (!/\.md$/i.test(rel)) return undefined;
  rel = rel.replace(/\.md$/i, "");
  return `${LEARN_BASE}/windows/win32/${rel.toLowerCase()}`;
}

/**
 * windows-drivers (MicrosoftDocs/windows-driver-docs). Repo paths:
 *   windows-driver-docs-pr/<dir>/<file>.md
 * Public:
 *   https://learn.microsoft.com/en-us/windows-hardware/drivers/<dir>/<file>
 * Verified live 2026-11:
 *   /en-us/windows-hardware/drivers/audio/index  -> 200
 */
export function windowsDriversPublicUrl(repoRelPath: string): string | undefined {
  const prefix = "windows-driver-docs-pr/";
  const p = repoRelPath.replace(/\\/g, "/");
  if (!p.startsWith(prefix)) return undefined;
  let rel = p.slice(prefix.length);
  if (!/\.md$/i.test(rel)) return undefined;
  rel = rel.replace(/\.md$/i, "");
  return `${LEARN_BASE}/windows-hardware/drivers/${rel.toLowerCase()}`;
}

/**
 * windows-ddi (MicrosoftDocs/windows-driver-docs-ddi). Repo paths:
 *   wdk-ddi-src/content/<header>/<file>.md
 * Public:
 *   https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/<header>/<file>
 * Verified live 2026-11:
 *   /en-us/windows-hardware/drivers/ddi/hidsdi/nf-hidsdi-hidd_getfeature  -> 200
 */
export function windowsDdiPublicUrl(repoRelPath: string): string | undefined {
  const prefix = "wdk-ddi-src/content/";
  const p = repoRelPath.replace(/\\/g, "/");
  if (!p.startsWith(prefix)) return undefined;
  let rel = p.slice(prefix.length);
  if (!/\.md$/i.test(rel)) return undefined;
  rel = rel.replace(/\.md$/i, "");
  return `${LEARN_BASE}/windows-hardware/drivers/ddi/${rel.toLowerCase()}`;
}