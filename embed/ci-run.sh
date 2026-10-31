#!/bin/sh
# Run embed/embed.py against the docs cache volume on the CI host and copy the
# resulting _related.tsv to $1 (docs-ssh#5 phase 2). Used by build.yml (daily,
# time-boxed) and embed-backfill.yml (first pass).
#
#   embed/ci-run.sh <out_related_tsv> <budget_seconds>
#
# State (pages.tsv + float16 vectors.npy) lives in $CACHE_VOLUME:/cache/embed,
# so each run embeds only new or changed pages, up to the budget, and the rest
# carries over to the next run. The model is cached in volume
# docs-ssh-embed-model. The job container cannot bind-mount its workspace on
# the host daemon, so embed/ goes in with docker cp, like the docs cache.
#
# CPU: bge-small on the MS-01 (i9-13900H) measured 667 pages/min single-process
# and no gain from fastembed data-parallel (705 at 8 workers, 519 at 4;
# research/raw/2026-10-30-embeddings). The router is also the site gateway,
# so the container is capped at 12 of 20 CPUs at nice 19.
#
# A failed or skipped embed still copies the previous _related.tsv when one
# exists, so the image never loses related pages because one night failed.
set -u
out="$1"
budget="$2"
: "${CACHE_VOLUME:?}" "${HELPER_IMAGE:?}"
EMBED_IMAGE="${EMBED_IMAGE:-python:3.12-slim}"
rc=0
# The embed container runs on the host daemon, so a cancelled job does not
# stop it: run 139's outlived its job by 2h15m and was still writing the cache
# volume while the next build ran. Remove it on the way out, and remove any
# leftover from a killed run before starting, so only one writer exists.
c=
cleanup() { [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1; c=; }
trap cleanup EXIT
trap 'cleanup; exit 143' INT TERM HUP
old=$(docker ps -aq --filter label=docs-ssh-embed)
if [ -n "$old" ]; then
  echo "::warning::removing leftover embed container(s): $old"
  docker rm -f $old >/dev/null
fi
if [ "$budget" -ge 300 ]; then
  docker volume create docs-ssh-embed-model >/dev/null
  c=$(docker create --cpus 12 --label docs-ssh-embed \
    -v "$CACHE_VOLUME":/cache -v docs-ssh-embed-model:/model \
    -e EMBED_MODEL_DIR=/model -e PIP_ROOT_USER_ACTION=ignore -e PIP_DISABLE_PIP_VERSION_CHECK=1 \
    "$EMBED_IMAGE" sh -c "pip install -q -r /embed/requirements.txt && nice -n 19 python /embed/embed.py --docs /cache/docs --state /cache/embed --budget-s $budget")
  docker cp embed/. "$c":/embed/
  # Background + wait: sh runs a trap only after a foreground command ends.
  docker start -a "$c" &
  wait $! || rc=$?
  cleanup
  [ "$rc" -eq 0 ] || echo "::warning::embedding failed (exit $rc); keeping the previous _related.tsv if any"
else
  echo "embed: skipped, budget ${budget}s < 300s"
fi
if docker run --rm -v "$CACHE_VOLUME":/cache "$HELPER_IMAGE" test -s /cache/embed/_related.tsv; then
  docker run --rm -v "$CACHE_VOLUME":/cache "$HELPER_IMAGE" cat /cache/embed/_related.tsv > "$out"
  echo "related: $(wc -l < "$out") pages with neighbours"
else
  echo "related: none yet (no /cache/embed/_related.tsv)"
fi
exit 0
