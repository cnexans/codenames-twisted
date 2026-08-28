#!/usr/bin/env bash
# Mueve el estado de Pulumi de su nube a un bucket en TU cuenta y deja el
# despliegue automático configurado. Se corre UNA vez.
#
#   cd infra && ./migrar-estado.sh
#
# Después de esto el CI no necesita ningún token externo: le basta con el rol
# OIDC. Ojo: 'pulumi login' es un ajuste global de tu máquina, así que a partir
# de aquí tus comandos locales de pulumi también irán contra S3.
set -euo pipefail
cd "$(dirname "$0")"
REPO="${1:-cnexans/codenames-twisted}"

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  aws sts get-caller-identity >/dev/null 2>&1 || { echo "Sin credenciales de AWS: corre 'aws login'." >&2; exit 1; }
fi
CUENTA=$(aws sts get-caller-identity --query Account --output text)
BUCKET="codenames-pulumi-state-${CUENTA}"
ROL_ARN="arn:aws:iam::${CUENTA}:role/codenames-deploy"

echo "▶ 1/5 · rol OIDC y bucket de estado"
./ci-setup.sh "$REPO"

echo "▶ 2/5 · copia de seguridad del estado actual (Pulumi Cloud)"
COPIA="$(pwd)/estado-prod-$(date +%Y%m%d%H%M%S).json"
pulumi stack select prod
pulumi stack export --file "$COPIA"
echo "   guardado en $COPIA  (no lo borres hasta comprobar que todo va bien)"

echo "▶ 3/5 · crear el stack en S3 e importar el estado"
# Frase de paso gratuita en lugar de una clave KMS de pago: la configuración de
# este stack no guarda ningún secreto, así que no cifra nada de valor.
FRASE=$(openssl rand -base64 32)
export PULUMI_CONFIG_PASSPHRASE="$FRASE"
pulumi login "s3://${BUCKET}"
pulumi stack init prod --secrets-provider passphrase
pulumi stack import --file "$COPIA"

echo "▶ 4/5 · comprobar que Pulumi no ve diferencias"
if pulumi preview --diff 2>&1 | tee /tmp/preview.txt | tail -20; then
  grep -qE "^Resources:\s*$|no changes|[0-9]+ unchanged" /tmp/preview.txt \
    || echo "   ⚠ revisa la salida: debería decir que todo está 'unchanged'"
fi

echo "▶ 5/5 · configurar el repositorio"
gh variable set AWS_DEPLOY_ROLE  --repo "$REPO" --body "$ROL_ARN"
gh variable set PULUMI_STATE_URL --repo "$REPO" --body "s3://${BUCKET}"
gh secret   set PULUMI_CONFIG_PASSPHRASE --repo "$REPO" --body "$FRASE"

echo
echo "Listo. El CI ya puede desplegar sin credenciales guardadas."
echo "Queda por hacer a mano, cuando estés seguro:"
echo "  · borrar el stack viejo en Pulumi Cloud para que no haya dos estados:"
echo "      pulumi login && pulumi stack rm prod"
