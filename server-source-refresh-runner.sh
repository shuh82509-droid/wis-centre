#!/usr/bin/env bash
set -euo pipefail
mode="${1:-}"
case "$mode" in spark|organization) ;; *) echo 'unsupported mode' >&2; exit 2;; esac
root=/home/brand-marketing/fandow-apps/fd-026222/source-refresh
export DOCKER_HOST=unix:///run/user/1000/docker.sock
mapfile -t matches < <(/usr/bin/docker ps \
  --filter 'name=^/fd-026222-hub-linked-asset' \
  --filter 'label=com.fandow.account=brand-marketing' \
  --filter 'label=com.fandow.app=wis-marketing-hub' \
  --format '{{.Names}}')
if [[ ${#matches[@]} -ne 1 ]]; then
  echo "expected one current WIS hub, found ${#matches[@]}" >&2
  exit 1
fi
container="${matches[0]}"
/usr/bin/docker cp "$root/server-source-refresh.mjs" "$container:/app/server-source-refresh.mjs"
/usr/bin/docker cp "$root/source-scheduler-config.json" "$container:/app/source-scheduler-config.json"
/usr/bin/docker exec --user root "$container" chmod 644 /app/server-source-refresh.mjs /app/source-scheduler-config.json
/usr/bin/docker exec "$container" node /app/server-source-refresh.mjs "$mode"
