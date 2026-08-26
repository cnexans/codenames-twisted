#!/usr/bin/env bash
# Comprueba que el juego responde: HTTP directo, HTTPS por dominio y el WebSocket.
#   ./smoke-test.sh [dominio] [ip]
set -uo pipefail
DOMAIN="${1:-codenames.cnexans.com}"
IP="${2:-$(pulumi stack output ip 2>/dev/null)}"
ok(){ printf '✅ %s\n' "$1"; }; bad(){ printf '❌ %s\n' "$1"; }

if [ -n "${IP:-}" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://${IP}:3000/" || echo 000)
  [ "$code" = 200 ] && ok "app directa http://${IP}:3000 → 200" || bad "app directa → $code (¿sigue arrancando la instancia?)"
fi

resolved=$(dig +short "$DOMAIN" | tail -1)
[ -n "$resolved" ] && ok "DNS ${DOMAIN} → ${resolved}" || bad "DNS ${DOMAIN} sin resolver (falta el registro A en Cloudflare)"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "https://${DOMAIN}/" || echo 000)
[ "$code" = 200 ] && ok "https://${DOMAIN} → 200 (certificado válido)" || bad "https://${DOMAIN} → $code (Caddy aún pidiendo el certificado o DNS sin propagar)"

# Handshake de WebSocket (101 Switching Protocols)
ws=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: $(head -c16 /dev/urandom | base64)" "https://${DOMAIN}/ws" || echo 000)
[ "$ws" = 101 ] && ok "WebSocket /ws → 101" || bad "WebSocket /ws → $ws"
