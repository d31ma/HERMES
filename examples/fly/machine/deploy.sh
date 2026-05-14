#!/bin/bash
# Deploy CADUCEUS to Fly.io.
# Usage: ./examples/fly/machine/deploy.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK="<stack-name>"

cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null || bun install --silent
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
pulumi up --yes

echo ""
echo "=== Deployment complete ==="
echo "Site: https://$(pulumi config get caduceus:hostname)"
