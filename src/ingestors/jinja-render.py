#!/usr/bin/env python3
"""Batch-render Jinja2 templates for TRaSH-Guides markdownextradata pages.

Reads a single JSON object from stdin of the form:

    {"templates": ["...", ...], "data": {"sonarr": {...}, "radarr": {...}}}

and writes a JSON array of the rendered strings to stdout. The `data`
object mirrors markdownextradata's namespace (`docs/json/**` loaded as
nested dicts keyed by relative path). Top-level keys that are not valid
Python identifiers (e.g. `guide-only`) are dropped - the templates only
reference `sonarr` / `radarr` as bare names.

Uses `jinja2.DebugUndefined` to match the upstream plugin, so missing
keys render as empty strings (and `x is defined` / `x.get(...)` tests
behave) instead of raising.
"""

import json
import sys

import jinja2


def main() -> None:
    payload = json.load(sys.stdin)
    templates = payload["templates"]
    data = payload.get("data", {})

    env = jinja2.Environment(undefined=jinja2.DebugUndefined)
    context = {k: v for k, v in data.items() if k.isidentifier()}

    results = [env.from_string(template).render(**context) for template in templates]
    sys.stdout.write(json.dumps(results))


if __name__ == "__main__":
    main()
