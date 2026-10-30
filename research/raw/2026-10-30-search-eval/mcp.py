"""Minimal client for the docs.erfi.io MCP endpoint (stateless JSON-RPC)."""
import json, urllib.request
URL = "https://docs.erfi.io/mcp"
def call(name, args):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": args}}).encode()
    req = urllib.request.Request(URL, body, {"content-type": "application/json",
                                 "accept": "application/json, text/event-stream"})
    raw = urllib.request.urlopen(req, timeout=60).read().decode()
    if raw.startswith("event:") or raw.startswith("data:"):
        raw = next(l[5:] for l in raw.splitlines() if l.startswith("data:"))
    return json.loads(raw)["result"]["content"][0]["text"]
def origin_url(path):
    """[url] line of docs_read, or None when the page is gone/unmapped."""
    t = call("docs_read", {"path": path, "offset": 1, "lines": 1})
    for line in t.splitlines()[:3]:
        if line.startswith("[url] "):
            return line[6:].strip()
    return None
