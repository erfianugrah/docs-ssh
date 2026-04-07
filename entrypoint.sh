#!/bin/sh
# Entrypoint: generates host keys at runtime, sets up log pipe, starts sshd.

# Generate host keys in tmpfs (unique per container, not baked into image)
KEY_DIR="/run/sshd"
mkdir -p "$KEY_DIR"
if [ ! -f "$KEY_DIR/ssh_host_ed25519_key" ]; then
  ssh-keygen -t ed25519 -f "$KEY_DIR/ssh_host_ed25519_key" -N "" -q
  ssh-keygen -t rsa -b 2048 -f "$KEY_DIR/ssh_host_rsa_key" -N "" -q
fi

# Named pipe for audit logs — ForceCommand writes here, we tail to stderr.
# Use a while-read loop so the reader doesn't exit after the pipe writer closes.
LOG_PIPE="/var/log/docs-ssh.pipe"
mkfifo "$LOG_PIPE" 2>/dev/null
chmod 666 "$LOG_PIPE"
while true; do cat "$LOG_PIPE"; done >&2 &

# Start sshd in foreground (PidFile in tmpfs to avoid read-only fs error)
exec /usr/sbin/sshd -D -e -p 2222 -o "PidFile=$KEY_DIR/sshd.pid"
