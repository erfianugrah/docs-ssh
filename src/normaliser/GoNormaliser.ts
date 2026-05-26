import type { DocFile } from "../domain/DocFile.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocFormat } from "../domain/DocSource.js";

/**
 * Converts a single Go source file to godoc-style markdown.
 *
 * This is a pragmatic extractor, not a full AST parser. It walks the
 * file line-by-line with a small state machine that tracks string,
 * comment, and brace-depth state so that:
 *   - top-level declarations are correctly identified (depth === 0)
 *   - `{` and `}` inside strings/comments don't perturb depth
 *   - doc comments (consecutive `// ...` lines immediately preceding a
 *     declaration with no blank line between) are attached to that decl
 *
 * Output structure per file:
 *   # path/to/file.go
 *
 *   `package X`
 *
 *   <package-level doc, if any>
 *
 *   ## func/type/const/var Name
 *
 *   ```go
 *   <signature, possibly multi-line>
 *   ```
 *
 *   <doc>
 *
 * Path is rewritten from `.go` to `.md` so the cleanup passes
 * (MarkdownCleaner) and the search indexer recognise it as markdown.
 *
 * Only EXPORTED symbols (first letter uppercase) are emitted. Unexported
 * decls and their docs are skipped because they're not part of the API
 * surface a docs consumer cares about.
 */
export class GoNormaliser implements DocNormaliser {
  readonly name = "GoNormaliser";

  supports(file: DocFile): boolean {
    return file.extension === "go";
  }

  supportsFormat(format: DocFormat): boolean {
    return format === "godoc";
  }

  async normalise(file: DocFile): Promise<DocFile> {
    const md = goToMarkdown(file.path, file.content);
    const newPath = file.path.replace(/\.go$/, ".md");
    return file.withContent(md).withPath(newPath);
  }
}

// ─── Pure extraction ────────────────────────────────────────────────

interface ExtractedDecl {
  kind: "func" | "method" | "type" | "const" | "var";
  name: string;
  receiver?: string; // for methods: the receiver type name (e.g. "Msg")
  signature: string; // multi-line for type-with-body, const/var groups, multi-line funcs
  doc: string;
}

interface ExtractedFile {
  packageName: string | null;
  packageDoc: string;
  decls: ExtractedDecl[];
}

