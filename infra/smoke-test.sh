#!/usr/bin/env bash
# Comprueba que el juego responde: HTTP directo, HTTPS por dominio y el WebSocket.
#   ./smoke-test.sh [dominio] [ip]
set -uo pipefail
DOMAIN="${1:-codenames.cnexans.com}"
IP="${2:-$(pulumi stack output ip 2>/dev/null)}"
ok(){ printf '✅ %s\n' "$1"; }; bad(){ printf '❌ %s\n' "$1"; }

# curl imprime 000 si ni siquiera conecta; recortamos a 3 dígitos porque tras un
# 101 la conexión queda abierta y curl añade su propio código al agotar el tiempo.
probe(){ local out; out=$(curl -s -o /dev/null -w '%{http_code}' "$@" 2>/dev/null); echo "${out:0:3}"; }

# El puerto del servidor de juego NO debe ser accesible desde fuera: todo el
# tráfico tiene que pasar por Caddy, que es quien pone el TLS.
if [ -n "${IP:-}" ]; then
  code=$(probe --max-time 6 "http://${IP}:3000/")
  [ "$code" = 000 ] && ok "puerto 3000 cerrado a internet" || bad "puerto 3000 expuesto (respondió $code): el tráfico puede ir sin cifrar"
fi

redir=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 "http://${DOMAIN}/" || true)
case "$redir" in
  30*"https://${DOMAIN}"*) ok "http → https (${redir%% *})" ;;
  *) bad "sin redirección a https: $redir" ;;
esac

resolved=$(dig +short "$DOMAIN" | tail -1)
[ -n "$resolved" ] && ok "DNS ${DOMAIN} → ${resolved}" || bad "DNS ${DOMAIN} sin resolver (falta el registro A en Cloudflare)"

code=$(probe --max-time 12 "https://${DOMAIN}/")
[ "$code" = 200 ] && ok "https://${DOMAIN} → 200 (certificado válido)" || bad "https://${DOMAIN} → $code (Caddy aún pidiendo el certificado o DNS sin propagar)"

# Handshake de WebSocket (101 Switching Protocols).
# --http1.1 es obligatorio: sobre HTTP/2 curl descarta las cabeceras de Upgrade
# y la petición llega al servidor como un GET normal, que responde 404.
ws=$(probe --max-time 6 --http1.1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: $(head -c16 /dev/urandom | base64)" "https://${DOMAIN}/ws")
[ "$ws" = 101 ] && ok "WebSocket wss://${DOMAIN}/ws → 101" || bad "WebSocket /ws → $ws"

echo
echo "Partida completa de prueba:  node test/flow.mjs wss://${DOMAIN}/ws"
