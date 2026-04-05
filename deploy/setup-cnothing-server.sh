#!/usr/bin/env bash
# Run on the server as root after DNS for cnothing.com / www / ai points to this host.
# Usage:
#   export DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/cnothing'
#   export CERTBOT_EMAIL='you@example.com'
#   bash deploy/setup-cnothing-server.sh
#
# Optional: export BOTGROCER_PARENT=/path/to/parent   (if auto-detect fails)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/IamWills/CNothing.git}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
DATABASE_URL="${DATABASE_URL:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL}" ]]; then
  echo "Set DATABASE_URL (PostgreSQL) for CNothing, e.g.:" >&2
  echo "  export DATABASE_URL='postgresql://cnothing:SECRET@127.0.0.1:5432/cnothing'" >&2
  exit 1
fi

if [[ -z "${CERTBOT_EMAIL}" ]]; then
  echo "Set CERTBOT_EMAIL for Let's Encrypt registration, e.g.:" >&2
  echo "  export CERTBOT_EMAIL='you@example.com'" >&2
  exit 1
fi

ensure_bun() {
  local current
  current="$(command -v bun 2>/dev/null || true)"
  if [[ -n "${current}" && "${current}" != /root/.bun/* ]]; then
    return 0
  fi
  echo "Installing Bun to /usr/local (so user keyservice can run it)..."
  export BUN_INSTALL=/usr/local
  curl -fsSL https://bun.sh/install | bash
  hash -r
  command -v bun >/dev/null 2>&1 || {
    echo "bun not found after install; check /usr/local/bin/bun" >&2
    exit 1
  }
}

# systemd runs as non-root; a symlink /usr/local/bin/bun -> /root/.bun/bin/bun breaks execution.
ensure_bun_not_root_symlink() {
  local target=/usr/local/bin/bun
  [[ -e "${target}" ]] || return 0
  if [[ -L "${target}" ]]; then
    local real
    real="$(readlink -f "${target}" 2>/dev/null || true)"
    if [[ "${real}" == /root/.bun/* ]]; then
      echo "Replacing ${target} (symlink under /root) with a real binary for systemd user..."
      rm -f "${target}"
      cp /root/.bun/bin/bun "${target}"
      chmod 755 "${target}"
    fi
  fi
}

detect_parent() {
  if [[ -n "${BOTGROCER_PARENT:-}" ]]; then
    echo "${BOTGROCER_PARENT}"
    return
  fi
  local bot
  bot="$(find /var/www /srv /home /opt /root -maxdepth 6 -type d -name botgrocer 2>/dev/null | head -1 || true)"
  if [[ -n "${bot}" ]]; then
    dirname "${bot}"
    return
  fi
  if [[ -d /var/www/botgrocer.com ]]; then
    echo "/var/www"
    return
  fi
  echo "Could not find botgrocer; set BOTGROCER_PARENT to the parent directory." >&2
  exit 1
}

PARENT="$(detect_parent)"
KEYSERVICE_DIR="${PARENT}/keyservice"
DEPLOY_DIR="${KEYSERVICE_DIR}/deploy"

echo "Using parent: ${PARENT}"
echo "KeyService dir: ${KEYSERVICE_DIR}"

ensure_bun
ensure_bun_not_root_symlink

if [[ ! -d "${KEYSERVICE_DIR}/.git" ]]; then
  git clone "${REPO_URL}" "${KEYSERVICE_DIR}"
else
  git -C "${KEYSERVICE_DIR}" pull --ff-only || true
fi

cd "${KEYSERVICE_DIR}"
bun install

if [[ ! -f .env ]]; then
  bun run generate-secrets
  {
    echo "PORT=3021"
    echo "DATABASE_URL=${DATABASE_URL}"
    echo "KEYSERVICE_CHALLENGE_TTL_SECONDS=300"
    cat .local-keys/generated.env
  } > .env
  chmod 600 .env
  chmod 700 .local-keys 2>/dev/null || true
  chmod 600 .local-keys/authai-private-key.pem 2>/dev/null || true
else
  echo ".env exists; not overwriting. Ensure PORT=3021 and DATABASE_URL are set."
fi

bun run migrate

KEYSERVICE_USER="${KEYSERVICE_USER:-keyservice}"
if ! id -u "${KEYSERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home "${KEYSERVICE_DIR}" --shell /usr/sbin/nologin "${KEYSERVICE_USER}" || true
fi
chown -R "${KEYSERVICE_USER}:${KEYSERVICE_USER}" "${KEYSERVICE_DIR}"

BUN_BIN="$(command -v bun)"
ensure_bun_not_root_symlink
BUN_BIN="$(command -v bun)"
SERVICE_SRC="${DEPLOY_DIR}/keyservice.service"
SERVICE_DST="/etc/systemd/system/keyservice.service"
sed -e "s|KEYSERVICE_USER|${KEYSERVICE_USER}|g" \
    -e "s|KEYSERVICE_GROUP|${KEYSERVICE_USER}|g" \
    -e "s|KEYSERVICE_ROOT|${KEYSERVICE_DIR}|g" \
    -e "s|KEYSERVICE_BUN|${BUN_BIN}|g" \
    "${SERVICE_SRC}" > "${SERVICE_DST}"

systemctl daemon-reload
systemctl enable keyservice.service
systemctl restart keyservice.service

if ! systemctl is-active --quiet keyservice.service; then
  echo "keyservice failed to start; check: journalctl -u keyservice -n 50 --no-pager" >&2
  exit 1
fi

NGINX_AVAIL="/etc/nginx/sites-available/cnothing.com"
NGINX_EN="/etc/nginx/sites-enabled/cnothing.com"
cp "${DEPLOY_DIR}/nginx-cnothing.conf" "${NGINX_AVAIL}"
ln -sf "${NGINX_AVAIL}" "${NGINX_EN}"
nginx -t
systemctl reload nginx

if ! command -v certbot >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
  else
    echo "Install certbot + nginx plugin, then re-run certbot step." >&2
    exit 1
  fi
fi

# Some Certbot/LE combinations error on a 3-domain first request ("No such authorization");
# issue apex first, then expand to www + ai.
CERTBOT_BASE=(--nginx --non-interactive --agree-tos -m "${CERTBOT_EMAIL}")
if certbot certificates 2>/dev/null | grep -q "Certificate Name: cnothing.com"; then
  certbot "${CERTBOT_BASE[@]}" \
    --cert-name cnothing.com \
    -d cnothing.com -d www.cnothing.com -d ai.cnothing.com \
    --expand
else
  certbot "${CERTBOT_BASE[@]}" -d cnothing.com --redirect
  certbot "${CERTBOT_BASE[@]}" \
    --cert-name cnothing.com \
    -d cnothing.com -d www.cnothing.com -d ai.cnothing.com \
    --expand
fi

systemctl enable certbot.timer 2>/dev/null || true
systemctl start certbot.timer 2>/dev/null || true
if ! certbot renew --dry-run; then
  echo "certbot renew --dry-run failed (another certbot may be running); retry later." >&2
fi

chmod +x "${DEPLOY_DIR}/keyservice-sync.sh"
sed -e "s|KEYSERVICE_DIR|${KEYSERVICE_DIR}|g" \
  "${DEPLOY_DIR}/keyservice-sync.service" > /etc/systemd/system/keyservice-sync.service
cp "${DEPLOY_DIR}/keyservice-sync.timer" /etc/systemd/system/keyservice-sync.timer
systemctl daemon-reload
systemctl enable keyservice-sync.timer
systemctl start keyservice-sync.timer

echo "Done. KeyService: systemctl status keyservice"
echo "HTTPS: certbot certificates; auto-renew: systemctl status certbot.timer"
echo "Git sync: systemctl status keyservice-sync.timer; logs: journalctl -u keyservice-sync.service"
