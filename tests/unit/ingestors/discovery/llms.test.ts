import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverFromLlmsTxt } from "../../../../src/ingestors/discovery/llms.js";

function mockLlmsTxt(body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => body,
      headers: new Headers({ "content-type": "text/plain" }),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discoverFromLlmsTxt", () => {
  it("extracts absolute page URLs", async () => {
    mockLlmsTxt(
      "# Docs\n- [Testing](https://docs.example.com/testing.md): Simulate.\n- [API](https://docs.example.com/api.md)\n",
    );
    const urls = await discoverFromLlmsTxt("https://docs.example.com/llms.txt");
    expect(urls).toContain("https://docs.example.com/testing.md");
    expect(urls).toContain("https://docs.example.com/api.md");
  });

  it("strips URL fragments so anchor links do not become duplicate pages", async () => {
    mockLlmsTxt(
      [
        "- [Billing](https://docs.example.com/billing.md)",
        "- [Billing features](https://docs.example.com/billing.md#features)",
        "- [Terminal](https://docs.example.com/terminal.md#features)",
      ].join("\n"),
    );
    const urls = await discoverFromLlmsTxt("https://docs.example.com/llms.txt");
    expect(urls).toEqual(["https://docs.example.com/billing.md", "https://docs.example.com/terminal.md"]);
  });

  it("strips fragments from relative markdown links too", async () => {
    mockLlmsTxt("- [Guide](guides/start.md#setup)\n");
    const urls = await discoverFromLlmsTxt("https://docs.example.com/llms.txt");
    expect(urls).toEqual(["https://docs.example.com/guides/start.md"]);
  });
});
