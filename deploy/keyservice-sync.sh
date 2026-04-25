#!/usr/bin/env bash
# Pull latest code from GitHub, run lightweight update steps, migrate DB, restart services.
# Low-memory mode is default: skip console build unless explicitly enabled.
set -euo pipefail

KEYSERVICE_ROOT="${KEYSERVICE_ROOT:-/var/www/keyservice}"
KEYSERVICE_CONSOLE_ROOT="${KEYSERVICE_CONSOLE_ROOT:-${KEYSERVICE_ROOT}/console}"
GIT_REF="${KEYSERVICE_GIT_REF:-origin/main}"
# 1 (default): low-memory mode; skip heavy console build
KEYSERVICE_LOW_MEMORY="${KEYSERVICE_LOW_MEMORY:-1}"
# 1: force console build even in low-memory mode
KEYSERVICE_SYNC_CONSOLE_BUILD="${KEYSERVICE_SYNC_CONSOLE_BUILD:-0}"
# Memory cap for optional console build
KEYSERVICE_CONSOLE_BUILD_MAX_OLD_SPACE_MB="${KEYSERVICE_CONSOLE_BUILD_MAX_OLD_SPACE_MB:-256}"
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
if [[ -d "${KEYSERVICE_CONSOLE_ROOT}" ]]; then
  if [[ "${KEYSERVICE_SYNC_CONSOLE_BUILD}" == "1" ]]; then
    (
      cd "${KEYSERVICE_CONSOLE_ROOT}"
      /usr/local/bin/bun install
      export NODE_OPTIONS="--max-old-space-size=${KEYSERVICE_CONSOLE_BUILD_MAX_OLD_SPACE_MB}"
      export NEXT_DISABLE_ESLINT=1
      /usr/local/bin/bun run build
    )
    log "console build completed with constrained memory"
  elif [[ "${KEYSERVICE_LOW_MEMORY}" == "1" ]]; then
    log "low-memory mode: skip console build"
  else
    (
      cd "${KEYSERVICE_CONSOLE_ROOT}"
      /usr/local/bin/bun install
      /usr/local/bin/bun run build
    )
    log "console dependencies installed and build completed"
  fi
fi
/usr/local/bin/bun run migrate

chown -R keyservice:keyservice "${KEYSERVICE_ROOT}"

systemctl restart keyservice.service
log "keyservice.service restarted"

if systemctl list-unit-files keyservice-console.service >/dev/null 2>&1; then
  systemctl restart keyservice-console.service
  log "keyservice-console.service restarted"
fi
