#!/usr/bin/env bash
# Append missing v2 environment variables to .env without overwriting existing secrets.
# Safe to run on every deploy (idempotent).
set -euo pipefail

ENV_FILE="${1:-${KEYSERVICE_ROOT:-/var/www/keyservice}/.env}"
LOG_TAG="keyservice-upgrade-env"

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
  if grep -q "^${key}=" "${ENV_FILE}"; then
    return 0
  fi
  printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  log "added ${key}"
}

append_if_missing "KEYSERVICE_USER_SESSION_TTL_SECONDS" "86400"
append_if_missing "KEYSERVICE_USER_LOGIN_TOKEN_TTL_SECONDS" "900"
append_if_missing "KEYSERVICE_V1_SUNSET_DATE" "2026-12-17"
append_if_missing "KEYSERVICE_CONSOLE_URL" "https://cnothing.com"

if ! grep -q "^KEYSERVICE_BEARER_TOKEN=" "${ENV_FILE}"; then
  if command -v openssl >/dev/null 2>&1; then
    token="$(openssl rand -hex 32)"
  else
    token="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  printf 'KEYSERVICE_BEARER_TOKEN=%s\n' "${token}" >> "${ENV_FILE}"
  log "generated KEYSERVICE_BEARER_TOKEN (retrieve from ${ENV_FILE} for Console admin access)"
fi

chmod 600 "${ENV_FILE}" 2>/dev/null || true
log "env upgrade complete: ${ENV_FILE}"
