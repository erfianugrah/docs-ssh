# ─── Stage 1: fetch and normalise docs ───────────────────────────────────────
FROM node:26-alpine AS fetcher

RUN apk add --no-cache git curl

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/

ARG DOCS_PREBUILT=false
ENV DOCS_OUT_DIR=/docs
ENV DOCS_WORK_DIR=/tmp/docs-work
ENV DOCS_MAX_AGE=0

COPY docs* /docs-ctx/
RUN if [ "$DOCS_PREBUILT" = "true" ] && [ -d "/docs-ctx" ] && [ "$(ls -A /docs-ctx 2>/dev/null)" ]; then \
  mkdir -p /docs && cp -r /docs-ctx/* /docs/; \
  elif [ "$DOCS_PREBUILT" != "true" ]; then \
  node --import tsx/esm src/index.ts; \
  else \
  echo "ERROR: DOCS_PREBUILT=true but no docs/ directory in build context" && exit 1; \
  fi && \
  rm -rf /docs-ctx

# Build the search index while we still have Node + the source on disk.
# Output is part of the docs artefact copied to stage 2.
RUN find /docs -name '.stamp.json' -delete \
 && node --import tsx/esm src/commands/build-index.ts /docs /docs/_index.tsv

# ─── Stage 1b: compile the MCP-over-HTTP server to a single binary ────────────
# Bun --compile bundles the runtime + deps into one executable, so the Alpine
# runtime stage needs no Node/node_modules (only libstdc++/libgcc, added below).
FROM oven/bun:1-alpine AS mcp-builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN bun install --no-save @modelcontextprotocol/sdk zod
COPY tsconfig.json ./
COPY src/mcp/ ./src/mcp/
# No --target: compiles for the build platform's arch (musl on alpine),
# which matches the runtime stage under a consistent buildx --platform.
RUN bun build --compile src/mcp/main.ts --outfile /docs-mcp

# ─── Stage 2: SSH server ──────────────────────────────────────────────────────
FROM alpine:3.24

# Link GHCR package to the repository so GITHUB_TOKEN gets write access
LABEL org.opencontainers.image.source=https://github.com/erfianugrah/docs-ssh

# libstdc++/libgcc are required by the Bun-compiled MCP binary on musl.
RUN apk add --no-cache openssh bash ripgrep jq busybox-extras bat tree less \
  libstdc++ libgcc

# Create restricted docs user — empty password for passwordless SSH access
RUN addgroup -S docs && adduser -S -G docs -s /bin/bash docs \
  && passwd -d docs

# Copy docs (now including the pre-built /docs/_index.tsv produced in
# stage 1 by build-index.ts) — owned by root, readable by all.
COPY --from=fetcher /docs /docs

# Build the per-source sources.json and the post-build health report.
# These two are tiny POSIX-sh scripts and don't justify Node in the
# runtime stage; the heavier _index.tsv build runs in stage 1 instead.
COPY build-sources-json.sh build-health-check.sh /tmp/
RUN sh /tmp/build-sources-json.sh /docs > /docs/_sources.json \
 && sh /tmp/build-health-check.sh /docs /docs/_index.tsv \
 && rm /tmp/build-sources-json.sh /tmp/build-health-check.sh

# sshd configuration + command logger + built-in commands + entrypoint
RUN mkdir -p /var/run/sshd /var/log /usr/local/lib/docs-ssh/lib
COPY sshd_config /etc/ssh/sshd_config
COPY log-cmd.sh /usr/local/bin/log-cmd
COPY entrypoint.sh /usr/local/bin/entrypoint
COPY --from=mcp-builder /docs-mcp /usr/local/bin/docs-mcp
RUN chmod +x /usr/local/bin/docs-mcp
COPY commands/ /usr/local/lib/docs-ssh/
RUN chmod +x /usr/local/bin/log-cmd /usr/local/bin/entrypoint \
  /usr/local/lib/docs-ssh/*.sh /usr/local/lib/docs-ssh/lib/*.sh

# Landing page — served by busybox httpd on port 8080
# Placeholders injected at build time; JS fallback for self-hosted builds.
# Sources grid populated from build-time _sources.json.
ARG VERSION=
ARG SSH_HOST=localhost
ARG SSH_PORT=2222
COPY public/ /usr/local/lib/docs-ssh/
RUN cp /docs/_sources.json /usr/local/lib/docs-ssh/_sources.json \
 && SOURCE_COUNT=$(jq '((.docs // []) | length) + ((.api // []) | length)' /docs/_sources.json) \
 && PAGE=/usr/local/lib/docs-ssh/index.html \
 && sed -i "s/__SOURCE_COUNT__/${SOURCE_COUNT}/g" "$PAGE" \
 && if [ -n "$VERSION" ]; then sed -i "s/__VERSION__/$VERSION/g" "$PAGE"; fi \
 && if [ "$SSH_HOST" != "localhost" ]; then sed -i "s/__HOST__/$SSH_HOST/g" "$PAGE"; fi \
 && if [ "$SSH_PORT" != "2222" ]; then sed -i "s/__PORT__/$SSH_PORT/g" "$PAGE"; fi \
 && sed -i "s/__HOST__/localhost/g; s/__PORT__/2222/g" "$PAGE"

# VERSION (declared as ARG above for the landing page) is surfaced to the
# MCP server's serverInfo.version at runtime.
ENV VERSION=$VERSION
ENV MCP_STATIC_DIR=/usr/local/lib/docs-ssh

EXPOSE 2222 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ssh -o StrictHostKeyChecking=no -o BatchMode=yes -p 2222 docs@localhost "echo ok" || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint"]
