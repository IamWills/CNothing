#!/usr/bin/env bash
# First installation of CNothing V4 on a Debian-style host.
# Required: DATABASE_URL, CERTBOT_EMAIL, and DNS for cnothing.com.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/IamWills/CNothing.git}"
KEYSERVICE_REF="${KEYSERVICE_REF:-}"
KEYSERVICE_PARENT="${KEYSERVICE_PARENT:-/var/www}"
KEYSERVICE_DIR="${KEYSERVICE_PARENT}/keyservice"
KEYSERVICE_USER="${KEYSERVICE_USER:-keyservice}"
DATABASE_URL="${DATABASE_URL:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi
if [[ -z "${DATABASE_URL}" || -z "${CERTBOT_EMAIL}" || -z "${KEYSERVICE_REF}" ]]; then
  echo "Set DATABASE_URL, CERTBOT_EMAIL, and an explicitly reviewed KEYSERVICE_REF before running this installer." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  export BUN_INSTALL=/usr/local
  curl -fsSL https://bun.sh/install | bash
  hash -r
fi
BUN_BIN="$(command -v bun)"

if [[ ! -d "${KEYSERVICE_DIR}/.git" ]]; then
  git clone "${REPO_URL}" "${KEYSERVICE_DIR}"
  git -C "${KEYSERVICE_DIR}" checkout --detach "${KEYSERVICE_REF}^{commit}"
else
  echo "${KEYSERVICE_DIR} already exists; refusing to change its checked-out revision." >&2
  echo "Select a reviewed revision manually, then rerun this installer." >&2
  exit 1
fi

cd "${KEYSERVICE_DIR}"
bun install --frozen-lockfile
(
  cd console
  bun install --frozen-lockfile
  bun run build
)

bun run generate-secrets
{
  echo "PORT=3021"
  echo "DATABASE_URL=${DATABASE_URL}"
  echo "KEYSERVICE_PUBLIC_URL=https://cnothing.com"
  echo "KEYSERVICE_CONSOLE_URL=https://cnothing.com"
  echo "KEYSERVICE_USER_SESSION_TTL_SECONDS=86400"
  cat .local-keys/generated.env
} > .env
chmod 600 .env .local-keys/generated.env

bun run typecheck
bun test src
bun run migrate

if ! id -u "${KEYSERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home "${KEYSERVICE_DIR}" --shell /usr/sbin/nologin "${KEYSERVICE_USER}"
fi
chown -R "${KEYSERVICE_USER}:${KEYSERVICE_USER}" "${KEYSERVICE_DIR}"

install_unit() {
  local source="$1"
  local destination="$2"
  sed -e "s|KEYSERVICE_USER|${KEYSERVICE_USER}|g" \
      -e "s|KEYSERVICE_GROUP|${KEYSERVICE_USER}|g" \
      -e "s|KEYSERVICE_ROOT|${KEYSERVICE_DIR}|g" \
      -e "s|KEYSERVICE_BUN|${BUN_BIN}|g" \
      "${source}" > "${destination}"
}

install_unit deploy/keyservice.service /etc/systemd/system/keyservice.service
install_unit deploy/cnothing-console.service /etc/systemd/system/cnothing-console.service
systemctl daemon-reload
systemctl enable --now keyservice.service cnothing-console.service

install -m 0644 deploy/nginx-cnothing.conf /etc/nginx/sites-available/cnothing.com
ln -sfn /etc/nginx/sites-available/cnothing.com /etc/nginx/sites-enabled/cnothing.com
nginx -t
systemctl reload nginx

if ! command -v certbot >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
fi
certbot --nginx --non-interactive --agree-tos --redirect \
  -m "${CERTBOT_EMAIL}" -d cnothing.com -d www.cnothing.com -d ai.cnothing.com

curl --fail https://cnothing.com/health
echo "CNothing V4 is installed. Add OAuth and APNs settings to ${KEYSERVICE_DIR}/.env, then restart keyservice.service."
