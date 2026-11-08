import { describe, it, expect } from "vitest";
import {
  lexicanumPublicUrl,
  win32ApiPublicUrl,
  win32DocsPublicUrl,
  windowsDriversPublicUrl,
  windowsDdiPublicUrl,
} from "../../../src/application/public-urls.js";

describe("lexicanumPublicUrl (erfi-technical-blog)", () => {
  it("maps a guide to its published slug (lowercased)", () => {
    expect(lexicanumPublicUrl("src/content/docs/guides/supabase-shared-tenancy.mdx")).toBe(
      "https://erfi.dev/guides/supabase-shared-tenancy/",
    );
  });

  it("maps the root index to the site root", () => {
    expect(lexicanumPublicUrl("src/content/docs/index.mdx")).toBe("https://erfi.dev/");
  });

  it("maps a nested index to its directory", () => {
    expect(lexicanumPublicUrl("src/content/docs/reference/index.mdx")).toBe(
      "https://erfi.dev/reference/",
    );
    expect(lexicanumPublicUrl("src/content/docs/guides/Index.md")).toBe(
      "https://erfi.dev/guides/",
    );
  });

  it("handles .md as well as .mdx", () => {
    expect(lexicanumPublicUrl("src/content/docs/reference/foo.md")).toBe(
      "https://erfi.dev/reference/foo/",
    );
  });

  it("lowercases mixed-case paths", () => {
    expect(lexicanumPublicUrl("src/content/docs/Guides/Foo-Bar.mdx")).toBe(
      "https://erfi.dev/guides/foo-bar/",
    );
  });

  it("returns undefined outside the docs tree", () => {
    expect(lexicanumPublicUrl("src/pages/index.astro")).toBeUndefined();
    expect(lexicanumPublicUrl("README.md")).toBeUndefined();
  });
});

describe("win32ApiPublicUrl (MicrosoftDocs/sdk-api)", () => {
  const base = "https://learn.microsoft.com/en-us/windows/win32/api";

  it("maps a function page to its learn.microsoft.com URL", () => {
    expect(win32ApiPublicUrl("sdk-api-src/content/winreg/nf-winreg-regopenkeyexw.md")).toBe(
      `${base}/winreg/nf-winreg-regopenkeyexw`,
    );
  });

  it("maps a function page with mixed case to lowercase URL", () => {
    expect(win32ApiPublicUrl("sdk-api-src/content/SetupAPI/nf-setupapi-SetupDiGetClassDevsW.md")).toBe(
      `${base}/setupapi/nf-setupapi-setupdigetclassdevsw`,
    );
  });

  it("handles Windows backslash paths", () => {
    expect(win32ApiPublicUrl("sdk-api-src\\content\\winreg\\nf-winreg-regopenkeyexw.md")).toBe(
      `${base}/winreg/nf-winreg-regopenkeyexw`,
    );
  });

  it("returns undefined for paths outside sdk-api-src/content/", () => {
    expect(win32ApiPublicUrl("README.md")).toBeUndefined();
    expect(win32ApiPublicUrl("sdk-api-src/index.md")).toBeUndefined();
  });
});

describe("win32DocsPublicUrl (MicrosoftDocs/win32)", () => {
  const base = "https://learn.microsoft.com/en-us/windows/win32";

  it("maps a conceptual doc page", () => {
    expect(win32DocsPublicUrl("desktop-src/CoreAudio/wasapi.md")).toBe(
      `${base}/coreaudio/wasapi`,
    );
  });

  it("maps a nested page with mixed case", () => {
    expect(win32DocsPublicUrl("desktop-src/Services/svc-entry.md")).toBe(
      `${base}/services/svc-entry`,
    );
  });

  it("returns undefined for paths outside desktop-src/", () => {
    expect(win32DocsPublicUrl("README.md")).toBeUndefined();
    expect(win32DocsPublicUrl("other/file.md")).toBeUndefined();
  });
});

describe("windowsDriversPublicUrl (MicrosoftDocs/windows-driver-docs)", () => {
  const base = "https://learn.microsoft.com/en-us/windows-hardware/drivers";

  it("maps a driver doc page", () => {
    expect(windowsDriversPublicUrl("windows-driver-docs-pr/audio/index.md")).toBe(
      `${base}/audio/index`,
    );
  });

  it("maps a HID driver page", () => {
    expect(windowsDriversPublicUrl("windows-driver-docs-pr/hid/hid-transport.md")).toBe(
      `${base}/hid/hid-transport`,
    );
  });

  it("returns undefined for paths outside windows-driver-docs-pr/", () => {
    expect(windowsDriversPublicUrl("README.md")).toBeUndefined();
  });
});

describe("windowsDdiPublicUrl (MicrosoftDocs/windows-driver-docs-ddi)", () => {
  const base = "https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi";

  it("maps a DDI function page", () => {
    expect(windowsDdiPublicUrl("wdk-ddi-src/content/hidsdi/nf-hidsdi-hidd_getfeature.md")).toBe(
      `${base}/hidsdi/nf-hidsdi-hidd_getfeature`,
    );
  });

  it("maps with mixed case to lowercase", () => {
    expect(windowsDdiPublicUrl("wdk-ddi-src/content/HidPi/nf-hidpi-HidP_GetCaps.md")).toBe(
      `${base}/hidpi/nf-hidpi-hidp_getcaps`,
    );
  });

  it("returns undefined for paths outside wdk-ddi-src/content/", () => {
    expect(windowsDdiPublicUrl("README.md")).toBeUndefined();
    expect(windowsDdiPublicUrl("wdk-ddi-src/index.md")).toBeUndefined();
  });
});