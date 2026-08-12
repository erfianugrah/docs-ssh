# Composer-based daily update pipeline

The daily docs refresh runs on the router (MS-01) as a Composer pipeline,
replacing the GitHub Actions `update-docs.yml` cron. The win over the GH
runner is the persistent docs cache: GitHub's ephemeral runners re-fetch all
~270 sources (~2h) every time; here unchanged sources are skipped via
freshness checks and only changed ones re-scrape.

## Pieces

- `pipeline.json` - the Composer pipeline definition (8 steps):
  sync-repo -> install-deps -> fetch-docs (persistent cache volume) ->
  build-image (on the router's Docker daemon) -> push-image (GHCR,
  continue_on_error) -> deploy (compose_up docs-ssh) -> settle -> smoke.
- `builder.Dockerfile` - the `docs-builder:local` image: node 22 + pnpm 10 +
  git + docker-cli + openssh. Built once on the router, `pull_policy: never`.
- `builder-compose.yaml` - the `docs-builder` stack: host networking (the
  router's nftables only forwards for declared bridge networks; composer
  itself uses host networking too), docker.sock mount, and four persistent
  volumes: repo checkout, docs cache, docker config (GHCR auth), pnpm store.

## Recreate from scratch

```bash
# 1. build the builder image on the router
ssh nixos 'mkdir -p /var/lib/composer/stacks/docs-builder'
scp deploy/composer/builder.Dockerfile nixos:/var/lib/composer/stacks/docs-builder/Dockerfile
ssh nixos 'docker build -t docs-builder:local /var/lib/composer/stacks/docs-builder/'

# 2. register the stack (localhost API avoids the WAF on mutations)
jq -nc --arg c "$(cat deploy/composer/builder-compose.yaml)" '{name:"docs-builder", compose:$c}' \
  | ssh nixos "curl -sf -X POST -H 'X-API-Key: '$COMPOSER_API_KEY -H 'Content-Type: application/json' --data-binary @- localhost:8080/api/v1/stacks"
ssh nixos "curl -sf -X POST -H 'X-API-Key: '$COMPOSER_API_KEY 'localhost:8080/api/v1/stacks/docs-builder/up?async=true'"

# 3. GHCR auth inside the builder (classic PAT with write:packages;
#    fine-grained PATs do not work for Packages). Token never printed:
read -s CR_PAT; printf '%s' "$CR_PAT" | ssh nixos 'docker exec -i docs-builder docker login ghcr.io -u erfianugrah --password-stdin'

# 4. create/update the pipeline, then run it
ssh nixos "curl -sf -X PUT -H 'X-API-Key: '$COMPOSER_API_KEY -H 'Content-Type: application/json' --data-binary @- localhost:8080/api/v1/pipelines/<id>" < deploy/composer/pipeline.json
# (or POST /api/v1/pipelines with triggers: [{"type":"manual"},{"type":"schedule","config":{"cron":"0 2 * * *"}}])
```

## Notes

- The running docs-ssh stack uses `pull_policy: missing` (default): the
  locally-built `:latest` tag shadows the registry one, `compose_up`
  recreates on image-ID change. Release deploys from GitHub do a real pull
  and overwrite the local tag - both flows coexist.
- `push-image` is `continue_on_error: true`: a registry outage never blocks
  a deploy. Local date tags prune to the last 7.
- First-ever fetch is cold (~1.5-2h, AWS + home-assistant dominate).
  Daily runs against a warm cache should be minutes.
- Runtime state that is NOT in git by design: the docs cache volume, the
  repo checkout volume, the docker auth volume (contains the GHCR token).
  The Composer DB (which stores this pipeline) is on the router at
  /var/lib/composer/data - this directory is the git-backed copy.
