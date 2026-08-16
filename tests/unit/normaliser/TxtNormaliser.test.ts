import { describe, it, expect } from "vitest";
import { TxtNormaliser } from "../../../src/normaliser/TxtNormaliser.js";
import { DocFile } from "../../../src/domain/DocFile.js";

const normaliser = new TxtNormaliser();

// Header fixtures modelled on real RFC Editor text output.

const RFC_9110 = `\uFEFFInternet Engineering Task Force (IETF)                  R. Fielding, Ed.
Request for Comments: 9110                                         Adobe
STD: 97                                               M. Nottingham, Ed.
Obsoletes: 2818, 7230, 7231, 7232, 7233, 7235,                    Fastly
           7538, 7615, 7694                              J. Reschke, Ed.
Updates: 3864                                                 greenbytes
Category: Standards Track                                      June 2022
ISSN: 2070-1721


                             HTTP Semantics

Abstract

   The Hypertext Transfer Protocol (HTTP) is a stateless application-
   level protocol.
`;

const RFC_9293 = `\uFEFFInternet Engineering Task Force (IETF)                      W. Eddy, Ed.
STD: 7                                                       MTI Systems
Request for Comments: 9293                                   August 2022
Obsoletes: 793, 879, 2873, 6093, 6429, 6528
           6691
Updates: 1011, 1122, 5961
Category: Standards Track
ISSN: 2070-1721


                  Transmission Control Protocol (TCP)

Abstract
`;

const RFC_793 = `

RFC: 793





                     TRANSMISSION CONTROL PROTOCOL

                         DARPA INTERNET PROGRAM

                         PROTOCOL SPECIFICATION


                             September 1981
`;

const RFC_1 = `Network Working Group                                   Steve Crocker
Request for Comments: 1                                          UCLA
                                                         7 April 1969


                         Title:   Host Software
                        Author:   Steve Crocker
                          Installation:   UCLA
                          Date:   7 April 1969
`;

const RFC_5234 = `Network Working Group                                    D. Crocker, Ed.
Request for Comments: 5234                   Brandenburg InternetWorking
STD: 68                                                       P. Overell
Obsoletes: 4234                                                THUS plc.
Category: Standards Track                                   January 2008


             Augmented BNF for Syntax Specifications: ABNF

Status of This Memo
`;

// bcp9.txt opens with a concatenation note before the header block.
const BCP_9 = `\uFEFF[Note that this file is a concatenation of more than one RFC.]


Network Working Group                                         S. Bradner
Request for Comments: 2026                            Harvard University
BCP: 9                                                      October 1996
Obsoletes: 1602
Category: Best Current Practice


              The Internet Standards Process -- Revision 3


Status of this Memo
`;

// Recent xml2rfc wraps long titles at column 1-3 instead of centering.
const RFC_9999 = `\uFEFFInternet Engineering Task Force (IETF)                       H. Birkholz
Request for Comments: 9999                                Fraunhofer SIT
Category: Standards Track                                       N. Smith
ISSN: 2070-1721                                              Independent
                                                              T. Fossati
                                                               July 2026

 Remote ATtestation procedureS (RATS) Conceptual Message Wrapper (CMW)

Abstract
`;

// Newest xml2rfc emits long titles flush-left (column 0).
const RFC_9973 = `\uFEFFInternet Engineering Task Force (IETF)                        R. Housley
Request for Comments: 9973                                Vigil Security
Obsoletes: 8773                                                July 2026
Category: Standards Track
ISSN: 2070-1721


TLS 1.3 Extension for Using Certificates with an External Pre-Shared Key

Abstract
`;

