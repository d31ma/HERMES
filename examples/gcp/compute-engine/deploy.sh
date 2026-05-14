#!/bin/bash
# Deploy CADUCEUS to GCP Compute Engine.
# Usage: ./examples/gcp/compute-engine/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Configure these ───────────────────────────────────────────────────────
STACK="<stack-name>"
# ───────────────────────────────────────────────────────────────────────────

cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null || bun install --silent
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
pulumi up --yes

PUBLIC_IP=$(pulumi stack output publicIp)
echo ""
echo "=== Deployment complete ==="
echo "Public IP: $PUBLIC_IP"
echo "URL: http://$PUBLIC_IP:8080"
echo ""
echo "To seed an admin user:"
echo "  curl -sS -X POST http://$PUBLIC_IP:8080/test/seed/user \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"admin@$(pulumi config get caduceus:mailDomain)\",\"phones\":[\"+1...\"],\"domains\":[\"$(pulumi config get caduceus:mailDomain)\"],\"role\":\"admin\"}'"
