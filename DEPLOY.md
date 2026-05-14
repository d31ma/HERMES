# Deploying CADUCEUS

CADUCEUS can run as a **Docker container**, a **standalone binary**, or a **serverless function** (AWS Lambda). This guide covers deployment on the three major cloud providers — AWS, Azure, and Google Cloud — with guidance that applies to any container or VM host.

- [Choose a deployment model](#choose-a-deployment-model)
- [Common requirements for all models](#common-requirements-for-all-models)
- [Docker container](#docker-container)
  - [AWS ECS Fargate](#aws-ecs-fargate)
  - [Azure Container Apps](#azure-container-apps)
  - [Google Cloud Run](#google-cloud-run)
- [Standalone binary](#standalone-binary)
  - [AWS EC2 / Lightsail](#aws-ec2--lightsail)
  - [Azure VM](#azure-vm)
  - [GCP Compute Engine](#gcp-compute-engine)
- [Serverless — AWS Lambda](#serverless--aws-lambda)
- [Serverless — Azure Functions / GCP Cloud Functions](#serverless--azure-functions--gcp-cloud-functions)
- [Storage and data persistence](#storage-and-data-persistence)
- [Adapter configuration](#adapter-configuration)
- [Health checks](#health-checks)
- [Multi-domain setup](#multi-domain-setup)
- [Web Push notifications](#web-push-notifications)
- [OAuth social login](#oauth-social-login)

## Choose a deployment model

| Model | Best for | Cost model | Scaling |
|---|---|---|---|
| Docker container | Long-running services, moderate-to-high traffic | Per-instance | Manual or auto-scale |
| Standalone binary | Single-tenant VMs, bare metal, edge | Fixed | Manual |
| Serverless (Lambda) | Low-to-sporadic traffic, event-driven | Per-request | Automatic (to zero) |
| Serverless (Cloud Run) | Variable traffic with container tooling | Per-request | Automatic (to zero) |

**Rule of thumb**: start with a container (Cloud Run / ECS Fargate / Container Apps) if you expect steady traffic. Use Lambda for low-volume or bursty workloads where you want to scale to zero. Use the standalone binary on VMs or bare metal when you control the host and don't want a container runtime.

## Common requirements for all models

Every deployment needs:

1. **Secrets** — `JWT_SECRET` and `INBOUND_WEBHOOK_SECRET` (strong random values)
2. **Storage** — a writable directory for Fylo (the file-backed database) and attachments
3. **Port 8080** — the HTTP listener for API and frontend requests
4. **A reverse proxy or load balancer** — CADUCEUS does not terminate TLS; put it behind a TLS-terminating proxy or cloud load balancer

Set these at minimum:

```sh
JWT_SECRET=<strong-random-value>
INBOUND_WEBHOOK_SECRET=<another-strong-random-value>
FYLO_ROOT=/data            # or any writable path
ATTACHMENT_ROOT=/data/attachments
HOST=0.0.0.0
PORT=8080
```

For production, also configure an SMTP and SMS adapter (see [Adapter configuration](#adapter-configuration)). Without one, outgoing mail and codes log to stdout but are not delivered.

## Docker container

CADUCEUS images are published to `ghcr.io/d31ma/caduceus` tagged with a [CalVer](https://calver.org) date (`YY.WW.DD`) and `latest`. The image is multi-arch (`linux/amd64`, `linux/arm64`).

The container entrypoint is the Tachyon server. It bundles the frontend, compiles pages, and starts listening on the configured `PORT` (default 8080). Startup is typically <500 ms.

```sh
docker run --rm \
  -p 8080:8080 \
  -e JWT_SECRET=change-me \
  -e INBOUND_WEBHOOK_SECRET=change-me-too \
  -e SMS_ADAPTER=aws \
  -e SMTP_ADAPTER=aws \
  -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  -v caduceus-data:/data \
  ghcr.io/d31ma/caduceus:latest
```

A compose file is provided at [`tests/docker-compose.yml`](tests/docker-compose.yml) for local AWS adapter E2E testing with Floci:

```sh
bun run test:floci
```

The compose profile starts Floci on port 4566, runs CADUCEUS with `SMS_ADAPTER=aws` and `SMTP_ADAPTER=aws`, and executes the integration suite against the same `AWS_ENDPOINT_URL` wiring used for AWS deployment rehearsals.

### AWS ECS Fargate

ECS runs the CADUCEUS container on managed compute. You need an ECS cluster, a task definition, and a service.

**Task definition** (minimum):

```json
{
  "family": "caduceus",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<account>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "caduceus",
      "image": "ghcr.io/d31ma/caduceus:latest",
      "portMappings": [{ "containerPort": 8080 }],
      "environment": [
        { "name": "FYLO_ROOT", "value": "/data" },
        { "name": "ATTACHMENT_ROOT", "value": "/data/attachments" },
        { "name": "SMS_ADAPTER", "value": "aws" },
        { "name": "SMTP_ADAPTER", "value": "aws" },
        { "name": "AWS_REGION", "value": "us-east-1" }
      ],
      "secrets": [
        { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:..." },
        { "name": "INBOUND_WEBHOOK_SECRET", "valueFrom": "arn:aws:secretsmanager:..." }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/caduceus",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "caduceus"
        }
      }
    }
  ]
}
```

**Service** — create an ECS service behind an Application Load Balancer with a target group pointing to port 8080. The health check path is `/health`.

**IAM permissions** for the task role (when using AWS adapters):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish",
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    }
  ]
}
```

**Persistent data** — ECS Fargate ephemeral storage is wiped on task restart. Mount an EFS filesystem to the container at `/data` for durable Fylo and attachment storage:

```json
{
  "volumes": [
    {
      "name": "caduceus-data",
      "efsVolumeConfiguration": {
        "filesystemId": "fs-...",
        "rootDirectory": "/"
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "caduceus",
      "mountPoints": [
        { "sourceVolume": "caduceus-data", "containerPath": "/data" }
      ]
    }
  ]
}
```

### Azure Container Apps

Container Apps runs CADUCEUS as a managed container with automatic HTTPS, scaling, and revision management.

1. Push the image to Azure Container Registry (or reference `ghcr.io/d31ma/caduceus` directly).
2. Create a Container App with:
   - **Container image**: `ghcr.io/d31ma/caduceus:latest`
   - **Target port**: `8080`
   - **Ingress**: enabled, external, HTTP
   - **Health probe**: path `/health`, port `8080`

3. Set environment variables in the Container App's configuration:

```
FYLO_ROOT=/data
ATTACHMENT_ROOT=/data/attachments
SMS_ADAPTER=azure
SMTP_ADAPTER=azure
AZURE_COMMUNICATION_ENDPOINT=https://<resource>.communication.azure.com
AZURE_COMMUNICATION_KEY=secretref:azure-comm-key
JWT_SECRET=secretref:jwt-secret
INBOUND_WEBHOOK_SECRET=secretref:inbound-secret
```

4. **Persistent data** — mount an Azure Files share at `/data` through the Container App's volume configuration:

```yaml
properties:
  template:
    volumes:
      - name: caduceus-data
        storageType: AzureFile
        storageName: caduceusdatastorage
    containers:
      - volumeMounts:
          - volumeName: caduceus-data
            mountPath: /data
```

5. **Scaling** — Container Apps scales HTTP workloads by request count. Minimum replicas of 0 scales to zero when idle (cold start ~1 s). Set minimum to 1 for always-warm.

### Google Cloud Run

Cloud Run runs the CADUCEUS container with fully-managed infrastructure, automatic HTTPS certificates, and scale-to-zero.

```sh
gcloud run deploy caduceus \
  --image ghcr.io/d31ma/caduceus:latest \
  --port 8080 \
  --cpu 1 \
  --memory 512Mi \
  --set-env-vars FYLO_ROOT=/data,ATTACHMENT_ROOT=/data/attachments,SMS_ADAPTER=gcp,SMTP_ADAPTER=gcp \
  --set-secrets JWT_SECRET=jwt-secret:latest,INBOUND_WEBHOOK_SECRET=inbound-secret:latest \
  --region us-central1 \
  --allow-unauthenticated
```

**Note**: Cloud Run is stateless — container filesystem writes are ephemeral. For durable mail data you have two options:

1. **Cloud Run + GCS Fuse** (recommended for Cloud Run): mount a GCS bucket at `/data` using gcsfuse. This makes Fylo files durable across container restarts and scaling events.

2. **Use GKE Autopilot** instead of Cloud Run if you need traditional persistent volumes.

3. **Single-replica only** — Cloud Run's concurrency model means multiple instances could write to the same Fylo directory, causing conflicts. Set `--max-instances 1` or use a shared filesystem.

**For multi-instance deployments**, switch to GKE with a ReadWriteOnce PVC, or use a single Cloud Run instance with `--max-instances 1` behind a load balancer.

## Standalone binary

The standalone binary bundles Bun's runtime, Tachyon, and CADUCEUS into a single executable. It runs on any Linux or macOS host with no dependencies.

Build it:

```sh
# For the current platform
bun run compile

# Cross-compile for Linux x86-64
bun run compile -- --target linux-amd64

# Cross-compile for Linux ARM64 (Graviton, Ampere)
bun run compile -- --target linux-arm64
```

Output: `caduceus-<target>` (e.g. `caduceus-linux-amd64`).

The binary accepts the same commands as the Docker entrypoint:

```sh
./caduceus-linux-amd64 serve           # Start the server
./caduceus-linux-amd64 admin:create --email=... --phone=... --domain=...
./caduceus-linux-amd64 domain:migrate --from=... --to=... [--apply]
./caduceus-linux-amd64 help
```

### AWS EC2 / Lightsail

Launch an instance (Amazon Linux 2023, Ubuntu, or Debian), copy the binary, and run it with a systemd unit:

```ini
# /etc/systemd/system/caduceus.service
[Unit]
Description=CADUCEUS mail server
After=network.target

[Service]
Type=simple
User=caduceus
Group=caduceus
WorkingDirectory=/opt/caduceus
EnvironmentFile=/opt/caduceus/.env
ExecStart=/opt/caduceus/caduceus-linux-amd64 serve
Restart=always
RestartSec=5

[Service]
# Hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/data /opt/caduceus
```

Create the user, directories, and enable:

```sh
sudo useradd --system --create-home caduceus
sudo mkdir -p /data /data/attachments /opt/caduceus
sudo chown caduceus:caduceus /data /data/attachments /opt/caduceus
cp caduceus-linux-amd64 /opt/caduceus/
# Create /opt/caduceus/.env with required secrets
sudo systemctl daemon-reload
sudo systemctl enable --now caduceus
```

Put it behind an Application Load Balancer with TLS termination and a target group pointing to port 8080. The health check path is `/health`.

### Azure VM

Same pattern as EC2 — copy the binary to a Linux VM, create a systemd unit, and place it behind an Azure Load Balancer or Application Gateway.

For managed disks, attach a data disk and mount it at `/data` for persistence independent of the OS disk:

```sh
# After attaching and formatting /dev/sdc
sudo mkdir -p /data
echo '/dev/sdc /data ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount /data
sudo mkdir -p /data/attachments
sudo chown caduceus:caduceus /data /data/attachments
```

### GCP Compute Engine

Launch a VM, copy the binary, and set up systemd as above. For persistence, attach a persistent SSD:

```sh
gcloud compute instances create caduceus-vm \
  --machine-type e2-small \
  --boot-disk-size 20GB \
  --create-disk name=caduceus-data,size=50GB,type=pd-ssd \
  --zone us-central1-a
```

After attaching, format and mount at `/data`. Use a regional HTTP(S) load balancer in front for TLS termination.

## Serverless — AWS Lambda

CADUCEUS ships a Lambda handler (`scripts/lambda.mjs`) that starts an internal HTTP server and proxies Lambda invocations to it. Deploy as a custom runtime on Amazon Linux 2023.

### Build the Lambda binary

```sh
bun run compile:lambda
# Output: caduceus-lambda (Linux ARM64 binary)
```

### Package and deploy

```sh
# Create a bootstrap wrapper
cat > bootstrap << 'EOF'
#!/bin/sh
./caduceus-lambda
EOF
chmod +x bootstrap

# Package as a ZIP
zip caduceus-lambda.zip bootstrap caduceus-lambda
```

### Create the Lambda function

```sh
aws lambda create-function \
  --function-name caduceus \
  --runtime provided.al2023 \
  --role arn:aws:iam::<account>:role/lambda-caduceus-role \
  --handler bootstrap \
  --architectures arm64 \
  --timeout 30 \
  --memory-size 512 \
  --environment "Variables={FYLO_ROOT=/tmp/data,ATTACHMENT_ROOT=/tmp/attachments,JWT_SECRET=...,INBOUND_WEBHOOK_SECRET=...,SMS_ADAPTER=aws,SMTP_ADAPTER=aws,AWS_REGION=us-east-1}" \
  --zip-file fileb://caduceus-lambda.zip
```

### Lambda Function URL (simplest)

Enable a Function URL to invoke CADUCEUS directly over HTTPS without API Gateway:

```sh
aws lambda create-function-url-config \
  --function-name caduceus \
  --auth-type NONE \
  --invoke-mode BUFFERED
```

The Function URL is printed in the response. All HTTP methods and paths are forwarded to CADUCEUS.

**With auth**: set `--auth-type AWS_IAM` and use IAM authentication for admin endpoints. For a public-facing setup, place CloudFront in front of the Function URL to add WAF, caching, and a custom domain.

### API Gateway HTTP API (recommended for custom domains)

Create an HTTP API that proxies all routes to the Lambda:

```sh
# Create the API
API_ID=$(aws apigatewayv2 create-api \
  --name caduceus-api \
  --protocol-type HTTP \
  --target "arn:aws:lambda:us-east-1:<account>:function:caduceus" \
  --query 'ApiId' --output text)

# Add a catch-all route
aws apigatewayv2 create-route \
  --api-id $API_ID \
  --route-key '$default'

# Grant API Gateway permission to invoke Lambda
aws lambda add-permission \
  --function-name caduceus \
  --statement-id apigateway \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:<account>:$API_ID/*/*"
```

### Lambda IAM role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": ["sns:Publish", "ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*"
    }
  ]
}
```

### Lambda limitations

- **Ephemeral storage** — `/tmp` is the only writable path and is capped at 512 MB (or up to 10 GB with `--ephemeral-storage`). Fylo data and attachments live here and are lost on cold starts. For durable mail storage, mount an EFS filesystem to the Lambda.
- **Cold starts** — the compiled Bun binary has a ~200 ms cold start (typical). Provisioned concurrency eliminates cold starts for a fixed hourly cost.
- **No WebSocket / HMR** — Lambda's request-response model doesn't support WebSocket connections. The frontend bundle is served statically; the HMR dev server is not available.

### Lambda + EFS for durable storage

```sh
aws lambda update-function-configuration \
  --function-name caduceus \
  --file-system-configs "Arn=arn:aws:elasticfilesystem:us-east-1:<account>:access-point/fsap-...,LocalMountPath=/data"
```

Then set `FYLO_ROOT=/data` and `ATTACHMENT_ROOT=/data/attachments`. With EFS, data survives cold starts and is shared across concurrent Lambda instances.

## Serverless — Azure Functions / GCP Cloud Functions

Azure Functions and Google Cloud Functions are not directly compatible with the standalone Bun binary model. Instead, use the container-based serverless offerings that provide the same scale-to-zero behavior:

| If you want | Use |
|---|---|
| Azure serverless | **Azure Container Apps** with min replicas = 0 |
| GCP serverless | **Cloud Run** with min instances = 0 |

Both accept the standard CADUCEUS Docker image, provide automatic HTTPS, scale to zero, and charge per-request. The deployment steps are the same as the container sections above — just set minimum instances to 0.

## Storage and data persistence

CADUCEUS uses Fylo, a file-backed database. Every piece of state — domains, users, emails, MFA devices, push subscriptions — is a JSON file under `FYLO_ROOT`. Attachments are stored as raw files under `ATTACHMENT_ROOT`.

**Durability requirements**:

| Deployment model | Recommended storage |
|---|---|
| Single VM / container | Local volume with backups |
| ECS Fargate | EFS (`elasticFilesystem`) |
| Azure Container Apps | Azure Files share |
| Cloud Run | GCS Fuse bucket, or GKE with PVC |
| Lambda | EFS access point |
| Multi-instance (any) | Shared filesystem (EFS / Azure Files / NFS) + max-instances careful with Fylo concurrent writes |

**Important for multi-instance**: Fylo is not a distributed database. Concurrent writes from multiple processes to the same files can cause conflicts. If you run multiple instances, either:

1. Use a single replica (recommended for most setups).
2. Ensure only one instance handles write-heavy paths (inbound webhooks, send). You can route write endpoints to a single instance with load-balancer path rules.
3. Run multiple instances in read-only mode against a periodically-synced data copy (advanced).

For most CADUCEUS deployments, a single instance with regular backups is sufficient. The server handles thousands of emails per hour on modest hardware.

### Backups

Back up `FYLO_ROOT` and `ATTACHMENT_ROOT` regularly. With Fylo's file-backed model you can use any file-level backup tool:

```sh
# AWS S3
aws s3 sync /data s3://caduceus-backups/data-$(date +%Y%m%d)/

# Azure Blob
az storage blob upload-batch -d caduceus-backups -s /data

# GCP Cloud Storage
gsutil -m rsync -r /data gs://caduceus-backups/data-$(date +%Y%m%d)/
```

Schedule these as cron jobs or cloud-native scheduled tasks (EventBridge Scheduler, Azure Logic Apps, Cloud Scheduler).

## Adapter configuration

CADUCEUS talks to cloud SMS and email providers through adapters. The adapter is selected by environment variable.

### SMS adapters

| Adapter | Env var | Required config |
|---|---|---|
| Console (dev) | `SMS_ADAPTER=console` | None |
| AWS SNS | `SMS_ADAPTER=aws` | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| Azure Communication Services | `SMS_ADAPTER=azure` | `AZURE_COMMUNICATION_ENDPOINT`, `AZURE_COMMUNICATION_KEY`, `AZURE_SMS_FROM` |
| Twilio | `SMS_ADAPTER=twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |

### SMTP / Email adapters

| Adapter | Env var | Required config |
|---|---|---|
| Console (dev) | `SMTP_ADAPTER=console` | None |
| AWS SES | `SMTP_ADAPTER=aws` | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_FROM_ADDRESS` |
| Azure Communication Services | `SMTP_ADAPTER=azure` | `AZURE_COMMUNICATION_ENDPOINT`, `AZURE_COMMUNICATION_KEY`, `AZURE_EMAIL_FROM` |
| GCP Gmail API | `SMTP_ADAPTER=gcp` | `GCP_SERVICE_ACCOUNT_EMAIL`, `GCP_SERVICE_ACCOUNT_KEY`, `GCP_MAIL_FROM` |
| Mailgun | `SMTP_ADAPTER=mailgun` | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM` |
| SendGrid | `SMTP_ADAPTER=sendgrid` | `SENDGRID_API_KEY`, `SENDGRID_FROM` |
| Generic SMTP Relay | `SMTP_ADAPTER=smtp` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |

### AWS adapter with IAM roles

When running on AWS infrastructure (ECS, EC2, Lambda), use IAM roles instead of access keys. Grant the task/function role `sns:Publish` and `ses:SendEmail` permissions, then omit `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` — the SDK picks up the role automatically.

For ECS Fargate, assign the IAM role to the task. For EC2, attach it as an instance profile. For Lambda, use the execution role.

### AWS SES sandbox mode

New AWS SES accounts start in sandbox mode — you can only send to verified email addresses. To send to any recipient, request production access in the SES console. Until then, verify recipient addresses with `VerifyEmailIdentity` or use the SES console.

### Azure prerequisites

For Azure Communication Services, create an Email Communication Service and a Communication Service resource. Provision a custom domain or use an Azure-managed domain for the sender address. The endpoint URL has the form `https://<resource-name>.communication.azure.com`.

### GCP prerequisites

For Gmail API, create a service account with domain-wide delegation, enable the Gmail API in the project, and encode the service account JSON key as base64:

```sh
GCP_SERVICE_ACCOUNT_KEY=$(base64 < service-account.json)
```

## Health checks

CADUCEUS exposes two endpoints for health monitoring:

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness check. Returns `{"status":"ok","uptimeMs":<ms>}`. Responds immediately. |
| `GET /ready` | Readiness check. Returns 200 only when `JWT_SECRET` and `INBOUND_WEBHOOK_SECRET` are configured. Fails if secrets are missing or the data directory is unwritable. |

**Load balancer health check**: use `GET /health` with a 5-second interval and 3-second timeout. The startup period is <1 second for the HTTP server.

**Kubernetes probes**:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 30
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 3
  periodSeconds: 10
```

**Cloud Run / Container Apps**: configure the health check as a TCP or HTTP probe on port 8080, path `/health`.

## Multi-domain setup

CADUCEUS is multi-domain from the start. After the first admin is created:

1. The admin logs into the web UI and navigates to Settings → Domains.
2. Add a new domain with routing rules (match pattern → action).
3. Create users scoped to that domain.
4. Update DNS MX records to point inbound mail at CADUCEUS's inbound webhook endpoint.

For programmatic bootstrap on a fresh deployment:

```sh
# Docker
docker run --rm -v caduceus-data:/data ghcr.io/d31ma/caduceus:latest \
  admin:create --email=admin@example.com --phone=+14165550100 --domain=example.com

# Standalone binary
./caduceus-linux-amd64 admin:create \
  --email=admin@example.com --phone=+14165550100 --domain=example.com
```

The admin bootstrap command creates the domain with a default `*@example.com` → store route and creates the admin user. Repeat for each domain, or use the web UI after the first admin exists.

## Web Push notifications

CADUCEUS can push new-mail notifications to installed PWA clients. To enable in production:

1. Generate VAPID keys:

   ```sh
   bun node_modules/.bin/web-push generate-vapid-keys
   ```

2. Set the environment variables:

   ```
   VAPID_PUBLIC_KEY=<public-key>
   VAPID_PRIVATE_KEY=<private-key>
   VAPID_SUBJECT=mailto:admin@example.com
   ```

3. In local development or environments where push isn't needed, set `WEB_PUSH_DISABLED=true`. This skips delivery attempts and allows the server to start without VAPID keys.

## OAuth social login

CADUCEUS supports Google, Microsoft, and Apple sign-in. Configure the providers you want to enable:

```
OAUTH_REDIRECT_URI=https://caduceus.example.com/auth/oauth/callback
OAUTH_GOOGLE_CLIENT_ID=...
OAUTH_GOOGLE_CLIENT_SECRET=...
OAUTH_MICROSOFT_CLIENT_ID=...
OAUTH_MICROSOFT_CLIENT_SECRET=...
OAUTH_APPLE_CLIENT_ID=...
OAUTH_APPLE_CLIENT_SECRET=...
```

The redirect URI must be the public URL of your CADUCEUS instance with the path `/auth/oauth/callback`. Register this exact URI in each provider's developer console.

If no OAuth providers are configured, the login screen falls back to email + passkey authentication without showing provider buttons.

## Infrastructure as Code

Run the previous commands yourself or use the Pulumi examples under [`examples/`](examples/). Each subdirectory is a self-contained Pulumi project that provisions CADUCEUS on a specific compute service:

| Directory | Service | Persistent storage |
|---|---|---|
| [`examples/aws/lambda/`](examples/aws/lambda/) | Lambda (container image) | EFS |
| [`examples/aws/ecs-fargate/`](examples/aws/ecs-fargate/) | ECS Fargate + ALB | EFS |
| [`examples/aws/app-runner/`](examples/aws/app-runner/) | App Runner | Ephemeral |
| [`examples/aws/eks/`](examples/aws/eks/) | EKS (Kubernetes) | EFS CSI |
| [`examples/aws/ec2/`](examples/aws/ec2/) | EC2 (standalone binary) | EBS |

See `examples/aws/*/deploy.sh` in each directory for the build-and-deploy workflow. Terraform variants for AWS, Azure, and GCP are planned but not yet committed — the patterns above translate directly.