describe("TxtNormaliser", () => {
  it("supports .txt files", () => {
    expect(normaliser.supports(new DocFile("rfc1.txt", "x"))).toBe(true);
    expect(normaliser.supports(new DocFile("readme.md", "x"))).toBe(false);
  });

  it("supports the txt format only", () => {
    expect(normaliser.supportsFormat("txt")).toBe(true);
    expect(normaliser.supportsFormat("html")).toBe(false);
    expect(normaliser.supportsFormat("markdown")).toBe(false);
  });

  it("extracts the title from a modern xml2rfc header", async () => {
    const out = await normaliser.normalise(new DocFile("rfc9110.txt", RFC_9110));
    expect(out!.path).toBe("rfc9110.md");
    expect(out!.content.startsWith("# RFC 9110: HTTP Semantics\n")).toBe(true);
  });

  it("handles multi-line Obsoletes continuations and parenthesised titles", async () => {
    const out = await normaliser.normalise(new DocFile("rfc9293.txt", RFC_9293));
    expect(out!.content.startsWith("# RFC 9293: Transmission Control Protocol (TCP)\n")).toBe(true);
  });

  it("extracts the centered title from an ancient RFC header", async () => {
    const out = await normaliser.normalise(new DocFile("rfc793.txt", RFC_793));
    expect(out!.content.startsWith("# RFC 793: TRANSMISSION CONTROL PROTOCOL\n")).toBe(true);
  });

  it("uses an explicit Title: field when present (RFC 1 style)", async () => {
    const out = await normaliser.normalise(new DocFile("rfc1.txt", RFC_1));
    expect(out!.content.startsWith("# RFC 1: Host Software\n")).toBe(true);
  });

  it("keeps a colon inside a real title", async () => {
    const out = await normaliser.normalise(new DocFile("rfc5234.txt", RFC_5234));
    expect(out!.content.startsWith("# RFC 5234: Augmented BNF for Syntax Specifications: ABNF\n")).toBe(true);
  });

  it("skips a preamble note before the header block (bcp9 concatenation)", async () => {
    const out = await normaliser.normalise(new DocFile("bcp/bcp9.txt", BCP_9));
    expect(out!.content.startsWith("# BCP 9: The Internet Standards Process -- Revision 3\n")).toBe(true);
  });

  it("accepts a title indented by a single space (recent xml2rfc)", async () => {
    const out = await normaliser.normalise(new DocFile("rfc9999.txt", RFC_9999));
    expect(
      out!.content.startsWith(
        "# RFC 9999: Remote ATtestation procedureS (RATS) Conceptual Message Wrapper (CMW)\n",
      ),
    ).toBe(true);
  });

  it("accepts a flush-left title after a recognised header block", async () => {
    const out = await normaliser.normalise(new DocFile("rfc9973.txt", RFC_9973));
    expect(
      out!.content.startsWith(
        "# RFC 9973: TLS 1.3 Extension for Using Certificates with an External Pre-Shared Key\n",
      ),
    ).toBe(true);
  });

  it("labels subseries files from their filename", async () => {
    const out = await normaliser.normalise(new DocFile("bcp/bcp9.txt", RFC_5234));
    expect(out!.path).toBe("bcp/bcp9.md");
    expect(out!.content.startsWith("# BCP 9: ")).toBe(true);
  });

  it("falls back to the filename stem for non-series files", async () => {
    const out = await normaliser.normalise(new DocFile("rfc-index.txt", "just some text\n"));
    expect(out!.content.startsWith("# rfc-index\n")).toBe(true);
  });

  it("falls back to the bare label when no title is found", async () => {
    const out = await normaliser.normalise(new DocFile("rfc9999.txt", "no header here\n"));
    expect(out!.content.startsWith("# RFC 9999\n")).toBe(true);
  });

  it("emits the abstract as prose between heading and fence", async () => {
    const out = await normaliser.normalise(new DocFile("rfc9110.txt", RFC_9110));
    expect(out!.content).toContain(
      "# RFC 9110: HTTP Semantics\n\nThe Hypertext Transfer Protocol (HTTP) is a stateless application- level protocol.\n\n```text",
    );
  });

  it("omits the abstract when there is no Abstract section", async () => {
    const out = await normaliser.normalise(new DocFile("rfc793.txt", RFC_793));
    expect(out!.content).toContain("# RFC 793: TRANSMISSION CONTROL PROTOCOL\n\n```text");
  });

  it("wraps the body in a fenced block and strips BOM, form feeds, page footers", async () => {
    const body = `\uFEFFline one\fline two\n[Page 12]\nline three\n`;
    const out = await normaliser.normalise(new DocFile("rfc42.txt", body));
    expect(out!.content).toContain("```text\n");
    expect(out!.content).not.toContain("\uFEFF");
    expect(out!.content).not.toContain("\f");
    expect(out!.content).not.toContain("[Page 12]");
    expect(out!.content).toContain("line one");
    expect(out!.content).toContain("line three");
  });
});
