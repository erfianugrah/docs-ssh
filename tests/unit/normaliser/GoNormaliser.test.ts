import { describe, it, expect } from "vitest";
import { GoNormaliser, extractGoDocs, goToMarkdown } from "../../../src/normaliser/GoNormaliser.js";
import { DocFile } from "../../../src/domain/DocFile.js";

describe("GoNormaliser", () => {
  const normaliser = new GoNormaliser();

  it("supports .go files", () => {
    expect(normaliser.supports(new DocFile("foo.go", ""))).toBe(true);
  });

  it("does not support .md / .mdx files", () => {
    expect(normaliser.supports(new DocFile("foo.md", ""))).toBe(false);
    expect(normaliser.supports(new DocFile("foo.mdx", ""))).toBe(false);
  });

  it("supportsFormat is true only for godoc", () => {
    expect(normaliser.supportsFormat("godoc")).toBe(true);
    expect(normaliser.supportsFormat("markdown")).toBe(false);
    expect(normaliser.supportsFormat("html")).toBe(false);
    expect(normaliser.supportsFormat("mdx")).toBe(false);
    expect(normaliser.supportsFormat("openapi")).toBe(false);
  });

  it("renames .go to .md on normalise", async () => {
    const file = new DocFile("pkg/foo.go", "package foo\n");
    const result = await normaliser.normalise(file);
    expect(result.path).toBe("pkg/foo.md");
  });
});

describe("extractGoDocs — package", () => {
  it("captures package name and package-level doc comment", () => {
    const src = `// Package foo does foo things.
// It is great.
package foo
`;
    const out = extractGoDocs(src);
    expect(out.packageName).toBe("foo");
    expect(out.packageDoc).toBe("Package foo does foo things.\nIt is great.");
  });

  it("captures package doc from /* */ block comment", () => {
    const src = `/*
Package bar is documented in a block comment.

Multi-line.
*/
package bar
`;
    const out = extractGoDocs(src);
    expect(out.packageName).toBe("bar");
    expect(out.packageDoc).toContain("Package bar is documented");
    expect(out.packageDoc).toContain("Multi-line.");
  });

  it("blank line between comment and package decl clears doc buffer", () => {
    const src = `// This is a copyright notice.

package quux
`;
    const out = extractGoDocs(src);
    expect(out.packageName).toBe("quux");
    expect(out.packageDoc).toBe("");
  });
});

describe("extractGoDocs — functions", () => {
  it("captures exported func with doc", () => {
    const src = `package x

// Foo does a foo.
// It returns an error if things go wrong.
func Foo(a int, b string) error {
    return nil
}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0]).toMatchObject({
      kind: "func",
      name: "Foo",
      doc: "Foo does a foo.\nIt returns an error if things go wrong.",
    });
    expect(out.decls[0].signature).toContain("func Foo(a int, b string) error");
  });

  it("skips unexported func", () => {
    const src = `package x

// foo is private.
func foo() {}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(0);
  });

  it("captures method with receiver", () => {
    const src = `package x

// Pack writes the message into b.
func (m *Msg) Pack(b []byte) ([]byte, error) {
    return nil, nil
}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0]).toMatchObject({
      kind: "method",
      name: "Pack",
      receiver: "Msg",
    });
  });

  it("captures multi-line function signature", () => {
    const src = `package x

// Big takes lots of args.
func Big(
    a int,
    b string,
    c []byte,
) (int, error) {
    return 0, nil
}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0].name).toBe("Big");
    expect(out.decls[0].signature).toContain("a int");
    expect(out.decls[0].signature).toContain("c []byte");
    expect(out.decls[0].signature).not.toContain("return 0");
  });

  it("doc must be immediately adjacent — blank line breaks attachment", () => {
    const src = `package x

// Stray comment.

func Foo() {}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0].doc).toBe("");
  });
});

describe("extractGoDocs — types", () => {
  it("captures struct type with body", () => {
    const src = `package x

// Msg is the DNS message.
type Msg struct {
    Header MsgHeader
    Question []Question
    Answer []RR
}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0]).toMatchObject({ kind: "type", name: "Msg" });
    expect(out.decls[0].signature).toContain("type Msg struct");
    expect(out.decls[0].signature).toContain("Question []Question");
  });

  it("captures interface type", () => {
    const src = `package x

// Handler handles DNS requests.
type Handler interface {
    ServeDNS(w ResponseWriter, r *Msg)
}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0]).toMatchObject({ kind: "type", name: "Handler" });
    expect(out.decls[0].signature).toContain("interface");
  });

  it("captures single-line type alias", () => {
    const src = `package x

// Name is a domain name.
type Name = string
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0]).toMatchObject({ kind: "type", name: "Name" });
    expect(out.decls[0].signature).toBe("type Name = string");
  });
});

