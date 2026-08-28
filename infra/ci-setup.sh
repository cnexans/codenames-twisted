#!/usr/bin/env bash
# Prepara el despliegue automático desde GitHub Actions. Es idempotente:
# se puede volver a correr sin romper nada.
#
#   ./ci-setup.sh [usuario/repo]
#
# Crea, si no existen:
#   1. el proveedor OIDC de GitHub en la cuenta (permite que Actions pida
#      credenciales temporales sin que exista ninguna llave permanente);
#   2. un rol que SOLO puede asumir este repositorio y solo desde main;
#   3. el bucket donde Pulumi guardará el estado (versionado y cifrado).
set -euo pipefail
REPO="${1:-cnexans/codenames-twisted}"
ROL="codenames-deploy"
REGION="${AWS_REGION:-us-east-1}"

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  aws sts get-caller-identity >/dev/null 2>&1 || { echo "Sin credenciales de AWS: corre 'aws login'." >&2; exit 1; }
fi
CUENTA=$(aws sts get-caller-identity --query Account --output text)
BUCKET="codenames-pulumi-state-${CUENTA}"
OIDC_ARN="arn:aws:iam::${CUENTA}:oidc-provider/token.actions.githubusercontent.com"

echo "▶ cuenta ${CUENTA} · repo ${REPO}"

# ── 1. proveedor OIDC ────────────────────────────────────────────
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  echo "  proveedor OIDC: ya existía"
else
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
  echo "  proveedor OIDC: creado"
fi

# ── 2. rol que solo puede asumir este repo desde main ────────────
# GitHub puede emitir el claim 'sub' con IDs numéricos inmutables
# (repo:usuario@123/repo@456), para que renombrar el repositorio no traspase la
# confianza a otro. No lo suponemos: se lo preguntamos a la API.
PREFIJO=$(gh api "/repos/${REPO}/actions/oidc/customization/sub" -q .sub_claim_prefix 2>/dev/null || true)
[ -n "$PREFIJO" ] && [ "$PREFIJO" != "null" ] || PREFIJO="repo:${REPO}"
echo "  claim de GitHub: ${PREFIJO}:ref:refs/heads/main"
CONFIANZA=$(cat <<JSON
{"Version":"2012-10-17","Statement":[{
  "Effect":"Allow",
  "Principal":{"Federated":"${OIDC_ARN}"},
  "Action":"sts:AssumeRoleWithWebIdentity",
  "Condition":{
    "StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"},
    "StringLike":{"token.actions.githubusercontent.com:sub":"${PREFIJO}:ref:refs/heads/main"}
  }}]}
JSON
)
if aws iam get-role --role-name "$ROL" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROL" --policy-document "$CONFIANZA"
  echo "  rol ${ROL}: ya existía (confianza actualizada)"
else
  aws iam create-role --role-name "$ROL" --assume-role-policy-document "$CONFIANZA" \
    --description "Despliegue de Nombres Clave desde GitHub Actions" >/dev/null
  echo "  rol ${ROL}: creado"
fi

# ── 3. permisos: lo justo para lo que gestiona Pulumi ────────────
PERMISOS=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"Computo","Effect":"Allow","Action":"ec2:*","Resource":"*"},
 {"Sid":"AmiPorSSM","Effect":"Allow","Action":["ssm:GetParameter","ssm:GetParameters"],"Resource":"*"},
 {"Sid":"RolesDelJuego","Effect":"Allow","Action":[
    "iam:CreateRole","iam:DeleteRole","iam:GetRole","iam:TagRole","iam:PassRole","iam:ListRoleTags",
    "iam:AttachRolePolicy","iam:DetachRolePolicy","iam:ListAttachedRolePolicies",
    "iam:PutRolePolicy","iam:DeleteRolePolicy","iam:GetRolePolicy","iam:ListRolePolicies",
    "iam:CreateInstanceProfile","iam:DeleteInstanceProfile","iam:GetInstanceProfile",
    "iam:AddRoleToInstanceProfile","iam:RemoveRoleFromInstanceProfile","iam:TagInstanceProfile"],
  "Resource":["arn:aws:iam::${CUENTA}:role/codenames-*","arn:aws:iam::${CUENTA}:instance-profile/codenames-*"]},
 {"Sid":"PoliticaGestionadaDeSSM","Effect":"Allow","Action":["iam:AttachRolePolicy","iam:DetachRolePolicy"],
  "Resource":"arn:aws:iam::${CUENTA}:role/codenames-*",
  "Condition":{"ArnEquals":{"iam:PolicyARN":"arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"}}},
 {"Sid":"Buckets","Effect":"Allow","Action":"s3:*","Resource":[
    "arn:aws:s3:::codenames-*","arn:aws:s3:::codenames-*/*"]},
 {"Sid":"ListarBuckets","Effect":"Allow","Action":["s3:ListAllMyBuckets","s3:CreateBucket"],"Resource":"*"}
]}
JSON
)
aws iam put-role-policy --role-name "$ROL" --policy-name "despliegue" --policy-document "$PERMISOS"
echo "  permisos: actualizados"

# ── 4. bucket del estado de Pulumi ───────────────────────────────
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "  bucket ${BUCKET}: ya existía"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
  aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  echo "  bucket ${BUCKET}: creado (versionado + cifrado + sin acceso público)"
fi

echo
echo "Listo. Configura el repositorio con:"
echo "  gh variable set AWS_DEPLOY_ROLE   --body arn:aws:iam::${CUENTA}:role/${ROL}"
echo "  gh variable set PULUMI_STATE_URL  --body s3://${BUCKET}"
