import { describe, it, expect } from "vitest";
import {
  PI_DYNAMIC_HEADER,
  PI_STATIC_BODY,
  PI_EXPECTED_TOOLS,
} from "../../../src/commands/tools-pi-template.js";

describe("tools-pi-template", () => {
  // ─── Dynamic header ────────────────────────────────────────────

  it("dynamic header contains pi imports", () => {
    expect(PI_DYNAMIC_HEADER).toContain('@earendil-works/pi-ai');
    expect(PI_DYNAMIC_HEADER).toContain('@earendil-works/pi-coding-agent');
  });

  it("dynamic header contains SSH_HOST placeholder", () => {
    expect(PI_DYNAMIC_HEADER).toContain('{{SSH_HOST}}');
  });

  it("dynamic header contains SSH_PORT placeholder", () => {
    expect(PI_DYNAMIC_HEADER).toContain('{{SSH_PORT}}');
  });

  it("dynamic header contains MAX_RESULT_CHARS", () => {
    expect(PI_DYNAMIC_HEADER).toContain('MAX_RESULT_CHARS = 51_200');
  });

  it("dynamic header does NOT contain zod", () => {
    expect(PI_DYNAMIC_HEADER).not.toContain('zod');
  });

  // ─── Static body ───────────────────────────────────────────────

  it("static body contains all 6 tool definitions", () => {
    for (const name of PI_EXPECTED_TOOLS) {
      expect(PI_STATIC_BODY).toContain(`name: "${name}"`);
    }
  });

  it("static body uses defineTool", () => {
    expect(PI_STATIC_BODY).toContain('defineTool(');
  });

  it("static body has default export with pi.registerTool calls", () => {
    expect(PI_STATIC_BODY).toContain('export default function');
    expect(PI_STATIC_BODY).toContain('pi.registerTool(');
  });

  it("static body registers all 6 tools", () => {
    const registerCount = (PI_STATIC_BODY.match(/pi\.registerTool\(/g) ?? []).length;
    expect(registerCount).toBe(PI_EXPECTED_TOOLS.length);
  });

  it("static body uses Type.Object for parameters (TypeBox, not Zod)", () => {
    expect(PI_STATIC_BODY).toContain('Type.Object(');
    expect(PI_STATIC_BODY).not.toContain('z.object(');
  });

  it("all tools have promptSnippet", () => {
    const snippetCount = (PI_STATIC_BODY.match(/promptSnippet:/g) ?? []).length;
    expect(snippetCount).toBe(PI_EXPECTED_TOOLS.length);
  });

  it("all tools have promptGuidelines", () => {
    const guidelineCount = (PI_STATIC_BODY.match(/promptGuidelines:/g) ?? []).length;
    expect(guidelineCount).toBe(PI_EXPECTED_TOOLS.length);
  });

  // ─── SSH helper ────────────────────────────────────────────────

  it("static body contains node:child_process spawn SSH helper", () => {
    expect(PI_STATIC_BODY).toContain('spawn(');
    expect(PI_STATIC_BODY).not.toContain('Bun.spawn(');
    expect(PI_STATIC_BODY).toContain('SSH_PORT');
    expect(PI_STATIC_BODY).toContain('SSH_HOST');
  });

  // ─── No heredoc delimiter collision ────────────────────────────

  it("static body does not contain PI_STATIC on its own line", () => {
    const lines = PI_STATIC_BODY.split('\n');
    for (const line of lines) {
      expect(line.trim()).not.toBe('PI_STATIC');
    }
  });
});
