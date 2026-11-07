import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";

// The templates are TS source held in template literals, so a quoting
// slip only shows in the generated file (docs-ssh#29 shipped one that the
// string-level tests passed). Render each script and parse its output.
const root = path.resolve(__dirname, "../../..");

describe.each(["tools.sh", "tools-pi.sh"])("generated %s", (script) => {
  it("emits TypeScript with no syntax errors", () => {
    const out = execFileSync("sh", [path.join(root, "commands", script)], { encoding: "utf8" });
    const res = ts.transpileModule(out, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
    const msgs = (res.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(msgs).toEqual([]);
  });
});
