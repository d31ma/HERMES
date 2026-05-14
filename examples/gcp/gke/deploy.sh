#!/bin/bash
# Deploy CADUCEUS to GCP GKE (Kubernetes).
# Usage: ./examples/gcp/gke/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Configure these ───────────────────────────────────────────────────────
STACK="<stack-name>"
CLUSTER_NAME="<cluster-name>"
PROJECT="<gcp-project>"
REGION="<region>"
# ───────────────────────────────────────────────────────────────────────────

# Ensure cluster credentials are available
gcloud container clusters get-credentials "$CLUSTER_NAME" --region "$REGION" --project "$PROJECT"

cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null || bun install --silent
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
pulumi up --yes

echo ""
echo "=== Deployment complete ==="
echo "Site: https://$(pulumi config get caduceus:hostname)"
