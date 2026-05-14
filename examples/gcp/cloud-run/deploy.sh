#!/bin/bash
# Deploy CADUCEUS to GCP Cloud Run.
# Usage: ./examples/gcp/cloud-run/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Configure these ───────────────────────────────────────────────────────
STACK="<stack-name>"
# ───────────────────────────────────────────────────────────────────────────

cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null || bun install --silent
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
pulumi up --yes

SERVICE_URL=$(pulumi stack output serviceUrl)
echo ""
echo "=== Deployment complete ==="
echo "URL: $SERVICE_URL"
echo ""
echo "To seed an admin user, run:"
echo "  curl -sS -X POST $SERVICE_URL/test/seed/user \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"admin@$(pulumi config get caduceus:mailDomain)\",\"phones\":[\"+1...\"],\"domains\":[\"$(pulumi config get caduceus:mailDomain)\"],\"role\":\"admin\"}'"
