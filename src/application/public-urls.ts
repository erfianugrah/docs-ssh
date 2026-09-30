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