describe("extractGoDocs — const / var", () => {
  it("captures grouped const block when any name is exported", () => {
    const src = `package x

// Type codes.
const (
    TypeA  uint16 = 1
    TypeNS uint16 = 2
)
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0]).toMatchObject({ kind: "const", name: "(group)" });
    expect(out.decls[0].signature).toContain("TypeA");
    expect(out.decls[0].signature).toContain("TypeNS");
  });

  it("skips grouped const block where all names unexported", () => {
    const src = `package x

const (
    internalA = 1
    internalB = 2
)
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(0);
  });

  it("captures single-line exported var", () => {
    const src = `package x

// DefaultClient is the default DNS client.
var DefaultClient = &Client{}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0]).toMatchObject({ kind: "var", name: "DefaultClient" });
  });
});

describe("extractGoDocs — robustness", () => {
  it("ignores braces inside strings", () => {
    const src = `package x

// Foo returns a json blob.
func Foo() string {
    return "{ this } is not a real brace"
}

// Bar comes after.
func Bar() {}
`;
    const out = extractGoDocs(src);
    const names = out.decls.map((d) => d.name);
    expect(names).toContain("Foo");
    expect(names).toContain("Bar");
  });

  it("ignores braces inside raw strings (backticks)", () => {
    const src = `package x

// Foo uses raw string.
func Foo() string {
    return ` +
      "`" +
      `{ not a brace }` +
      "`" +
      `
}

// Bar after.
func Bar() {}
`;
    const out = extractGoDocs(src);
    expect(out.decls.map((d) => d.name)).toEqual(expect.arrayContaining(["Foo", "Bar"]));
  });

  it("ignores braces inside line comments", () => {
    const src = `package x

// Foo has a // { comment } inside.
func Foo() {
    // { this should not start a block }
    return
}

// Bar after.
func Bar() {}
`;
    const out = extractGoDocs(src);
    expect(out.decls.map((d) => d.name)).toEqual(expect.arrayContaining(["Foo", "Bar"]));
  });

  it("skips compiler directives", () => {
    const src = `//go:build linux

package x

// Foo is documented.
func Foo() {}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0].name).toBe("Foo");
    expect(out.decls[0].doc).toBe("Foo is documented.");
  });

  it("handles import block without crashing", () => {
    const src = `package x

import (
    "fmt"
    "strings"
)

// Foo uses fmt.
func Foo() {
    fmt.Println(strings.ToUpper("x"))
}
`;
    const out = extractGoDocs(src);
    expect(out.decls).toHaveLength(1);
    expect(out.decls[0].name).toBe("Foo");
  });
});

describe("goToMarkdown — output structure", () => {
  it("emits H1 with file path and package code-span", () => {
    const md = goToMarkdown("dns.go", `package dns\n`);
    expect(md).toContain("# dns.go");
    expect(md).toContain("`package dns`");
  });

  it("emits package doc as a paragraph under the package code-span", () => {
    const md = goToMarkdown(
      "doc.go",
      `// Package dns implements a DNS library.
// More words here.
package dns
`,
    );
    expect(md).toContain("`package dns`");
    expect(md).toMatch(/Package dns implements a DNS library\.\nMore words here\./);
  });

  it("emits each top-level decl as a ## section with a go fenced block", () => {
    const md = goToMarkdown(
      "x.go",
      `package x

// Foo is foo.
func Foo() error { return nil }

// Bar is bar.
type Bar struct {
    A int
}
`,
    );
    expect(md).toContain("## func Foo");
    expect(md).toContain("```go\nfunc Foo() error\n```");
    expect(md).toContain("## type Bar");
    expect(md).toContain("type Bar struct");
  });

  it("groups methods by receiver under a single ## section", () => {
    const md = goToMarkdown(
      "msg.go",
      `package dns

type Msg struct{}

// Pack serializes.
func (m *Msg) Pack() ([]byte, error) { return nil, nil }

// Unpack deserializes.
func (m *Msg) Unpack(b []byte) error { return nil }
`,
    );
    expect(md).toMatch(/## Methods on Msg/);
    expect(md).toContain("### Pack");
    expect(md).toContain("### Unpack");
    // Only one "Methods on Msg" heading.
    expect(md.match(/## Methods on Msg/g)?.length).toBe(1);
  });

  it("produces clean output for empty / unexported-only files", () => {
    const md = goToMarkdown("only-private.go", `package x

func privateOnly() {}
`);
    expect(md).toContain("# only-private.go");
    expect(md).toContain("`package x`");
    // No ## sections since nothing exported.
    expect(md).not.toContain("## func");
  });
});
