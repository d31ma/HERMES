#!/bin/bash
# Deploy CADUCEUS to Azure Container Apps.
# Usage: ./examples/azure/container-apps/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Configure these ───────────────────────────────────────────────────────
STACK="<stack-name>"
# ───────────────────────────────────────────────────────────────────────────

# Log in to Azure if not already
az account show >/dev/null 2>&1 || az login

cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null || bun install --silent
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
pulumi up --yes

APP_URL=$(pulumi stack output appUrl)
echo ""
echo "=== Deployment complete ==="
echo "URL: $APP_URL"
echo ""
echo "To seed an admin user:"
echo "  curl -sS -X POST $APP_URL/test/seed/user \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"admin@$(pulumi config get caduceus:mailDomain)\",\"phones\":[\"+1...\"],\"domains\":[\"$(pulumi config get caduceus:mailDomain)\"],\"role\":\"admin\"}'"
