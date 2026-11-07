#!/usr/bin/env python3
"""Batch-render reStructuredText files to HTML5 via docutils.

Reads a single JSON object from stdin of the form:

    {"files": [["rel/path.rst", "content..."], ...]}

and writes a JSON array of [relPath, html5String] pairs to stdout.
Files that cause a docutils error are rendered as a single error
paragraph naming the exception so the corpus still gets a page (with
the raw RST as a fenced code block for debugging).

Register Sphinx-directive and role stubs so pages with Sphinx-specific
markup render instead of erroring. Every stub produces a visible
placeholder so a human or downstream agent sees what was lost.
"""

import json
import sys

import docutils.core
import docutils.nodes
from docutils.parsers import rst
from docutils.parsers.rst import directives, roles
from docutils.writers import html5_polyglot

# ── Sphinx directive stubs (produce a placeholder paragraph) ─────────

def _sphinx_directive(name, argument=""):
    """Register a stub that renders "[directive: name]" as a paragraph."""
    def run(directive_name, arguments, options, content, lineno,
            content_offset, block_text, state, state_machine):
        para = docutils.nodes.paragraph("", "")
        para += docutils.nodes.Text(f"[directive: {directive_name}]")
        if content:
            pre = docutils.nodes.literal_block("", "")
            pre += docutils.nodes.Text("\n".join(content))
            return [para, pre]
        return [para]
    # docutils >=0.19 has no `has_content` default, earlier versions
    # want it; setting False + ignoring `content` works on both.
    run.content = True
    directives.register_directive(name, run)

# Sphinx-only directives NOT present in standard docutils. These
# produce a placeholder paragraph + the directive body as a literal
# block so the content is preserved. Standard docutils directives
# (note, warning, code, code-block, image, figure, sidebar, topic,
# rubric, admonition, container, compound, parsed-literal, table,
# csv-table, list-table, replace, unicode, raw, math, meta, title,
# contents, class, include, highlight, only) are left to their
# built-in handlers - they render correctly without stubs.
SPHINX_DIRECTIVES = [
    "toctree",
    "literalinclude",
    "automodule",
    "autoclass",
    "autofunction",
    "automethod",
    "autoattribute",
    "seealso",
    "versionadded",
    "versionchanged",
    "deprecated",
    "glossary",
    "hlist",
    "centered",
    "eval_rst",
]

# Already-registered standard docutils directives (no-op if re-registered):
# section, contents, attention, caution, danger, error, hint, important,
# tip, admonition, class, container, compound, parsed-literal, table,
# csv-table, list-table, replace, unicode, raw, math, meta, title.

for name in SPHINX_DIRECTIVES:
    try:
        _sphinx_directive(name)
    except Exception:
        pass  # already registered

# ── Sphinx role stubs ────────────────────────────────────────────────

def _sphinx_role(name):
    """Register a stub that renders "[role: name:`text`]" as inline text."""
    def role_fn(role_name, rawtext, text, lineno, inliner,
                options=None, content=None):
        node = docutils.nodes.inline("", "")
        node += docutils.nodes.Text(f"[{role_name}: `{text}`]")
        return [node], []
    roles.register_local_role(name, role_fn)

SPHINX_ROLES = [
    "ref", "doc", "class", "func", "meth", "term", "kbd", "file",
    "mod", "data", "const", "attr", "exc", "obj", "any", "command",
    "option", "envvar", "pep", "rfc", "numref", "eq", "abbr",
    "guilabel", "menuselection", "download", "token",
]

for name in SPHINX_ROLES:
    try:
        _sphinx_role(name)
    except Exception:
        pass

# ── Main ─────────────────────────────────────────────────────────────

def main() -> None:
    payload = json.load(sys.stdin)
    file_pairs = payload["files"]  # [[relPath, rstContent], ...]

    results = []
    for rel_path, rst_content in file_pairs:
        if rst_content.strip() == "":
            results.append([rel_path, ""])
            continue
        try:
            # publish_parts returns a dict with keys like 'title', 'body',
            # 'whole', etc. 'html_body' (since docutils 0.19) or 'body'
            # gives the inner HTML without <html>/<head>/<body> wrapper.
            parts = docutils.core.publish_parts(
                source=rst_content,
                writer=html5_polyglot.Writer(),
                settings_overrides={
                    "report_level": 5,          # suppress warnings
                    "halt_level": 6,            # never halt
                    "warning_stream": False,    # suppress stderr warnings
                },
            )
            html5 = parts.get("html_body", parts.get("body", ""))
            if html5.strip():
                results.append([rel_path, html5])
            else:
                # docutils produced an empty body (severe error).
                # Produce a page with the raw RST fenced.
                raise ValueError("empty body")
        except Exception as exc:
            # On any error, produce a minimal page so the file is not
            # silently dropped. Plain-text wrapper with the exception
            # reason plus the raw content in a fenced block.
            rendered = (
                f"<p>[rst-render error: {exc}]</p>\n"
                f"<pre><code>{_escape_html(rst_content)}</code></pre>"
            )
            results.append([rel_path, rendered])

    sys.stdout.write(json.dumps(results))


def _escape_html(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


if __name__ == "__main__":
    main()