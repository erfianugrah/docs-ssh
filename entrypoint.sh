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
ENV_FILE="/run/sshd/docs-ssh.env"
cat > "$ENV_FILE" << EOF
DOCS_SSH_HOST="${DOCS_SSH_HOST:-localhost}"
DOCS_SSH_PORT="${DOCS_SSH_PORT:-2222}"
EOF

# Audit log — owned by root, group-writable by docs user (append only via jq >>).
# The docs user can append but not truncate (sshd runs ForceCommand as docs).
LOG_FILE="/var/log/docs-ssh.jsonl"
touch "$LOG_FILE"
chown root:docs "$LOG_FILE"
chmod 664 "$LOG_FILE"

# Tail log to stderr so Docker captures it
tail -F "$LOG_FILE" >&2 &

# Start HTTP server for landing page (background, if page exists)
if [ -f /usr/local/lib/docs-ssh/index.html ]; then
  httpd -f -p 8080 -h /usr/local/lib/docs-ssh &
fi

# Start sshd in foreground
exec /usr/sbin/sshd -D -e -p 2222 -o "PidFile=$KEY_DIR/sshd.pid"
