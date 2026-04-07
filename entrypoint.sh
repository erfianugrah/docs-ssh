#!/bin/sh
# Entrypoint: generates host keys, sets up audit log tailing, starts sshd.

# Generate host keys in tmpfs (unique per container, not baked into image)
KEY_DIR="/run/sshd"
mkdir -p "$KEY_DIR"
if [ ! -f "$KEY_DIR/ssh_host_ed25519_key" ]; then
  ssh-keygen -t ed25519 -f "$KEY_DIR/ssh_host_ed25519_key" -N "" -q
  ssh-keygen -t rsa -b 2048 -f "$KEY_DIR/ssh_host_rsa_key" -N "" -q
fi

# Audit log file — ForceCommand appends JSON lines here.
# tail -F follows the file even before it exists and across truncation.
LOG_FILE="/var/log/docs-ssh.jsonl"
touch "$LOG_FILE"
chmod 666 "$LOG_FILE"
tail -F "$LOG_FILE" >&2 &

# Start sshd in foreground
exec /usr/sbin/sshd -D -e -p 2222 -o "PidFile=$KEY_DIR/sshd.pid"
