/**
 * source-suggest - "did you mean" source-name suggestions for docs.erfi.io.
 *
 * Pure: accepts a list of source dir names, returns ranked candidates.
 * Exported for unit-testing; also exported as a shell fragment for the SSH
 * builtins (single `ls` + awk, no subprocess per tool call).
 */

/**
 * Damerau-Levenshtein distance (optimal string alignment variant).
 * Transpositions cost 1; the classic OSA restriction is that a substring
 * may not be edited more than once after a transposition.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Full matrix for correctness (names are short, < 40 chars).
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) {
    d[i] = [];
    d[i][0] = i;
  }
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,     // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[m][n];
}

export interface SourceCandidate {
  name: string;
  matchKind: "prefix" | "suffix" | "hyphen-segment" | "substring" | "levenshtein";
  distance: number; // 0 for non-DL kinds; DL value otherwise
}

/**
 * Suggest up to 6 closest source names for an unknown input.
 *
 * Match strategy (in priority order, each checked independently):
 * 1. Prefix: `input` is a prefix of a real source name (lidarr → lidarr-api)
 * 2. Suffix: `input` is a suffix of a real source name
 * 3. Hyphen-segment: `input` matches a hyphen-delimited segment of a real
 *    source (aws → aws-api, aws-sdk; fly → flyio, flyio-api)
 * 4. Substring: input is contained in name, or name is contained in input
 * 5. Damerau-Levenshtein distance ≤ 2
 *
 * Ranking: by match-kind priority, then by distance within each kind.
 * Capped at 6 candidates.
 *
 * Case-insensitive matching.
 */
export function suggestSource(
  unknown: string,
  allSources: string[],
): string[] {
  const input = unknown.toLowerCase().trim();
  if (!input || allSources.length === 0) return [];

  const candidates: SourceCandidate[] = [];
  const inputSegments = input.split("-");

  for (const name of allSources) {
    const lower = name.toLowerCase();

    // Skip exact match - suggestSource is only called for unknown sources.
    if (lower === input) continue;

    // 1. Prefix match
    if (lower.startsWith(input)) {
      candidates.push({ name, matchKind: "prefix", distance: 0 });
      continue;
    }

    // 2. Suffix match
    if (lower.endsWith(input)) {
      candidates.push({ name, matchKind: "suffix", distance: 0 });
      continue;
    }

    // 3. Hyphen-segment match: input matches a hyphen-delimited segment
    const nameSegments = lower.split("-");
    if (
      nameSegments.length > 1 &&
      inputSegments.some((seg) => seg && nameSegments.includes(seg))
    ) {
      candidates.push({ name, matchKind: "hyphen-segment", distance: 0 });
      continue;
    }

    // 4. Substring match (either direction)
    if (lower.includes(input) || input.includes(lower)) {
      candidates.push({ name, matchKind: "substring", distance: 0 });
      continue;
    }

    // 5. Damerau-Levenshtein ≤ 2
    const dl = damerauLevenshtein(input, lower);
    if (dl <= 2) {
      candidates.push({ name, matchKind: "levenshtein", distance: dl });
    }
  }

  // Rank: match kind priority, then distance within same kind
  const kindOrder: Record<SourceCandidate["matchKind"], number> = {
    prefix: 0,
    suffix: 1,
    "hyphen-segment": 2,
    substring: 3,
    levenshtein: 4,
  };

  candidates.sort((a, b) => {
    const ka = kindOrder[a.matchKind];
    const kb = kindOrder[b.matchKind];
    if (ka !== kb) return ka - kb;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.name.localeCompare(b.name);
  });

  return candidates.slice(0, 6).map((c) => c.name);
}

/**
 * Shell fragment for the SSH tool templates (and the dotfiles docs-core.ts
 * port): with SRC set to the requested source, prints
 * `[unknown source "X" - did you mean: a, b]` and exits 0 when /docs/X is
 * missing and some source dir name starts with, ends with, or overlaps X
 * (prefix > suffix > substring, alphabetical within a rank, at most 6).
 * Otherwise falls through to the real command. Busybox ls/sed/awk/sort
 * only. The MCP service uses suggestSource() instead (adds edit distance).
 */
export function sourceGuardShell(): string {
  return String.raw`if [ ! -d "/docs/$SRC" ]; then sg=$(ls -p /docs | sed -n 's#/$##p' | awk -v s="$SRC" 'BEGIN{s=tolower(s)} {l=tolower($0); r=0; if(index(l,s)==1)r=1; else if(length(l)>length(s)&&substr(l,length(l)-length(s)+1)==s)r=2; else if(index(l,s)||index(s,l))r=3; if(r)print r" "$0}' | sort -k1,1n -k2,2 | head -6 | awk '{printf "%s%s",(NR>1?", ":""),$2}'); if [ -n "$sg" ]; then echo "[unknown source \"$SRC\" - did you mean: $sg]"; exit 0; fi; fi; `;
}