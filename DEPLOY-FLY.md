# Deploying docs-ssh on Fly.io

Fly.io can run the existing Docker image as a raw TCP service. SSH handles its own encryption, so no TLS handler is needed — Fly Proxy passes TCP through to the container unchanged.

## Prerequisites

- [flyctl](https://fly.io/docs/flyctl/install/) installed and authenticated
- A Fly.io account with a payment method (dedicated IPv4 requires billing)

## Why Fly.io works for this

- The project already listens on port 2222 internally, which is what Fly.io requires (Fly machines reserve port 22 on the private IPv6 interface for `fly ssh console`)
- The existing Dockerfile needs no changes
- The server is stateless — docs are baked into the image, host keys regenerate on startup, audit logs go to stdout. No volumes needed.

## Deploy

```bash
# Create the app (skip initial deploy)
fly launch --no-deploy

# Allocate a dedicated IPv4 — required for non-HTTP TCP services.
# Shared IPv4 only works for HTTP/TLS on ports 80/443.
fly ips allocate-v4

# Deploy (builds the Docker image on Fly's remote builder)
fly deploy

# Verify
ssh -o StrictHostKeyChecking=no -p 2222 docs@docs-ssh.fly.dev help
```

> After `fly launch`, edit `fly.toml` to set your app name and preferred region before deploying. The committed `fly.toml` uses `app = "docs-ssh"` and `primary_region = "iad"`.

## Configuration

The `fly.toml` in the repo defines two services:

| Service | External port | Internal port | Protocol | Notes |
|---------|--------------|---------------|----------|-------|
| SSH | 2222 | 2222 | raw TCP | No handlers — TCP passthrough |
| HTTP | 80/443 | 8080 | HTTP/TLS | Landing page via busybox httpd |

### Auto-stop behavior

The config sets `auto_stop_machines = "stop"` and `min_machines_running = 1`, so the machine stays on. To save cost during low-traffic periods, set `min_machines_running = 0` — the machine will stop when idle and cold-start (~2s) on the next SSH connection.

For faster wake-up, use `auto_stop_machines = "suspend"` instead of `"stop"`. Suspend resumes in hundreds of milliseconds but requires <= 2GB memory (the 512MB config qualifies).

### Custom domain

To use a custom domain instead of `docs-ssh.fly.dev`:

```bash
fly certs add docs.example.com
# Then add a CNAME record: docs.example.com -> docs-ssh.fly.dev
```

Update `DOCS_SSH_HOST` in `fly.toml` to match, so the built-in `help` and `tools` commands output the correct hostname.

## Daily doc updates

The existing CI workflow (`update-docs.yml`) builds a new Docker image daily and pushes to GHCR. To deploy it to Fly.io, add a step after the image push:

```yaml
- name: Deploy to Fly.io
  run: fly deploy --image ghcr.io/${{ github.repository }}:latest
  env:
    FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

This deploys the pre-built image directly — no remote build needed. Generate the token with `fly tokens create deploy -x 999999h`.

Alternatively, run `fly deploy` manually after each `update-docs.yml` run, or set up a Fly.io [deploy hook](https://fly.io/docs/reference/deploy-hooks/).

## Cost estimate

| Resource | Cost |
|----------|------|
| shared-cpu-1x, 512MB (always on) | ~$3.19/month |
| Dedicated IPv4 | $2/month |
| Outbound bandwidth (first 100GB free) | $0 |
| **Total** | **~$5/month** |

With `min_machines_running = 0` and auto-stop, cost drops to ~$2/month (just the IPv4) during idle periods.

## Tradeoffs vs self-hosted Docker Compose

| | Self-hosted | Fly.io |
|---|---|---|
| Infra management | You manage the host | Managed |
| Cost | VPS cost | ~$5/month |
| Latency | Single region | Anycast (single machine) |
| DNS/TLS for landing page | Caddy or similar | Fly handles it |
| Host key stability | Regenerated per container | Same (no volume) |
| Deployment | `docker compose pull && up -d` | `fly deploy --image ...` |
