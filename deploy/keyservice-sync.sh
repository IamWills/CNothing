#!/usr/bin/env bash
# Pull latest code from GitHub, install deps, migrate DB, restart keyservice.
# Intended for root + systemd timer. Configure branch with KEYSERVICE_GIT_REF (default: origin/main).
set -euo pipefail

KEYSERVICE_ROOT="${KEYSERVICE_ROOT:-/var/www/keyservice}"
GIT_REF="${KEYSERVICE_GIT_REF:-origin/main}"
LOG_TAG="keyservice-sync"

log() {
  echo "$(date -Is) $*"
  command -v logger >/dev/null 2>&1 && logger -t "${LOG_TAG}" -- "$*" || true
}

cd "${KEYSERVICE_ROOT}"

if ! command -v flock >/dev/null 2>&1; then
  log "flock not found; install util-linux"
  exit 1
fi

exec 9>/run/keyservice-sync.lock
if ! flock -n 9; then
  log "skip: another sync holds the lock"
  exit 0
fi

export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="${KEYSERVICE_ROOT}"

git fetch origin

before="$(git rev-parse HEAD)"
git reset --hard "${GIT_REF}"
after="$(git rev-parse HEAD)"

if [[ "${before}" == "${after}" ]]; then
  log "no new commits (${after})"
  exit 0
fi

log "updated ${before} -> ${after}"

/usr/local/bin/bun install
/usr/local/bin/bun run migrate

chown -R keyservice:keyservice "${KEYSERVICE_ROOT}"

systemctl restart keyservice.service
log "keyservice.service restarted"
