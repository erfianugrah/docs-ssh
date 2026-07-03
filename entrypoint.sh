#!/bin/sh
# Entrypoint: generates host keys, persists env, sets up logging, starts services.

# Generate host keys in tmpfs (unique per container, not baked into image)
KEY_DIR="/run/sshd"
mkdir -p "$KEY_DIR"
if [ ! -f "$KEY_DIR/ssh_host_ed25519_key" ]; then
  ssh-keygen -t ed25519 -f "$KEY_DIR/ssh_host_ed25519_key" -N "" -q
  ssh-keygen -t rsa -b 4096 -f "$KEY_DIR/ssh_host_rsa_key" -N "" -q
fi

# Persist env vars for SSH commands. sshd drops the container environment
# when running ForceCommand, so log-cmd.sh sources this file to recover them.
# Sanitise values to prevent shell injection via attacker-controlled env vars.
ENV_FILE="/run/sshd/docs-ssh.env"
_safe_host=$(printf '%s' "${DOCS_SSH_HOST:-localhost}" | tr -cd 'a-zA-Z0-9._-')
_safe_port=$(printf '%s' "${DOCS_SSH_PORT:-2222}" | tr -cd '0-9')
_safe_timeout=$(printf '%s' "${DOCS_CMD_TIMEOUT:-60}" | tr -cd '0-9')
# Fall back to defaults if sanitisation stripped the input to empty
# (e.g. DOCS_SSH_HOST='///' → '' → localhost).
: "${_safe_host:=localhost}"
: "${_safe_port:=2222}"
: "${_safe_timeout:=60}"
printf 'DOCS_SSH_HOST=%s\nDOCS_SSH_PORT=%s\nDOCS_CMD_TIMEOUT=%s\n' \
  "$_safe_host" "$_safe_port" "$_safe_timeout" > "$ENV_FILE"

# Audit log — owned by root, group-writable by docs user (append only via jq >>).
# The docs user can append but not truncate (sshd runs ForceCommand as docs).
LOG_FILE="/var/log/docs-ssh.jsonl"
touch "$LOG_FILE"
chown root:docs "$LOG_FILE"
chmod 664 "$LOG_FILE"

# Command result cache — docs are static for the container's lifetime, so
# identical commands always produce the same output. Cache in tmpfs.
# chown is sufficient; chmod 700 fails under cap-drop-all + no-new-privileges
# because CAP_FOWNER is not granted. The docs user owns the dir (755), and
# only the docs user (via ForceCommand) writes to it.
CACHE_DIR="/tmp/docs-ssh-cache"
mkdir -p "$CACHE_DIR"
chown docs:docs "$CACHE_DIR"

# Tail log to stderr so Docker captures it
tail -F "$LOG_FILE" >&2 &

# Start the HTTP server on port 8080. The MCP binary serves BOTH the static
# landing page (from MCP_STATIC_DIR) and the /mcp endpoint, so one listener
# covers both. Fall back to busybox httpd (landing page only) if the binary
# is absent (e.g. an older image built before the MCP server existed).
if [ -x /usr/local/bin/docs-mcp ]; then
  DOCS_ROOT=/docs \
  MCP_PORT=8080 \
  MCP_HOST=0.0.0.0 \
  MCP_STATIC_DIR="${MCP_STATIC_DIR:-/usr/local/lib/docs-ssh}" \
  MCP_ALLOWED_HOSTS="${MCP_ALLOWED_HOSTS:-docs.erfi.io,docs-ssh.fly.dev,localhost,127.0.0.1}" \
  MCP_ALLOWED_ORIGINS="${MCP_ALLOWED_ORIGINS:-https://claude.ai,https://chatgpt.com,https://chat.openai.com}" \
  VERSION="${VERSION:-}" \
  /usr/local/bin/docs-mcp &
elif [ -f /usr/local/lib/docs-ssh/index.html ]; then
  httpd -f -p 8080 -h /usr/local/lib/docs-ssh &
fi

# Start sshd in foreground
exec /usr/sbin/sshd -D -e -p 2222 -o "PidFile=$KEY_DIR/sshd.pid"
