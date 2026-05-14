#!/bin/bash
# Deploy CADUCEUS to AWS Lambda (container image).
# Usage: ./examples/aws/lambda/deploy.sh [--seed-admin]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ── Configure these ───────────────────────────────────────────────────────
STACK="<stack-name>"
REGION="<region>"
REPO="<ecr-repo-name>"
VERSION="<image-tag>"
# ───────────────────────────────────────────────────────────────────────────

cd "$PROJECT_ROOT"

echo "=== Building Lambda binary ==="
bun run compile:lambda

echo "=== Building Docker image ==="
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI"

# Ensure ECR repo exists
aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name "$REPO" --region "$REGION"

docker build --no-cache --platform linux/arm64 \
  -f examples/aws/lambda/Dockerfile \
  -t "${REPO}:${VERSION}" \
  -t "${ECR_URI}:${VERSION}" \
  .

docker push "${ECR_URI}:${VERSION}"

echo "=== Provisioning infrastructure ==="
cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null || bun install --silent
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
pulumi up --yes

FUNCTION_URL=$(pulumi stack output functionUrlOutput)
echo ""
echo "=== Deployment complete ==="
echo "URL: $FUNCTION_URL"
echo "Site: https://$(pulumi config get caduceus:hostname)"

# Seed admin user
if [ "${1:-}" = "--seed-admin" ]; then
  echo ""
  echo "=== Seeding admin user ==="
  ADMIN_EMAIL=$(pulumi config get caduceus:adminEmail)
  ADMIN_PHONE=$(pulumi config get caduceus:adminPhone)
  MAIL_DOMAIN=$(pulumi config get caduceus:mailDomain)
  curl -sS -X POST "$FUNCTION_URL/test/seed/user" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"phones\":[\"$ADMIN_PHONE\"],\"domains\":[\"$MAIL_DOMAIN\"],\"role\":\"admin\"}"
  echo ""
  echo "Admin user seeded: $ADMIN_EMAIL"
fi
