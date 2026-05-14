#!/bin/bash
# Deploy CADUCEUS to AWS EC2 (standalone binary).
# Usage: ./examples/aws/ec2/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ── Configure these ───────────────────────────────────────────────────────
STACK="<stack-name>"
DEPLOY_BUCKET="<s3-bucket-for-binary>"
# ───────────────────────────────────────────────────────────────────────────

# Build the binary for ARM64
cd "$PROJECT_ROOT"
echo "=== Building standalone binary ==="
bun run compile -- --target linux-arm64

# Upload to S3
echo "=== Uploading binary to S3 ==="
aws s3 cp caduceus-linux-arm64 "s3://${DEPLOY_BUCKET}/caduceus-linux-arm64"

cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null || bun install --silent
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"
pulumi up --yes

echo ""
echo "=== Deployment complete ==="
echo "Site: https://$(pulumi config get caduceus:hostname)"
