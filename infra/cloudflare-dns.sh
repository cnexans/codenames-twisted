#!/usr/bin/env bash
# Crea o actualiza el registro A en Cloudflare apuntando al servidor del juego.
#
#   CLOUDFLARE_API_TOKEN=... ./cloudflare-dns.sh codenames.cnexans.com 54.x.x.x
#
# El token necesita permiso "Zone → DNS → Edit" sobre la zona.
# El registro se crea SIN proxy (nube gris) para que Let's Encrypt pueda validar
# el dominio. Después puedes encender el proxy con SSL mode "Full (strict)".
set -euo pipefail

FQDN="${1:?uso: ./cloudflare-dns.sh <subdominio.dominio.com> <ip>}"
IP="${2:?falta la IP}"
ZONE="${FQDN#*.}"
: "${CLOUDFLARE_API_TOKEN:?exporta CLOUDFLARE_API_TOKEN}"
api() { curl -sf -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }

ZONE_ID=$(api "https://api.cloudflare.com/client/v4/zones?name=${ZONE}" | sed -n 's/.*"id":"\([a-f0-9]\{32\}\)".*/\1/p' | head -1)
[ -n "$ZONE_ID" ] || { echo "No encontré la zona ${ZONE} con ese token"; exit 1; }

REC_ID=$(api "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=A&name=${FQDN}" \
  | sed -n 's/.*"id":"\([a-f0-9]\{32\}\)".*/\1/p' | head -1)
BODY="{\"type\":\"A\",\"name\":\"${FQDN}\",\"content\":\"${IP}\",\"ttl\":120,\"proxied\":false}"

if [ -n "$REC_ID" ]; then
  api -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${REC_ID}" -d "$BODY" >/dev/null
  echo "✔ Registro A actualizado: ${FQDN} → ${IP}"
else
  api -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" -d "$BODY" >/dev/null
  echo "✔ Registro A creado: ${FQDN} → ${IP}"
fi