export function extractGoDocs(source: string): ExtractedFile {
  const lines = source.split("\n");
  const decls: ExtractedDecl[] = [];
  let packageName: string | null = null;
  let packageDoc = "";

  // Per-line state we maintain as we walk:
  //   - inBlockComment:   inside /* ... */
  //   - braceDepth:       count of `{` minus `}` outside strings/comments
  //   - docBuffer:        accumulated // doc comment lines, ready to
  //                       attach to the next declaration. Cleared on
  //                       a blank line.
  let inBlockComment = false;
  let braceDepth = 0;
  let docBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine;

    // Update inBlockComment / braceDepth based on this line's content.
    // We do this *before* deciding what kind of line this is, so that
    // a `*/` at column 0 correctly ends the block comment and the rest
    // of the line is processed as code.
    const startedInBlockComment = inBlockComment;
    const { newInBlockComment, depthDelta, lineHasCodeOutsideComments } =
      scanLineState(line, inBlockComment);

    // Decide line role at TOP LEVEL only. Anything inside a function
    // body (braceDepth > 0) we skip entirely.
    if (braceDepth === 0 && !startedInBlockComment) {
      const trimmed = line.trim();

      // Blank line clears the doc buffer (godoc rule: doc comment must
      // be immediately adjacent to the declaration).
      if (trimmed === "") {
        docBuffer = [];
      } else if (trimmed.startsWith("//")) {
        // Line comment. `//go:build` and other compiler directives
        // are not docs — skip them.
        if (!isCompilerDirective(trimmed)) {
          docBuffer.push(stripLineCommentPrefix(trimmed));
        }
      } else if (trimmed.startsWith("/*")) {
        // Block comment opened on this line. If it also closes on this
        // line, treat the inner text as a doc block. If it spans
        // multiple lines, we'll accumulate via the continuation branch
        // below (handled when startedInBlockComment is true on later
        // lines).
        const closeIdx = trimmed.indexOf("*/", 2);
        if (closeIdx !== -1) {
          docBuffer.push(trimmed.slice(2, closeIdx).trim());
        } else {
          // Multi-line block comment — start accumulating
          docBuffer.push(trimmed.slice(2).trimEnd());
        }
      } else if (trimmed.startsWith("package ")) {
        const pkgMatch = trimmed.match(/^package\s+(\w+)/);
        if (pkgMatch) {
          packageName = pkgMatch[1];
          packageDoc = docBuffer.join("\n").trim();
        }
        docBuffer = [];
      } else if (lineHasCodeOutsideComments) {
        const decl = tryParseDeclaration(lines, i, docBuffer.join("\n").trim());
        if (decl) {
          decls.push(decl.decl);
          // Skip ahead past the multi-line signature we just captured
          // so we don't re-enter the body's braces.
          i = decl.endLine;
          // Reset depth + comment state to where we should be AFTER
          // the captured decl (scanLineState already accounted for the
          // current line; the captured range's braces are intentionally
          // ignored because the captured signature stops at `{` or `)` /
          // matching delimiter).
          inBlockComment = false;
          braceDepth = 0;
          docBuffer = [];
          continue;
        }
        // Code line that isn't a declaration we recognised — clear doc
        // buffer so it doesn't latch onto a later unrelated decl.
        docBuffer = [];
      }
    } else if (startedInBlockComment && braceDepth === 0) {
      // Continuing a multi-line block comment at top level: keep
      // accumulating into docBuffer until we hit `*/`.
      const closeIdx = line.indexOf("*/");
      if (closeIdx === -1) {
        docBuffer.push(line.replace(/^\s*\*\s?/, "").trimEnd());
      } else {
        docBuffer.push(line.slice(0, closeIdx).replace(/^\s*\*\s?/, "").trimEnd());
      }
    }

    inBlockComment = newInBlockComment;
    braceDepth += depthDelta;
    if (braceDepth < 0) braceDepth = 0; // defensive: never go negative
  }

  return { packageName, packageDoc, decls };
}

// ─── Line-state scanner ─────────────────────────────────────────────

/**
 * Walks a single line of Go source and reports:
 *   - whether it left us inside a block comment
 *   - the net change in brace depth caused by `{` / `}` characters
 *     that are not inside strings or comments
 *   - whether the line contains any actual code (used to distinguish
 *     pure-comment lines from code that might be a declaration)
 */
function scanLineState(
  line: string,
  startInBlockComment: boolean,
): {
  newInBlockComment: boolean;
  depthDelta: number;
  lineHasCodeOutsideComments: boolean;
} {
  let inBlock = startInBlockComment;
  let inString = false; // "..."
  let inRaw = false; // `...`
  let inRune = false; // '...'
  let depth = 0;
  let hasCode = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = line[i + 1];

    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (inRaw) {
      if (c === "`") inRaw = false;
      continue;
    }
    if (inRune) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "'") inRune = false;
      continue;
    }

    // Outside any string/comment.
    if (c === "/" && next === "/") break; // rest of line is line-comment
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      hasCode = true;
      continue;
    }
    if (c === "`") {
      inRaw = true;
      hasCode = true;
      continue;
    }
    if (c === "'") {
      inRune = true;
      hasCode = true;
      continue;
    }
    if (c === "{") {
      depth++;
      hasCode = true;
      continue;
    }
    if (c === "}") {
      depth--;
      hasCode = true;
      continue;
    }
    if (!/\s/.test(c)) hasCode = true;
  }

  return {
    newInBlockComment: inBlock,
    depthDelta: depth,
    lineHasCodeOutsideComments: hasCode,
  };
}

// ─── Declaration parsing ────────────────────────────────────────────

/**
 * Tries to interpret `lines[start]` as the start of a top-level Go
 * declaration. Returns the captured signature + the index of the last
 * line consumed so the outer walker can resume after it.
 *
 * Unexported (lowercase) names are filtered out at this layer.
 */
