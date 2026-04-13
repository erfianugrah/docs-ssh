# ─── Stage 1: fetch and normalise docs ───────────────────────────────────────
FROM node:22-alpine AS fetcher

RUN apk add --no-cache git curl

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
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

# ─── Stage 2: SSH server ──────────────────────────────────────────────────────
FROM alpine:3.21

# Link GHCR package to the repository so GITHUB_TOKEN gets write access
LABEL org.opencontainers.image.source=https://github.com/erfianugrah/docs-ssh

RUN apk add --no-cache openssh bash ripgrep jq busybox-extras bat tree less

# Create restricted docs user — empty password for passwordless SSH access
RUN addgroup -S docs && adduser -S -G docs -s /bin/bash docs \
  && passwd -d docs

# Copy docs — owned by root, readable by all (docs user cannot modify)
# Remove freshness stamps (.stamp.json) — only needed during fetch, not at runtime.
COPY --from=fetcher /docs /docs
RUN find /docs -name '.stamp.json' -delete

# Build search index: one line per file with path, title, and headings summary.
# This lets agents search the index (~10-20MB) instead of grepping ~300MB of raw docs.
COPY build-index.sh build-sources-json.sh /tmp/
RUN sh /tmp/build-index.sh /docs > /docs/_index.tsv \
 && sh /tmp/build-sources-json.sh /docs > /docs/_sources.json \
 && rm /tmp/build-index.sh /tmp/build-sources-json.sh

# sshd configuration + command logger + built-in commands + entrypoint
RUN mkdir -p /var/run/sshd /var/log /usr/local/lib/docs-ssh/lib
COPY sshd_config /etc/ssh/sshd_config
COPY log-cmd.sh /usr/local/bin/log-cmd
COPY entrypoint.sh /usr/local/bin/entrypoint
COPY commands/ /usr/local/lib/docs-ssh/
RUN chmod +x /usr/local/bin/log-cmd /usr/local/bin/entrypoint \
  /usr/local/lib/docs-ssh/*.sh /usr/local/lib/docs-ssh/lib/*.sh

# Landing page — served by busybox httpd on port 8080
# Version injected from git tag at build time; JS fallback for self-hosted builds.
# Sources grid populated from build-time _sources.json.
ARG VERSION=
COPY public/ /usr/local/lib/docs-ssh/
RUN cp /docs/_sources.json /usr/local/lib/docs-ssh/_sources.json \
 && if [ -n "$VERSION" ]; then \
      sed -i "s/__VERSION__/$VERSION/g" /usr/local/lib/docs-ssh/index.html; \
    fi

EXPOSE 22 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ssh -o StrictHostKeyChecking=no -o BatchMode=yes -p 2222 docs@localhost "echo ok" || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint"]
