import { describe, it, expect } from "vitest";
import { walkDir } from "../../../src/shared/walkDir.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("walkDir", () => {
  it("collects all files when no options provided", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "walkdir-test-"));
    await fs.writeFile(path.join(tmpDir, "readme.md"), "# Hello");
    await fs.writeFile(path.join(tmpDir, "data.json"), "{}");
    await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "sub", "nested.txt"), "nested");

    const files = new Map();
    await walkDir(tmpDir, tmpDir, files);

    expect(files.size).toBe(3);
    expect(files.has("readme.md")).toBe(true);
    expect(files.has("data.json")).toBe(true);
    expect(files.has(path.join("sub", "nested.txt"))).toBe(true);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("filters by extension when extensions option provided", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "walkdir-test-"));
    await fs.writeFile(path.join(tmpDir, "doc.md"), "# Doc");
    await fs.writeFile(path.join(tmpDir, "component.mdx"), "# MDX");
    await fs.writeFile(path.join(tmpDir, "page.html"), "<h1>HTML</h1>");
    await fs.writeFile(path.join(tmpDir, "config.json"), "{}");

    const files = new Map();
    await walkDir(tmpDir, tmpDir, files, {
      extensions: new Set(["md", "mdx"]),
    });

    expect(files.size).toBe(2);
    expect(files.has("doc.md")).toBe(true);
    expect(files.has("component.mdx")).toBe(true);
    expect(files.has("page.html")).toBe(false);
    expect(files.has("config.json")).toBe(false);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("applies pathTransform to relative paths", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "walkdir-test-"));
    await fs.mkdir(path.join(tmpDir, "src", "docs"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src", "docs", "guide.md"), "# Guide");

    const files = new Map();
    await walkDir(tmpDir, tmpDir, files, {
      pathTransform: (rel) => {
        const prefix = "src/docs/";
        return rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
      },
    });

    expect(files.size).toBe(1);
    // Path should have been transformed: "src/docs/guide.md" -> "guide.md"
    expect(files.has("guide.md")).toBe(true);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("reads file content correctly", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "walkdir-test-"));
    await fs.writeFile(path.join(tmpDir, "test.md"), "# Hello World\n\nSome content.");

    const files = new Map();
    await walkDir(tmpDir, tmpDir, files);

    expect(files.get("test.md")?.content).toBe("# Hello World\n\nSome content.");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("handles empty directories", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "walkdir-test-"));
    await fs.mkdir(path.join(tmpDir, "empty"), { recursive: true });

    const files = new Map();
    await walkDir(tmpDir, tmpDir, files);

    expect(files.size).toBe(0);

    await fs.rm(tmpDir, { recursive: true });
  });
});
