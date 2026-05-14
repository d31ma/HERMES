#!/bin/bash
# Deploy CADUCEUS to AWS ECS Fargate.
# Usage: ./examples/aws/ecs-fargate/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Configure these ───────────────────────────────────────────────────────
STACK="<stack-name>"
# ───────────────────────────────────────────────────────────────────────────

cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null || bun install --silent
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
pulumi up --yes

ALB_DNS=$(pulumi stack output albDnsName)
echo ""
echo "=== Deployment complete ==="
echo "ALB DNS: $ALB_DNS"
echo "Site: https://$(pulumi config get caduceus:hostname)"
echo ""
echo "To seed an admin user, run:"
echo "  curl -sS -X POST https://$(pulumi config get caduceus:hostname)/test/seed/user \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"$(pulumi config get caduceus:adminEmail)\",\"phones\":[\"$(pulumi config get caduceus:adminPhone)\"],\"domains\":[\"$(pulumi config get caduceus:mailDomain)\"],\"role\":\"admin\"}'"
