#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
REPO_URL="${REPO_URL:-https://github.com/nietalinsabyrzan-rgb/Sabr.git}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/Sabr}"
APP_LINK="/opt/otbasy-instabot"
BOT_USER="otbasybot"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash instagram_bot/deploy/oracle/install.sh bot.example.com"
  echo "Before running, point the domain's A record to this Oracle VM public IP."
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash instagram_bot/deploy/oracle/install.sh $DOMAIN"
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg git

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

if ! id "$BOT_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/otbasy-instabot --create-home --shell /usr/sbin/nologin "$BOT_USER"
fi

mkdir -p /etc/otbasy-instabot /var/lib/otbasy-instabot/edge /var/lib/otbasy-instabot/model
chown -R "$BOT_USER:$BOT_USER" /var/lib/otbasy-instabot
chmod 700 /etc/otbasy-instabot

if [[ ! -d "$INSTALL_ROOT/.git" ]]; then
  git clone "$REPO_URL" "$INSTALL_ROOT"
else
  git -C "$INSTALL_ROOT" pull --ff-only
fi

ln -sfn "$INSTALL_ROOT/instagram_bot/instabot fin" "$APP_LINK"
cd "$APP_LINK"
npm ci
npm run build

if [[ ! -f /etc/otbasy-instabot/edge.env ]]; then
  cp "$INSTALL_ROOT/instagram_bot/deploy/oracle/env/edge.env.example" /etc/otbasy-instabot/edge.env
fi
if [[ ! -f /etc/otbasy-instabot/model.env ]]; then
  cp "$INSTALL_ROOT/instagram_bot/deploy/oracle/env/model.env.example" /etc/otbasy-instabot/model.env
fi
chmod 600 /etc/otbasy-instabot/*.env

cp "$INSTALL_ROOT/instagram_bot/deploy/oracle/systemd/"*.service /etc/systemd/system/

cat >/etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	reverse_proxy 127.0.0.1:3000
}
CADDY

systemctl daemon-reload
systemctl enable otbasy-instabot-model otbasy-instabot-edge caddy

cat <<NEXT

Installed files. Now edit secrets:
  sudo nano /etc/otbasy-instabot/model.env
  sudo nano /etc/otbasy-instabot/edge.env

Then start:
  sudo systemctl restart otbasy-instabot-model otbasy-instabot-edge caddy
  sudo systemctl status otbasy-instabot-model otbasy-instabot-edge caddy

Instagram webhook callback:
  https://$DOMAIN/webhook

NEXT
