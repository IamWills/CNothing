#!/usr/bin/env bash
# Append GitHub-related v2 secrets to .env (does not overwrite existing values).
# Usage (on server or via ssh):
#   KEYSERVICE_GITHUB_TOKEN=ghp_... \
#   KEYSERVICE_GITHUB_OAUTH_CLIENT_ID=Ov23... \
#   KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET=... \
#   ./deploy/configure-v2-github.sh /var/www/keyservice/.env
set -euo pipefail

ENV_FILE="${1:-${KEYSERVICE_ROOT:-/var/www/keyservice}/.env}"
LOG_TAG="keyservice-configure-github"

log() {
  echo "$(date -Is) $*"
  command -v logger >/dev/null 2>&1 && logger -t "${LOG_TAG}" -- "$*" || true
}

if [[ ! -f "${ENV_FILE}" ]]; then
  log "error: ${ENV_FILE} not found"
  exit 1
fi

append_if_missing() {
  local key="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    return 0
  fi
  if grep -q "^${key}=" "${ENV_FILE}"; then
    log "skip ${key} (already set)"
    return 0
  fi
  printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  log "added ${key}"
}

append_if_missing "KEYSERVICE_GITHUB_TOKEN" "${KEYSERVICE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
append_if_missing "KEYSERVICE_GITHUB_OAUTH_CLIENT_ID" "${KEYSERVICE_GITHUB_OAUTH_CLIENT_ID:-}"
append_if_missing "KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET" "${KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET:-}"

chmod 600 "${ENV_FILE}" 2>/dev/null || true
log "github env configure complete: ${ENV_FILE}"