function tryParseDeclaration(
  lines: string[],
  start: number,
  doc: string,
): { decl: ExtractedDecl; endLine: number } | null {
  const line = lines[start];
  const trimmed = line.trim();

  // func — may be top-level function or method
  if (/^func\b/.test(trimmed)) {
    return parseFunc(lines, start, doc);
  }

  // type — may be single line `type X = Y`, `type X Y`, or multi-line
  // `type X struct { ... }` / `type X interface { ... }`
  if (/^type\b/.test(trimmed)) {
    return parseType(lines, start, doc);
  }

  // const / var groups
  if (/^const\s*\(/.test(trimmed)) {
    return parseGroup(lines, start, doc, "const");
  }
  if (/^var\s*\(/.test(trimmed)) {
    return parseGroup(lines, start, doc, "var");
  }

  // const / var single-line
  if (/^const\b/.test(trimmed)) {
    return parseSingle(lines, start, doc, "const");
  }
  if (/^var\b/.test(trimmed)) {
    return parseSingle(lines, start, doc, "var");
  }

  return null;
}

/**
 * Walks forward from a line starting with `func` and captures the
 * function signature up to (but not including) the opening `{` of the
 * body. Methods with a receiver are tagged so we can group them.
 *
 * Handles three shapes:
 *   1. Single-line w/ inline body:  `func Foo() error { return nil }`
 *   2. Single-line, brace at EOL:   `func Foo() error {`
 *   3. Multi-line signature:        `func Foo(\n  a int,\n) error {`
 *
 * The body opener `{` is located by walking characters string- and
 * comment-aware (same logic as scanLineState) so braces inside types
 * (`map[K]V{...}` etc. — unusual in signatures but possible in return
 * types like `func Foo() struct{ A int }`) don't trip the search.
 */
function parseFunc(
  lines: string[],
  start: number,
  doc: string,
): { decl: ExtractedDecl; endLine: number } | null {
  const sigLines: string[] = [];
  let end = start;
  let truncatedLastLine: string | null = null;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    end = i;
    const bodyBrace = findBodyBrace(line);
    if (bodyBrace !== -1) {
      sigLines.push(line.slice(0, bodyBrace).trimEnd());
      truncatedLastLine = sigLines[sigLines.length - 1];
      break;
    }
    sigLines.push(line);
  }

  // Fallback: hit EOF without finding a `{`. Treat whole accumulated
  // text as signature (likely a malformed file or an interface method).
  if (truncatedLastLine === null) {
    // nothing
  }

  const signature = sigLines.join("\n").trim();

  // Name + receiver extraction. Accepts:
  //   func Foo(...)              -> name=Foo, receiver=undefined
  //   func (m *Msg) Foo(...)     -> name=Foo, receiver=Msg
  //   func (m Msg) Foo(...)      -> name=Msg
  //   func (Msg) Foo(...)        -> name=Foo, receiver=Msg
  const flat = signature.replace(/\s+/g, " ");
  const methodMatch = flat.match(/^func\s+\(\s*[\w*]*\s*\*?\s*(\w+)\s*\)\s+(\w+)/);
  if (methodMatch) {
    const receiver = methodMatch[1];
    const name = methodMatch[2];
    if (!isExported(name)) return null;
    return {
      decl: { kind: "method", name, receiver, signature, doc },
      endLine: end,
    };
  }

  const funcMatch = flat.match(/^func\s+(\w+)/);
  if (funcMatch) {
    const name = funcMatch[1];
    if (!isExported(name)) return null;
    return {
      decl: { kind: "func", name, signature, doc },
      endLine: end,
    };
  }
  return null;
}

/**
 * Walks forward from a line starting with `type` and captures:
 *   - `type Name struct { ... }`   — until matching `}` (depth-tracked)
 *   - `type Name interface { ... }` — same
 *   - `type Name = Other`           — single line
 *   - `type Name Other`             — single line
 *   - `type ( ... )`                 — grouped type decls
 */
function parseType(
  lines: string[],
  start: number,
  doc: string,
): { decl: ExtractedDecl; endLine: number } | null {
  const first = lines[start].trim();

  // Grouped type decl: `type (` — capture until matching `)` and emit a
  // single block.
  if (/^type\s*\(/.test(first)) {
    const captured = captureBalanced(lines, start, "(", ")");
    return {
      decl: {
        kind: "type",
        name: "(group)",
        signature: captured.text,
        doc,
      },
      endLine: captured.endLine,
    };
  }

  // Single-line or struct/interface block. Extract name first.
  const nameMatch = first.match(/^type\s+(\w+)/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  if (!isExported(name)) return null;

  // If the first line ends with `{`, it's a struct/interface body.
  // Capture until the matching `}`.
  if (stripLineComment(first).replace(/\s+$/, "").endsWith("{")) {
    const captured = captureBalanced(lines, start, "{", "}");
    return {
      decl: { kind: "type", name, signature: captured.text, doc },
      endLine: captured.endLine,
    };
  }

  // Single-line type decl.
  return {
    decl: { kind: "type", name, signature: first, doc },
    endLine: start,
  };
}

/** const ( ... ) / var ( ... ) group. */
function parseGroup(
  lines: string[],
  start: number,
  doc: string,
  kind: "const" | "var",
): { decl: ExtractedDecl; endLine: number } | null {
  const captured = captureBalanced(lines, start, "(", ")");
  // Filter group: only emit if at least one name in the group is
  // exported. Names are anything matching ^\s*\w+ at depth 1.
  const hasExported = captured.text
    .split("\n")
    .slice(1, -1)
    .some((l) => {
      const m = l.trim().match(/^(\w+)/);
      return m ? isExported(m[1]) : false;
    });
  if (!hasExported) return null;

  return {
    decl: { kind, name: "(group)", signature: captured.text, doc },
    endLine: captured.endLine,
  };
}

/** single-line const X = ... / var X T */
function parseSingle(
  lines: string[],
  start: number,
  doc: string,
  kind: "const" | "var",
): { decl: ExtractedDecl; endLine: number } | null {
  const line = lines[start].trim();
  const m = line.match(/^(?:const|var)\s+(\w+)/);
  if (!m) return null;
  const name = m[1];
  if (!isExported(name)) return null;
  return {
    decl: { kind, name, signature: line, doc },
    endLine: start,
  };
}

/**
 * Captures lines from `start` until the depth of `open` characters
 * minus `close` characters returns to 0 (after accounting for the
 * opening one on the start line). String/comment-aware via
 * scanLineState's character walker logic, simplified here for
 * delimiters that aren't necessarily `{`/`}`.
 */
function captureBalanced(
  lines: string[],
  start: number,
  open: string,
  close: string,
): { text: string; endLine: number } {
  let depth = 0;
  const captured: string[] = [];
  let inBlock = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    captured.push(line);
    // Walk characters tracking strings/comments so braces/parens
    // inside strings or comments don't perturb depth.
    let inString = false;
    let inRaw = false;
    let inRune = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      const next = line[j + 1];
      if (inBlock) {
        if (c === "*" && next === "/") {
          inBlock = false;
          j++;
        }
        continue;
      }
      if (inString) {
        if (c === "\\") {
          j++;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (inRaw) {
        if (c === "`") inRaw = false;
        continue;
      }
      if (inRune) {
        if (c === "\\") {
          j++;
          continue;
        }
        if (c === "'") inRune = false;
        continue;
      }
      if (c === "/" && next === "/") break;
      if (c === "/" && next === "*") {
        inBlock = true;
        j++;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "`") {
        inRaw = true;
        continue;
      }
      if (c === "'") {
        inRune = true;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) depth--;
    }
    if (depth === 0 && i > start) {
      return { text: captured.join("\n"), endLine: i };
    }
    // Edge case: opener and closer on the same line (e.g.
    // `type X = struct{}` — though uncommon).
    if (depth === 0 && i === start) {
      return { text: captured.join("\n"), endLine: i };
    }
  }
  // Unterminated — return what we have.
  return { text: captured.join("\n"), endLine: lines.length - 1 };
}

// ─── Helpers ────────────────────────────────────────────────────────

function isExported(name: string): boolean {
  if (!name) return false;
  const first = name[0];
  return first >= "A" && first <= "Z";
}

/**
 * Returns the index of the body-opener `{` on this line, or -1 if
 * none. "Body opener" means an unmatched `{` at brace-depth 0 on this
 * line, ignoring `{` inside strings/comments. Used by parseFunc to
 * truncate the captured signature at the start of the body.
 */
function findBodyBrace(line: string): number {
  let inBlock = false;
  let inString = false;
  let inRaw = false;
  let inRune = false;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = line[i + 1];
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (inRaw) {
      if (c === "`") inRaw = false;
      continue;
    }
    if (inRune) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "'") inRune = false;
      continue;
    }
    if (c === "/" && next === "/") return -1;
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "`") {
      inRaw = true;
      continue;
    }
    if (c === "'") {
      inRune = true;
      continue;
    }
    if (c === "{") {
      // Body opener is the FIRST `{` at depth 0 — anything inside (e.g.
      // a return type like `func Foo() struct{ A int } { ... }`)
      // will appear later but we want the outermost first.
      if (depth === 0) return i;
      depth++;
      continue;
    }
    if (c === "}") {
      depth--;
    }
  }
  return -1;
}

