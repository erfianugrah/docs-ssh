FROM node:22-alpine
RUN apk add --no-cache git docker-cli openssh-client bash curl jq ca-certificates \
 && corepack enable \
 && corepack prepare pnpm@10 --activate \
 && pnpm --version
WORKDIR /work/repo
CMD ["sleep", "infinity"]
