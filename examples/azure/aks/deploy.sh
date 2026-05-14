#!/bin/bash
# Deploy CADUCEUS to Azure AKS (Kubernetes).
# Usage: ./examples/azure/aks/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Configure these ───────────────────────────────────────────────────────
STACK="<stack-name>"
CLUSTER_NAME="<cluster-name>"
RESOURCE_GROUP="<resource-group>"
# ───────────────────────────────────────────────────────────────────────────

# Ensure cluster credentials are available
az aks get-credentials --resource-group "$RESOURCE_GROUP" --name "$CLUSTER_NAME" --overwrite-existing

cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null || bun install --silent
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
pulumi up --yes

echo ""
echo "=== Deployment complete ==="
echo "Site: https://$(pulumi config get caduceus:hostname)"
