#!/bin/bash
# Arranque de la instancia: Node + la app + Caddy con HTTPS automático.
set -euxo pipefail
exec > >(tee /var/log/codenames-boot.log | logger -t codenames) 2>&1

APP_BUCKET="__BUCKET__"
APP_KEY="__KEY__"
DOMAIN="__DOMAIN__"
ACME_EMAIL="__EMAIL__"

dnf -y install tar gzip
dnf -y install nodejs20 || dnf -y install nodejs22 || dnf -y install nodejs
node -v

# ── aplicación ────────────────────────────────────────────────
id -u codenames &>/dev/null || useradd --system --home /opt/codenames --shell /sbin/nologin codenames
rm -rf /opt/codenames && mkdir -p /opt/codenames
aws s3 cp "s3://${APP_BUCKET}/${APP_KEY}" /tmp/app.tgz
tar xzf /tmp/app.tgz -C /opt/codenames
cd /opt/codenames
npm ci --omit=dev --no-audit --no-fund
chown -R codenames:codenames /opt/codenames

cat >/etc/systemd/system/codenames.service <<'UNIT'
[Unit]
Description=Nombres Clave (servidor de juego)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=codenames
WorkingDirectory=/opt/codenames
Environment=NODE_ENV=production PORT=3000
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

# ── Caddy (proxy inverso + TLS de Let's Encrypt) ──────────────
CADDY_URL=$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest \
  | grep -o 'https://[^"]*linux_amd64\.tar\.gz' | head -1)
curl -fsSL "$CADDY_URL" -o /tmp/caddy.tgz
tar xzf /tmp/caddy.tgz -C /tmp caddy
install -m 0755 /tmp/caddy /usr/local/bin/caddy
id -u caddy &>/dev/null || useradd --system --home /var/lib/caddy --create-home --shell /sbin/nologin caddy
mkdir -p /etc/caddy /var/lib/caddy
chown -R caddy:caddy /var/lib/caddy

cat >/etc/caddy/Caddyfile <<CADDYFILE
{
	email ${ACME_EMAIL}
}

${DOMAIN} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
	log {
		output file /var/log/caddy/access.log {
			roll_size 10MiB
			roll_keep 3
		}
	}
}
CADDYFILE
chown caddy:caddy /etc/caddy/Caddyfile

cat >/etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
LogsDirectory=caddy
LogsDirectoryMode=0750
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
Restart=on-failure
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now codenames caddy
systemctl is-active codenames caddy
echo "✅ Nombres Clave desplegado en ${DOMAIN}"
