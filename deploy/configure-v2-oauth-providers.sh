#!/usr/bin/env bash
# Append v2.5 OAuth provider credentials to .env (does not overwrite existing values).
# Usage:
#   KEYSERVICE_GOOGLE_OAUTH_CLIENT_ID=... \
#   KEYSERVICE_GOOGLE_OAUTH_CLIENT_SECRET=... \
#   ./deploy/configure-v2-oauth-providers.sh /var/www/keyservice/.env
set -euo pipefail

ENV_FILE="${1:-${KEYSERVICE_ROOT:-/var/www/keyservice}/.env}"
LOG_TAG="keyservice-configure-oauth"

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

append_if_missing "KEYSERVICE_GITHUB_OAUTH_CLIENT_ID" "${KEYSERVICE_GITHUB_OAUTH_CLIENT_ID:-}"
append_if_missing "KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET" "${KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET:-}"
append_if_missing "KEYSERVICE_GOOGLE_OAUTH_CLIENT_ID" "${KEYSERVICE_GOOGLE_OAUTH_CLIENT_ID:-}"
append_if_missing "KEYSERVICE_GOOGLE_OAUTH_CLIENT_SECRET" "${KEYSERVICE_GOOGLE_OAUTH_CLIENT_SECRET:-}"
append_if_missing "KEYSERVICE_MICROSOFT_OAUTH_CLIENT_ID" "${KEYSERVICE_MICROSOFT_OAUTH_CLIENT_ID:-}"
append_if_missing "KEYSERVICE_MICROSOFT_OAUTH_CLIENT_SECRET" "${KEYSERVICE_MICROSOFT_OAUTH_CLIENT_SECRET:-}"
append_if_missing "KEYSERVICE_SLACK_OAUTH_CLIENT_ID" "${KEYSERVICE_SLACK_OAUTH_CLIENT_ID:-}"
append_if_missing "KEYSERVICE_SLACK_OAUTH_CLIENT_SECRET" "${KEYSERVICE_SLACK_OAUTH_CLIENT_SECRET:-}"
append_if_missing "KEYSERVICE_NOTION_OAUTH_CLIENT_ID" "${KEYSERVICE_NOTION_OAUTH_CLIENT_ID:-}"
append_if_missing "KEYSERVICE_NOTION_OAUTH_CLIENT_SECRET" "${KEYSERVICE_NOTION_OAUTH_CLIENT_SECRET:-}"
append_if_missing "KEYSERVICE_PLATFORM_WEBHOOK_URL" "${KEYSERVICE_PLATFORM_WEBHOOK_URL:-}"

chmod 600 "${ENV_FILE}" 2>/dev/null || true
log "oauth provider env configure complete: ${ENV_FILE}"
log "restart keyservice.service to sync credentials into cap_oauth_providers"