function stripLineComment(line: string): string {
  // Strip a trailing `// ...` line comment, ignoring `//` that
  // appears inside a string. Cheap version: walk char by char.
  let inString = false;
  let inRaw = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = line[i + 1];
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (inRaw) {
      if (c === "`") inRaw = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "`") {
      inRaw = true;
      continue;
    }
    if (c === "/" && next === "/") return line.slice(0, i);
  }
  return line;
}

function stripLineCommentPrefix(s: string): string {
  // "// foo" -> "foo"
  // "//foo"  -> "foo"
  // "//"     -> ""
  return s.replace(/^\/\/\s?/, "");
}

function isCompilerDirective(s: string): boolean {
  // //go:build, //go:generate, //go:noinline, //+build (legacy), etc.
  return /^\/\/(go:|\+build\b)/.test(s);
}

// ─── Markdown rendering ─────────────────────────────────────────────

export function goToMarkdown(filePath: string, source: string): string {
  const extracted = extractGoDocs(source);

  const lines: string[] = [];
  lines.push(`# ${filePath}`);
  lines.push("");

  if (extracted.packageName) {
    lines.push(`\`package ${extracted.packageName}\``);
    lines.push("");
  }

  if (extracted.packageDoc) {
    lines.push(extracted.packageDoc);
    lines.push("");
  }

  // Order decls: package-level helpers first, then methods grouped by
  // receiver. Within each group preserve source order.
  const topLevel = extracted.decls.filter((d) => d.kind !== "method");
  const methods = extracted.decls.filter((d) => d.kind === "method");

  for (const d of topLevel) {
    appendDecl(lines, d);
  }

  if (methods.length > 0) {
    // Group methods by receiver under a single ## section per type.
    const byReceiver = new Map<string, ExtractedDecl[]>();
    for (const m of methods) {
      const key = m.receiver ?? "(unknown)";
      const arr = byReceiver.get(key) ?? [];
      arr.push(m);
      byReceiver.set(key, arr);
    }
    for (const [recv, ms] of byReceiver) {
      lines.push(`## Methods on ${recv}`);
      lines.push("");
      for (const m of ms) {
        lines.push(`### ${m.name}`);
        lines.push("");
        lines.push("```go");
        lines.push(m.signature);
        lines.push("```");
        lines.push("");
        if (m.doc) {
          lines.push(m.doc);
          lines.push("");
        }
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function appendDecl(lines: string[], d: ExtractedDecl): void {
  const heading =
    d.name === "(group)" ? `## ${d.kind} block` : `## ${d.kind} ${d.name}`;
  lines.push(heading);
  lines.push("");
  lines.push("```go");
  lines.push(d.signature);
  lines.push("```");
  lines.push("");
  if (d.doc) {
    lines.push(d.doc);
    lines.push("");
  }
}
