#!/usr/bin/env bash
# Enciende, apaga o consulta el servidor del juego.
#
#   ./servidor.sh estado     # en qué anda y con qué IP
#   ./servidor.sh on         # arrancar (tarda ~75 s en responder)
#   ./servidor.sh off        # apagar
#   ./servidor.sh on --wait  # arrancar y esperar a que el juego conteste
#
# Apagar detiene el reloj de cómputo ($0.0116/h). El disco y la IPv4 siguen
# corriendo (~$4.3/mes) y la IP elástica NO se suelta: el dominio sigue
# apuntando bien cuando vuelve a encenderse.
#
# Funciona igual en local y en CI (GitHub Actions): usa la cadena de
# credenciales normal del AWS CLI.
set -euo pipefail

DOMINIO="${CODENAMES_DOMAIN:-codenames.cnexans.com}"

# Si el entorno arrastra llaves caducadas, tapan al perfil o a la sesión de
# 'aws login'. Se detecta y se reintenta sin ellas.
if ! aws sts get-caller-identity >/dev/null 2>&1; then
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "Sin credenciales válidas de AWS. En local: 'aws login'. En CI: revisa los secretos." >&2
    exit 1
  fi
fi

ID=$(aws ec2 describe-instances \
      --filters "Name=tag:App,Values=nombres-clave" \
                "Name=instance-state-name,Values=running,stopped,stopping,pending" \
      --query "Reservations[].Instances[0].InstanceId" --output text)
[ -n "$ID" ] && [ "$ID" != "None" ] || { echo "No encuentro la instancia del juego" >&2; exit 1; }

estado() {
  aws ec2 describe-instances --instance-ids "$ID" \
    --query "Reservations[].Instances[].[InstanceId,InstanceType,State.Name,PublicIpAddress]" --output text
}

esperar_juego() {
  echo -n "  esperando a que el juego responda"
  for _ in $(seq 1 40); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://${DOMINIO}/" || true)" = 200 ]; then
      echo " ✅ listo"; return 0
    fi
    echo -n "."; sleep 10
  done
  echo " ⚠ sigue sin responder; mira 'journalctl -u codenames' por SSM"; return 1
}

case "${1:-estado}" in
  on|encender|start)
    aws ec2 start-instances --instance-ids "$ID" \
      --query "StartingInstances[].[InstanceId,PreviousState.Name,CurrentState.Name]" --output text
    [ "${2:-}" = "--wait" ] && esperar_juego || echo "  arrancando: el juego tarda ~75 s (Node, la app y Caddy)."
    ;;
  off|apagar|stop)
    aws ec2 stop-instances --instance-ids "$ID" \
      --query "StoppingInstances[].[InstanceId,PreviousState.Name,CurrentState.Name]" --output text
    ;;
  estado|status) estado ;;
  *) echo "uso: ./servidor.sh [estado|on|off] [--wait]" >&2; exit 1 ;;
esac
