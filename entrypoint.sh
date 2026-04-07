#!/bin/sh
# Entrypoint: generates host keys, sets up audit log tailing, starts sshd.

# Generate host keys in tmpfs (unique per container, not baked into image)
KEY_DIR="/run/sshd"
mkdir -p "$KEY_DIR"
if [ ! -f "$KEY_DIR/ssh_host_ed25519_key" ]; then
  ssh-keygen -t ed25519 -f "$KEY_DIR/ssh_host_ed25519_key" -N "" -q
  ssh-keygen -t rsa -b 4096 -f "$KEY_DIR/ssh_host_rsa_key" -N "" -q
fi

# Audit log — owned by root, group-writable by docs user (append only via jq >>).
# The docs user can append but not truncate (sshd runs ForceCommand as docs).
LOG_FILE="/var/log/docs-ssh.jsonl"
touch "$LOG_FILE"
chown root:docs "$LOG_FILE"
chmod 664 "$LOG_FILE"

# Tail log to stderr so Docker captures it
tail -F "$LOG_FILE" >&2 &

# Start sshd in foreground
exec /usr/sbin/sshd -D -e -p 2222 -o "PidFile=$KEY_DIR/sshd.pid"
