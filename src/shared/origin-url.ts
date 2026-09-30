/**
 * Self-hosted Gitea/Forgejo instances whose hostname carries no signal.
 * Verified as Gitea via `GET <origin>/api/v1/repos/<owner>/<repo>`
 * (git.deuxfleurs.fr serves the Gitea API; its `/src/branch/<ref>/`
 * browse path is the correct one).
 */
const KNOWN_GITEA_HOSTS = new Set(["git.deuxfleurs.fr"]);

/**
 * Derive a public browse URL for a file inside a git doc source.
 *
 * The default is deliberately host-shaped: every major forge exposes
 * "view this file at this ref" under a different path, so a single
 * template cannot serve them all. Unknown hosts return `undefined` -
 * better no URL than a wrong one.
 *
 * `repoPath` must be the ORIGINAL repo-relative path (before any
 * `.mdx` -> `.md` / rootPath stripping the ingestor applies), because
 * that is what the upstream actually hosts.
 */
export function repoBrowseUrl(
  repoUrl: string,
  repoPath: string,
  branch?: string,
): string | undefined {
  let base: string;
  let host: string;
  try {
    const u = new URL(repoUrl);
    base = `${u.origin}${u.pathname}`.replace(/\/+$/, "").replace(/\.git$/, "");
    host = u.host;
  } catch {
    return undefined;
  }

  const ref = branch && branch.length > 0 ? branch : "HEAD";
  const path = repoPath.replace(/^\/+/, "");
  if (!path) return undefined;

  let template: string | undefined;
  if (host === "github.com") {
    template = "blob/HEAD";
  } else if (host === "gitlab.com" || host.startsWith("gitlab.") || host.includes("gitlab")) {
    template = "-/blob/HEAD";
  } else if (
    host === "codeberg.org" ||
    host.includes("gitea") ||
    host.includes("forgejo") ||
    KNOWN_GITEA_HOSTS.has(host)
  ) {
    // Gitea / Forgejo / Codeberg source view. Their `HEAD` ref handling is
    // unreliable, so prefer the branch actually checked out.
    template = `src/branch/${ref}`;
  } else {
    return undefined;
  }

  return `${base}/${template}/${path}`;
}
