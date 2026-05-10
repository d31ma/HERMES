# Deploying HERMES

HERMES can run as a **Docker container**, a **standalone binary**, or a **serverless function** (AWS Lambda). This guide covers deployment on the three major cloud providers — AWS, Azure, and Google Cloud — with guidance that applies to any container or VM host.

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
4. **A reverse proxy or load balancer** — HERMES does not terminate TLS; put it behind a TLS-terminating proxy or cloud load balancer

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

HERMES images are published to `ghcr.io/d31ma/hermes` tagged with a [CalVer](https://calver.org) date (`YY.WW.DD`) and `latest`. The image is multi-arch (`linux/amd64`, `linux/arm64`).

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
  -v hermes-data:/data \
  ghcr.io/d31ma/hermes:latest
```

A `docker-compose.yml` is provided in the repo for local development with LocalStack (AWS emulator). Use it as a reference for multi-service setups.

### AWS ECS Fargate

ECS runs the HERMES container on managed compute. You need an ECS cluster, a task definition, and a service.

**Task definition** (minimum):

```json
{
  "family": "hermes",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<account>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "hermes",
      "image": "ghcr.io/d31ma/hermes:latest",
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
          "awslogs-group": "/ecs/hermes",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "hermes"
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
      "name": "hermes-data",
      "efsVolumeConfiguration": {
        "filesystemId": "fs-...",
        "rootDirectory": "/"
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "hermes",
      "mountPoints": [
        { "sourceVolume": "hermes-data", "containerPath": "/data" }
      ]
    }
  ]
}
```

### Azure Container Apps

Container Apps runs HERMES as a managed container with automatic HTTPS, scaling, and revision management.

1. Push the image to Azure Container Registry (or reference `ghcr.io/d31ma/hermes` directly).
2. Create a Container App with:
   - **Container image**: `ghcr.io/d31ma/hermes:latest`
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
      - name: hermes-data
        storageType: AzureFile
        storageName: hermesdatastorage
    containers:
      - volumeMounts:
          - volumeName: hermes-data
            mountPath: /data
```

5. **Scaling** — Container Apps scales HTTP workloads by request count. Minimum replicas of 0 scales to zero when idle (cold start ~1 s). Set minimum to 1 for always-warm.

### Google Cloud Run

Cloud Run runs the HERMES container with fully-managed infrastructure, automatic HTTPS certificates, and scale-to-zero.

```sh
gcloud run deploy hermes \
  --image ghcr.io/d31ma/hermes:latest \
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

The standalone binary bundles Bun's runtime, Tachyon, and HERMES into a single executable. It runs on any Linux or macOS host with no dependencies.

Build it:

```sh
# For the current platform
bun run compile

# Cross-compile for Linux x86-64
bun run compile -- --target linux-amd64

# Cross-compile for Linux ARM64 (Graviton, Ampere)
bun run compile -- --target linux-arm64
```

Output: `hermes-<target>` (e.g. `hermes-linux-amd64`).

The binary accepts the same commands as the Docker entrypoint:

```sh
./hermes-linux-amd64 serve           # Start the server
./hermes-linux-amd64 admin:create --email=... --phone=... --domain=...
./hermes-linux-amd64 domain:migrate --from=... --to=... [--apply]
./hermes-linux-amd64 help
```

### AWS EC2 / Lightsail

Launch an instance (Amazon Linux 2023, Ubuntu, or Debian), copy the binary, and run it with a systemd unit:

```ini
# /etc/systemd/system/hermes.service
[Unit]
Description=HERMES mail server
After=network.target

[Service]
Type=simple
User=hermes
Group=hermes
WorkingDirectory=/opt/hermes
EnvironmentFile=/opt/hermes/.env
ExecStart=/opt/hermes/hermes-linux-amd64 serve
Restart=always
RestartSec=5

[Service]
# Hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/data /opt/hermes
```

Create the user, directories, and enable:

```sh
sudo useradd --system --create-home hermes
sudo mkdir -p /data /data/attachments /opt/hermes
sudo chown hermes:hermes /data /data/attachments /opt/hermes
cp hermes-linux-amd64 /opt/hermes/
# Create /opt/hermes/.env with required secrets
sudo systemctl daemon-reload
sudo systemctl enable --now hermes
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
sudo chown hermes:hermes /data /data/attachments
```

### GCP Compute Engine

Launch a VM, copy the binary, and set up systemd as above. For persistence, attach a persistent SSD:

```sh
gcloud compute instances create hermes-vm \
  --machine-type e2-small \
  --boot-disk-size 20GB \
  --create-disk name=hermes-data,size=50GB,type=pd-ssd \
  --zone us-central1-a
```

After attaching, format and mount at `/data`. Use a regional HTTP(S) load balancer in front for TLS termination.

## Serverless — AWS Lambda

HERMES ships a Lambda handler (`scripts/lambda.mjs`) that starts an internal HTTP server and proxies Lambda invocations to it. Deploy as a custom runtime on Amazon Linux 2023.

### Build the Lambda binary

```sh
bun run compile:lambda
# Output: hermes-lambda (Linux ARM64 binary)
```

### Package and deploy

```sh
# Create a bootstrap wrapper
cat > bootstrap << 'EOF'
#!/bin/sh
./hermes-lambda
EOF
chmod +x bootstrap

# Package as a ZIP
zip hermes-lambda.zip bootstrap hermes-lambda
```

### Create the Lambda function

```sh
aws lambda create-function \
  --function-name hermes \
  --runtime provided.al2023 \
  --role arn:aws:iam::<account>:role/lambda-hermes-role \
  --handler bootstrap \
  --architectures arm64 \
  --timeout 30 \
  --memory-size 512 \
  --environment "Variables={FYLO_ROOT=/tmp/data,ATTACHMENT_ROOT=/tmp/attachments,JWT_SECRET=...,INBOUND_WEBHOOK_SECRET=...,SMS_ADAPTER=aws,SMTP_ADAPTER=aws,AWS_REGION=us-east-1}" \
  --zip-file fileb://hermes-lambda.zip
```

### Lambda Function URL (simplest)

Enable a Function URL to invoke HERMES directly over HTTPS without API Gateway:

```sh
aws lambda create-function-url-config \
  --function-name hermes \
  --auth-type NONE \
  --invoke-mode BUFFERED
```

The Function URL is printed in the response. All HTTP methods and paths are forwarded to HERMES.

**With auth**: set `--auth-type AWS_IAM` and use IAM authentication for admin endpoints. For a public-facing setup, place CloudFront in front of the Function URL to add WAF, caching, and a custom domain.

### API Gateway HTTP API (recommended for custom domains)

Create an HTTP API that proxies all routes to the Lambda:

```sh
# Create the API
API_ID=$(aws apigatewayv2 create-api \
  --name hermes-api \
  --protocol-type HTTP \
  --target "arn:aws:lambda:us-east-1:<account>:function:hermes" \
  --query 'ApiId' --output text)

# Add a catch-all route
aws apigatewayv2 create-route \
  --api-id $API_ID \
  --route-key '$default'

# Grant API Gateway permission to invoke Lambda
aws lambda add-permission \
  --function-name hermes \
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
  --function-name hermes \
  --file-system-configs "Arn=arn:aws:elasticfilesystem:us-east-1:<account>:access-point/fsap-...,LocalMountPath=/data"
```

Then set `FYLO_ROOT=/data` and `ATTACHMENT_ROOT=/data/attachments`. With EFS, data survives cold starts and is shared across concurrent Lambda instances.

## Serverless — Azure Functions / GCP Cloud Functions

Azure Functions and Google Cloud Functions are not directly compatible with the standalone Bun binary model. Instead, use the container-based serverless offerings that provide the same scale-to-zero behavior:

| If you want | Use |
|---|---|
| Azure serverless | **Azure Container Apps** with min replicas = 0 |
| GCP serverless | **Cloud Run** with min instances = 0 |

Both accept the standard HERMES Docker image, provide automatic HTTPS, scale to zero, and charge per-request. The deployment steps are the same as the container sections above — just set minimum instances to 0.

## Storage and data persistence

HERMES uses Fylo, a file-backed database. Every piece of state — domains, users, emails, MFA devices, push subscriptions — is a JSON file under `FYLO_ROOT`. Attachments are stored as raw files under `ATTACHMENT_ROOT`.

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

For most HERMES deployments, a single instance with regular backups is sufficient. The server handles thousands of emails per hour on modest hardware.

### Backups

Back up `FYLO_ROOT` and `ATTACHMENT_ROOT` regularly. With Fylo's file-backed model you can use any file-level backup tool:

```sh
# AWS S3
aws s3 sync /data s3://hermes-backups/data-$(date +%Y%m%d)/

# Azure Blob
az storage blob upload-batch -d hermes-backups -s /data

# GCP Cloud Storage
gsutil -m rsync -r /data gs://hermes-backups/data-$(date +%Y%m%d)/
```

Schedule these as cron jobs or cloud-native scheduled tasks (EventBridge Scheduler, Azure Logic Apps, Cloud Scheduler).

## Adapter configuration

HERMES talks to cloud SMS and email providers through adapters. The adapter is selected by environment variable.

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

HERMES exposes two endpoints for health monitoring:

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

HERMES is multi-domain from the start. After the first admin is created:

1. The admin logs into the web UI and navigates to Settings → Domains.
2. Add a new domain with routing rules (match pattern → action).
3. Create users scoped to that domain.
4. Update DNS MX records to point inbound mail at HERMES's inbound webhook endpoint.

For programmatic bootstrap on a fresh deployment:

```sh
# Docker
docker run --rm -v hermes-data:/data ghcr.io/d31ma/hermes:latest \
  admin:create --email=admin@example.com --phone=+14165550100 --domain=example.com

# Standalone binary
./hermes-linux-amd64 admin:create \
  --email=admin@example.com --phone=+14165550100 --domain=example.com
```

The admin bootstrap command creates the domain with a default `*@example.com` → store route and creates the admin user. Repeat for each domain, or use the web UI after the first admin exists.

## Web Push notifications

HERMES can push new-mail notifications to installed PWA clients. To enable in production:

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

HERMES supports Google, Microsoft, and Apple sign-in. Configure the providers you want to enable:

```
OAUTH_REDIRECT_URI=https://hermes.example.com/auth/oauth/callback
OAUTH_GOOGLE_CLIENT_ID=...
OAUTH_GOOGLE_CLIENT_SECRET=...
OAUTH_MICROSOFT_CLIENT_ID=...
OAUTH_MICROSOFT_CLIENT_SECRET=...
OAUTH_APPLE_CLIENT_ID=...
OAUTH_APPLE_CLIENT_SECRET=...
```

The redirect URI must be the public URL of your HERMES instance with the path `/auth/oauth/callback`. Register this exact URI in each provider's developer console.

If no OAuth providers are configured, the login screen falls back to email + passkey authentication without showing provider buttons.

## Infrastructure as Code

The examples below use placeholders (e.g. `<account-id>`, `<region>`, `<jwt-secret>`) — replace them with actual values or references to your secrets manager. Each section shows the recommended deployment model for that provider: Fargate on AWS, Container Apps on Azure, and Cloud Run on GCP. VM and serverless variants are also included.

### Terraform — AWS ECS Fargate

```hcl
# main.tf
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = "<region>"
}

# ── Networking ─────────────────────────────────────────────────────────────

data "aws_vpc" "default" { default = true }
data "aws_subnets" "public" {
  filter { name = "vpc-id", values = [data.aws_vpc.default.id] }
}

resource "aws_security_group" "hermes" {
  name        = "hermes-sg"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── EFS for durable storage ────────────────────────────────────────────────

resource "aws_efs_file_system" "hermes" {
  creation_token = "hermes-data"
  encrypted      = true
}

resource "aws_efs_mount_target" "hermes" {
  for_each        = toset(data.aws_subnets.public.ids)
  file_system_id  = aws_efs_file_system.hermes.id
  subnet_id       = each.value
  security_groups = [aws_security_group.hermes.id]
}

# ── ECS ────────────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "hermes" {
  name = "hermes-cluster"
}

resource "aws_ecs_task_definition" "hermes" {
  family                   = "hermes"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.hermes_task.arn

  container_definitions = jsonencode([{
    name   = "hermes"
    image  = "ghcr.io/d31ma/hermes:latest"
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    environment = [
      { name = "FYLO_ROOT",       value = "/data" },
      { name = "ATTACHMENT_ROOT", value = "/data/attachments" },
      { name = "SMS_ADAPTER",     value = "aws" },
      { name = "SMTP_ADAPTER",    value = "aws" },
      { name = "AWS_REGION",      value = "<region>" }
    ]
    secrets = [
      { name = "JWT_SECRET",               valueFrom = aws_secretsmanager_secret.jwt.arn },
      { name = "INBOUND_WEBHOOK_SECRET",   valueFrom = aws_secretsmanager_secret.inbound.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = "/ecs/hermes"
        awslogs-region        = "<region>"
        awslogs-stream-prefix = "hermes"
      }
    }
    mountPoints = [{
      sourceVolume  = "hermes-data"
      containerPath = "/data"
    }]
  }])

  volume {
    name = "hermes-data"
    efs_volume_configuration {
      file_system_id = aws_efs_file_system.hermes.id
    }
  }
}

resource "aws_ecs_service" "hermes" {
  name            = "hermes-service"
  cluster         = aws_ecs_cluster.hermes.id
  task_definition = aws_ecs_task_definition.hermes.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.public.ids
    security_groups  = [aws_security_group.hermes.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.hermes.arn
    container_name   = "hermes"
    container_port   = 8080
  }
}

# ── Load Balancer ──────────────────────────────────────────────────────────

resource "aws_lb" "hermes" {
  name               = "hermes-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.hermes.id]
  subnets            = data.aws_subnets.public.ids
}

resource "aws_lb_target_group" "hermes" {
  name        = "hermes-tg"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"
  health_check {
    path = "/health"
    port = "8080"
  }
}

resource "aws_lb_listener" "hermes" {
  load_balancer_arn = aws_lb.hermes.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = "<certificate-arn>"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.hermes.arn
  }
}

# ── Secrets ────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "jwt" {
  name = "hermes-jwt-secret"
}
resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = "<jwt-secret>"
}

resource "aws_secretsmanager_secret" "inbound" {
  name = "hermes-inbound-secret"
}
resource "aws_secretsmanager_secret_version" "inbound" {
  secret_id     = aws_secretsmanager_secret.inbound.id
  secret_string = "<inbound-webhook-secret>"
}

# ── IAM ────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "hermes-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}
resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy_attachment" "ecs_secrets" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/SecretsManagerReadWrite"
}

resource "aws_iam_role" "hermes_task" {
  name = "hermes-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}
resource "aws_iam_role_policy" "hermes_sns_ses" {
  name = "hermes-sns-ses"
  role = aws_iam_role.hermes_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sns:Publish", "ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*"
    }]
  })
}
```

### Terraform — AWS Lambda

```hcl
# Lambda function with Function URL + EFS for durable storage

resource "aws_lambda_function" "hermes" {
  function_name = "hermes"
  role          = aws_iam_role.lambda_hermes.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 512

  filename         = "hermes-lambda.zip"
  source_code_hash = filebase64sha256("hermes-lambda.zip")

  environment {
    variables = {
      FYLO_ROOT                = "/data"
      ATTACHMENT_ROOT          = "/data/attachments"
      SMS_ADAPTER              = "aws"
      SMTP_ADAPTER             = "aws"
      JWT_SECRET               = "<jwt-secret>"
      INBOUND_WEBHOOK_SECRET   = "<inbound-secret>"
    }
  }

  file_system_config {
    arn              = aws_efs_access_point.hermes.arn
    local_mount_path = "/data"
  }

  vpc_config {
    subnet_ids         = data.aws_subnets.public.ids
    security_group_ids = [aws_security_group.hermes.id]
  }
}

resource "aws_efs_access_point" "hermes" {
  file_system_id = aws_efs_file_system.hermes.id
  posix_user {
    uid = 65532
    gid = 65532
  }
  root_directory {
    path = "/hermes"
    creation_info {
      owner_uid   = 65532
      owner_gid   = 65532
      permissions = "755"
    }
  }
}

resource "aws_lambda_function_url" "hermes" {
  function_name      = aws_lambda_function.hermes.function_name
  authorization_type = "NONE"
  invoke_mode        = "BUFFERED"
}

resource "aws_iam_role" "lambda_hermes" {
  name = "lambda-hermes"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_hermes.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda_hermes.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}
resource "aws_iam_role_policy_attachment" "lambda_efs" {
  role       = aws_iam_role.lambda_hermes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonElasticFileSystemClientReadWriteAccess"
}
```

### Terraform — Azure Container Apps

```hcl
# main.tf
terraform {
  required_version = ">= 1.5"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
  }
}

provider "azurerm" {
  features {}
  subscription_id = "<subscription-id>"
}

# ── Resource Group ─────────────────────────────────────────────────────────

resource "azurerm_resource_group" "hermes" {
  name     = "hermes-rg"
  location = "<location>"
}

# ── Container Registry (optional — use ghcr.io directly) ───────────────────

resource "azurerm_container_app_environment" "hermes" {
  name                = "hermes-env"
  resource_group_name = azurerm_resource_group.hermes.name
  location            = azurerm_resource_group.hermes.location
}

resource "azurerm_storage_account" "hermes" {
  name                     = "hermesdata<random-suffix>"
  resource_group_name      = azurerm_resource_group.hermes.name
  location                 = azurerm_resource_group.hermes.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_share" "hermes" {
  name                 = "hermes-data"
  storage_account_name = azurerm_storage_share.hermes.name
  quota                = 50
}

resource "azurerm_container_app" "hermes" {
  name                         = "hermes"
  resource_group_name          = azurerm_resource_group.hermes.name
  container_app_environment_id = azurerm_container_app_environment.hermes.id
  revision_mode                = "Single"

  template {
    container {
      name   = "hermes"
      image  = "ghcr.io/d31ma/hermes:latest"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "FYLO_ROOT"
        value = "/data"
      }
      env {
        name  = "ATTACHMENT_ROOT"
        value = "/data/attachments"
      }
      env {
        name  = "SMS_ADAPTER"
        value = "azure"
      }
      env {
        name  = "SMTP_ADAPTER"
        value = "azure"
      }
      env {
        name        = "AZURE_COMMUNICATION_ENDPOINT"
        secret_name = "azure-comm-endpoint"
      }
      env {
        name        = "AZURE_COMMUNICATION_KEY"
        secret_name = "azure-comm-key"
      }
      env {
        name        = "JWT_SECRET"
        secret_name = "jwt-secret"
      }
      env {
        name        = "INBOUND_WEBHOOK_SECRET"
        secret_name = "inbound-secret"
      }

      volume_mounts {
        name = "hermes-data"
        path = "/data"
      }
    }

    volume {
      name         = "hermes-data"
      storage_type = "AzureFile"
      storage_name = "hermes-data-volume"
      azure_file_parameters {
        account_name  = azurerm_storage_account.hermes.name
        account_key   = azurerm_storage_account.hermes.primary_access_key
        share_name    = azurerm_storage_share.hermes.name
      }
    }
  }

  ingress {
    target_port      = 8080
    external_enabled = true
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  secret {
    name  = "jwt-secret"
    value = "<jwt-secret>"
  }
  secret {
    name  = "inbound-secret"
    value = "<inbound-webhook-secret>"
  }
  secret {
    name  = "azure-comm-endpoint"
    value = "https://<resource>.communication.azure.com"
  }
  secret {
    name  = "azure-comm-key"
    value = "<azure-communication-key>"
  }
}
```

### Terraform — Google Cloud Run

```hcl
# main.tf
terraform {
  required_version = ">= 1.5"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
}

provider "google" {
  project = "<project-id>"
  region  = "<region>"
}

# ── Secrets ────────────────────────────────────────────────────────────────

resource "google_secret_manager_secret" "jwt" {
  secret_id = "hermes-jwt-secret"
  replication { auto {} }
}
resource "google_secret_manager_secret_version" "jwt" {
  secret      = google_secret_manager_secret.jwt.id
  secret_data = "<jwt-secret>"
}

resource "google_secret_manager_secret" "inbound" {
  secret_id = "hermes-inbound-secret"
  replication { auto {} }
}
resource "google_secret_manager_secret_version" "inbound" {
  secret      = google_secret_manager_secret.inbound.id
  secret_data = "<inbound-webhook-secret>"
}

# Grant Cloud Run service account access to secrets
data "google_project" "project" {}
resource "google_secret_manager_secret_iam_member" "jwt_access" {
  secret_id = google_secret_manager_secret.jwt.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}
resource "google_secret_manager_secret_iam_member" "inbound_access" {
  secret_id = google_secret_manager_secret.inbound.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

# ── GCS Bucket for Fylo data ───────────────────────────────────────────────

resource "google_storage_bucket" "hermes_data" {
  name     = "hermes-data-<project-id>"
  location = "<region>"
}

# ── Cloud Run ──────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "hermes" {
  name     = "hermes"
  location = "<region>"
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "ghcr.io/d31ma/hermes:latest"
      ports { container_port = 8080 }

      env {
        name  = "FYLO_ROOT"
        value = "/data"
      }
      env {
        name  = "ATTACHMENT_ROOT"
        value = "/data/attachments"
      }
      env {
        name  = "SMS_ADAPTER"
        value = "gcp"
      }
      env {
        name  = "SMTP_ADAPTER"
        value = "gcp"
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "INBOUND_WEBHOOK_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.inbound.secret_id
            version = "latest"
          }
        }
      }

      resources {
        cpu_idle = true        # allow scale-to-zero
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
      }

      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 3
      }
      liveness_probe {
        http_get { path = "/health" }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 1  # single instance for Fylo
    }
  }
}

# Allow unauthenticated access (public mail server)
resource "google_cloud_run_service_iam_member" "public" {
  location = google_cloud_run_v2_service.hermes.location
  project  = google_cloud_run_v2_service.hermes.project
  service  = google_cloud_run_v2_service.hermes.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
```

### Terraform — AWS EC2 (standalone binary)

```hcl
# EC2 instance running the compiled HERMES binary

data "aws_ami" "amazon_linux" {
  most_recent = true
  filter {
    name   = "name"
    values = ["al2023-ami-2023*-arm64"]
  }
  owners = ["amazon"]
}

resource "aws_instance" "hermes" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = "t4g.small"
  vpc_security_group_ids = [aws_security_group.hermes.id]
  iam_instance_profile   = aws_iam_instance_profile.hermes.name
  user_data = <<-EOF
    #!/bin/bash
    mkdir -p /opt/hermes /data /data/attachments
    useradd --system --create-home hermes
    chown -R hermes:hermes /data /data/attachments /opt/hermes

    # Upload the binary via S3 or direct copy
    aws s3 cp s3://<deploy-bucket>/hermes-linux-arm64 /opt/hermes/hermes
    chmod +x /opt/hermes/hermes

    cat > /etc/systemd/system/hermes.service << 'UNIT'
    [Unit]
    Description=HERMES mail server
    After=network.target
    [Service]
    Type=simple
    User=hermes
    WorkingDirectory=/opt/hermes
    Environment="FYLO_ROOT=/data"
    Environment="ATTACHMENT_ROOT=/data/attachments"
    Environment="SMS_ADAPTER=aws"
    Environment="SMTP_ADAPTER=aws"
    EnvironmentFile=/opt/hermes/.env
    ExecStart=/opt/hermes/hermes serve
    Restart=always
    RestartSec=5
    NoNewPrivileges=yes
    ProtectSystem=strict
    ProtectHome=yes
    ReadWritePaths=/data /opt/hermes
    UNIT

    systemctl daemon-reload
    systemctl enable --now hermes
  EOF

  root_block_device {
    volume_size = 20
    encrypted   = true
  }
}

resource "aws_ebs_volume" "hermes_data" {
  availability_zone = aws_instance.hermes.availability_zone
  size              = 50
  encrypted         = true
  type              = "gp3"
}

resource "aws_volume_attachment" "hermes_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.hermes_data.id
  instance_id = aws_instance.hermes.id
}

resource "aws_iam_role" "ec2_hermes" {
  name = "ec2-hermes"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}
resource "aws_iam_role_policy" "ec2_sns_ses" {
  name = "hermes-sns-ses"
  role = aws_iam_role.ec2_hermes.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["sns:Publish", "ses:SendEmail", "ses:SendRawEmail"], Resource = "*" },
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = "arn:aws:s3:::<deploy-bucket>/*" }
    ]
  })
}
resource "aws_iam_instance_profile" "hermes" {
  name = "hermes-instance-profile"
  role = aws_iam_role.ec2_hermes.name
}
```

---

### Pulumi — AWS ECS Fargate

```ts
import * as aws from "@pulumi/aws";

// ── Networking ────────────────────────────────────────────────────────────

const vpc = aws.ec2.getVpc({ default: true });
const subnets = aws.ec2.getSubnets({
  filters: [{ name: "vpc-id", values: [vpc.then(v => v.id)] }],
});

const sg = new aws.ec2.SecurityGroup("hermes-sg", {
  vpcId: vpc.then(v => v.id),
  ingress: [{
    fromPort: 8080, toPort: 8080, protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
  }],
  egress: [{
    fromPort: 0, toPort: 0, protocol: "-1",
    cidrBlocks: ["0.0.0.0/0"],
  }],
});

// ── EFS ───────────────────────────────────────────────────────────────────

const efs = new aws.efs.FileSystem("hermes-data", {
  creationToken: "hermes-data",
  encrypted: true,
});

subnets.then(s => s.ids.map((subnetId, i) =>
  new aws.efs.MountTarget(`hermes-mt-${i}`, {
    fileSystemId: efs.id,
    subnetId,
    securityGroups: [sg.id],
  })
));

// ── Secrets ───────────────────────────────────────────────────────────────

const jwtSecret = new aws.secretsmanager.Secret("hermes-jwt", {});
new aws.secretsmanager.SecretVersion("hermes-jwt-v", {
  secretId: jwtSecret.id,
  secretString: "<jwt-secret>",
});

const inboundSecret = new aws.secretsmanager.Secret("hermes-inbound", {});
new aws.secretsmanager.SecretVersion("hermes-inbound-v", {
  secretId: inboundSecret.id,
  secretString: "<inbound-webhook-secret>",
});

// ── IAM ───────────────────────────────────────────────────────────────────

const execRole = new aws.iam.Role("hermes-exec", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "ecs-tasks.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  }),
});
new aws.iam.RolePolicyAttachment("hermes-exec-policy", {
  role: execRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

const taskRole = new aws.iam.Role("hermes-task", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "ecs-tasks.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  }),
});
new aws.iam.RolePolicy("hermes-sns-ses", {
  role: taskRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Action: ["sns:Publish", "ses:SendEmail", "ses:SendRawEmail"],
      Resource: "*",
    }],
  }),
});

// ── ECS Cluster + Service ─────────────────────────────────────────────────

const cluster = new aws.ecs.Cluster("hermes-cluster", {});

const taskDef = new aws.ecs.TaskDefinition("hermes-task", {
  family: "hermes",
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "512",
  memory: "1024",
  executionRoleArn: execRole.arn,
  taskRoleArn: taskRole.arn,
  containerDefinitions: JSON.stringify([{
    name: "hermes",
    image: "ghcr.io/d31ma/hermes:latest",
    portMappings: [{ containerPort: 8080 }],
    environment: [
      { name: "FYLO_ROOT", value: "/data" },
      { name: "ATTACHMENT_ROOT", value: "/data/attachments" },
      { name: "SMS_ADAPTER", value: "aws" },
      { name: "SMTP_ADAPTER", value: "aws" },
      { name: "AWS_REGION", value: "<region>" },
    ],
    secrets: [
      { name: "JWT_SECRET", valueFrom: jwtSecret.arn },
      { name: "INBOUND_WEBHOOK_SECRET", valueFrom: inboundSecret.arn },
    ],
    logConfiguration: {
      logDriver: "awslogs",
      options: {
        "awslogs-group": "/ecs/hermes",
        "awslogs-region": "<region>",
        "awslogs-stream-prefix": "hermes",
      },
    },
    mountPoints: [{
      sourceVolume: "hermes-data",
      containerPath: "/data",
    }],
  }]),
  volumes: [{
    name: "hermes-data",
    efsVolumeConfiguration: { fileSystemId: efs.id },
  }],
});

// ── Load Balancer ─────────────────────────────────────────────────────────

const lb = new aws.lb.LoadBalancer("hermes-alb", {
  internal: false,
  loadBalancerType: "application",
  securityGroups: [sg.id],
  subnets: subnets.then(s => s.ids),
});

const tg = new aws.lb.TargetGroup("hermes-tg", {
  port: 8080,
  protocol: "HTTP",
  targetType: "ip",
  vpcId: vpc.then(v => v.id),
  healthCheck: { path: "/health", port: "8080" },
});

new aws.lb.Listener("hermes-listener", {
  loadBalancerArn: lb.arn,
  port: 443,
  protocol: "HTTPS",
  certificateArn: "<certificate-arn>",
  defaultActions: [{ type: "forward", targetGroupArn: tg.arn }],
});

new aws.ecs.Service("hermes-svc", {
  cluster: cluster.id,
  taskDefinition: taskDef.arn,
  desiredCount: 1,
  launchType: "FARGATE",
  networkConfiguration: {
    subnets: subnets.then(s => s.ids),
    securityGroups: [sg.id],
    assignPublicIp: true,
  },
  loadBalancers: [{
    targetGroupArn: tg.arn,
    containerName: "hermes",
    containerPort: 8080,
  }],
});
```

### Pulumi — AWS Lambda

```ts
import * as aws from "@pulumi/aws";

// ── EFS ───────────────────────────────────────────────────────────────────

const vpc = aws.ec2.getVpc({ default: true });
const subnets = aws.ec2.getSubnets({
  filters: [{ name: "vpc-id", values: [vpc.then(v => v.id)] }],
});

const sg = new aws.ec2.SecurityGroup("hermes-lambda-sg", {
  vpcId: vpc.then(v => v.id),
  egress: [{ fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] }],
});

const efs = new aws.efs.FileSystem("hermes-data", { encrypted: true });

subnets.then(s => s.ids.map((sid, i) =>
  new aws.efs.MountTarget(`hermes-mt-${i}`, {
    fileSystemId: efs.id,
    subnetId: sid,
    securityGroups: [sg.id],
  })
));

const accessPoint = new aws.efs.AccessPoint("hermes-ap", {
  fileSystemId: efs.id,
  posixUser: { uid: 65532, gid: 65532 },
  rootDirectory: {
    path: "/hermes",
    creationInfo: { ownerUid: 65532, ownerGid: 65532, permissions: "755" },
  },
});

// ── IAM ───────────────────────────────────────────────────────────────────

const role = new aws.iam.Role("lambda-hermes", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  }),
});
for (const arn of [
  "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
  "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
  "arn:aws:iam::aws:policy/AmazonElasticFileSystemClientReadWriteAccess",
]) {
  new aws.iam.RolePolicyAttachment(`hermes-${arn.split("/").pop()}`, {
    role: role.name,
    policyArn: arn,
  });
}

// ── Lambda ────────────────────────────────────────────────────────────────

const fn = new aws.lambda.Function("hermes", {
  name: "hermes",
  role: role.arn,
  handler: "bootstrap",
  runtime: "provided.al2023",
  architectures: ["arm64"],
  timeout: 30,
  memorySize: 512,
  code: new pulumi.asset.FileArchive("hermes-lambda.zip"),
  environment: {
    variables: {
      FYLO_ROOT: "/data",
      ATTACHMENT_ROOT: "/data/attachments",
      SMS_ADAPTER: "aws",
      SMTP_ADAPTER: "aws",
      JWT_SECRET: "<jwt-secret>",
      INBOUND_WEBHOOK_SECRET: "<inbound-secret>",
    },
  },
  fileSystemConfig: {
    arn: accessPoint.arn,
    localMountPath: "/data",
  },
  vpcConfig: {
    subnetIds: subnets.then(s => s.ids),
    securityGroupIds: [sg.id],
  },
});

const fnUrl = new aws.lambda.FunctionUrl("hermes-url", {
  functionName: fn.name,
  authorizationType: "NONE",
  invokeMode: "BUFFERED",
});

export const url = fnUrl.functionUrl;
```

### Pulumi — Azure Container Apps

```ts
import * as resources from "@pulumi/azure-native/resources";
import * as app from "@pulumi/azure-native/app";
import * as storage from "@pulumi/azure-native/storage";

const rg = new resources.ResourceGroup("hermes-rg", {
  resourceGroupName: "hermes-rg",
  location: "<location>",
});

const env = new app.ManagedEnvironment("hermes-env", {
  resourceGroupName: rg.name,
  location: rg.location,
});

const storageAccount = new storage.StorageAccount("hermesdata", {
  resourceGroupName: rg.name,
  location: rg.location,
  kind: "StorageV2",
  sku: { name: "Standard_LRS" },
});

const share = new storage.FileShare("hermes-data", {
  accountName: storageAccount.name,
  resourceGroupName: rg.name,
  shareQuota: 50,
});

const keys = storage.listStorageAccountKeysOutput({
  accountName: storageAccount.name,
  resourceGroupName: rg.name,
});

const app = new app.ContainerApp("hermes", {
  resourceGroupName: rg.name,
  environmentId: env.id,
  configuration: {
    ingress: {
      external: true,
      targetPort: 8080,
    },
    secrets: [
      { name: "jwt-secret", value: "<jwt-secret>" },
      { name: "inbound-secret", value: "<inbound-webhook-secret>" },
      { name: "azure-comm-key", value: "<azure-communication-key>" },
    ],
  },
  template: {
    containers: [{
      name: "hermes",
      image: "ghcr.io/d31ma/hermes:latest",
      resources: { cpu: 0.5, memory: "1Gi" },
      env: [
        { name: "FYLO_ROOT", value: "/data" },
        { name: "ATTACHMENT_ROOT", value: "/data/attachments" },
        { name: "SMS_ADAPTER", value: "azure" },
        { name: "SMTP_ADAPTER", value: "azure" },
        { name: "AZURE_COMMUNICATION_ENDPOINT", value: "https://<resource>.communication.azure.com" },
        { name: "AZURE_COMMUNICATION_KEY", secretRef: "azure-comm-key" },
        { name: "JWT_SECRET", secretRef: "jwt-secret" },
        { name: "INBOUND_WEBHOOK_SECRET", secretRef: "inbound-secret" },
      ],
      volumeMounts: [{ volumeName: "hermes-data", mountPath: "/data" }],
    }],
    volumes: [{
      name: "hermes-data",
      storageType: "AzureFile",
      storageName: "hermes-data-volume",
      azureFile: {
        accountName: storageAccount.name,
        accountKey: keys.apply(k => k.keys[0].value),
        shareName: share.name,
      },
    }],
  },
});
```

### Pulumi — Google Cloud Run

```ts
import * as gcp from "@pulumi/gcp";

// ── Secrets ───────────────────────────────────────────────────────────────

const jwtSecret = new gcp.secretmanager.Secret("hermes-jwt", {
  secretId: "hermes-jwt-secret",
  replication: { auto: {} },
});
new gcp.secretmanager.SecretVersion("hermes-jwt-v", {
  secret: jwtSecret.id,
  secretData: "<jwt-secret>",
});

const inboundSecret = new gcp.secretmanager.Secret("hermes-inbound", {
  secretId: "hermes-inbound-secret",
  replication: { auto: {} },
});
new gcp.secretmanager.SecretVersion("hermes-inbound-v", {
  secret: inboundSecret.id,
  secretData: "<inbound-webhook-secret>",
});

// Grant Cloud Run access to secrets
const project = gcp.organizations.getProject({});
const member = project.then(p =>
  `serviceAccount:${p.number}-compute@developer.gserviceaccount.com`
);

member.then(m => {
  new gcp.secretmanager.SecretIamMember("jwt-access", {
    secretId: jwtSecret.id,
    role: "roles/secretmanager.secretAccessor",
    member: m,
  });
  new gcp.secretmanager.SecretIamMember("inbound-access", {
    secretId: inboundSecret.id,
    role: "roles/secretmanager.secretAccessor",
    member: m,
  });
});

// ── Cloud Run Service ─────────────────────────────────────────────────────

const service = new gcp.cloudrunv2.Service("hermes", {
  name: "hermes",
  location: "<region>",
  ingress: "INGRESS_TRAFFIC_ALL",
  template: {
    containers: [{
      image: "ghcr.io/d31ma/hermes:latest",
      ports: [{ containerPort: 8080 }],
      envs: [
        { name: "FYLO_ROOT", value: "/data" },
        { name: "ATTACHMENT_ROOT", value: "/data/attachments" },
        { name: "SMS_ADAPTER", value: "gcp" },
        { name: "SMTP_ADAPTER", value: "gcp" },
        {
          name: "JWT_SECRET",
          valueSource: {
            secretKeyRef: {
              secret: jwtSecret.secretId,
              version: "latest",
            },
          },
        },
        {
          name: "INBOUND_WEBHOOK_SECRET",
          valueSource: {
            secretKeyRef: {
              secret: inboundSecret.secretId,
              version: "latest",
            },
          },
        },
      ],
      resources: {
        cpuIdle: true,
        limits: { cpu: "1000m", memory: "512Mi" },
      },
      startupProbe: {
        httpGet: { path: "/health" },
        initialDelaySeconds: 3,
      },
      livenessProbe: {
        httpGet: { path: "/health" },
      },
    }],
    scaling: {
      minInstanceCount: 0,
      maxInstanceCount: 1,
    },
  },
});

// Allow unauthenticated access
new gcp.cloudrunv2.ServiceIamMember("hermes-public", {
  name: service.name,
  location: service.location,
  role: "roles/run.invoker",
  member: "allUsers",
});

export const url = service.uri;
```

### Pulumi — AWS EC2 (standalone binary)

```ts
import * as aws from "@pulumi/aws";

// ── AMI ───────────────────────────────────────────────────────────────────

const ami = aws.ec2.getAmi({
  mostRecent: true,
  filters: [{ name: "name", values: ["al2023-ami-2023*-arm64"] }],
  owners: ["amazon"],
});

// ── SG ────────────────────────────────────────────────────────────────────

const sg = new aws.ec2.SecurityGroup("hermes-sg", {
  ingress: [
    { fromPort: 22, toPort: 22, protocol: "tcp", cidrBlocks: ["<admin-cidr>"] },
    { fromPort: 8080, toPort: 8080, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] },
  ],
  egress: [{ fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] }],
});

// ── IAM ───────────────────────────────────────────────────────────────────

const role = new aws.iam.Role("ec2-hermes", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "ec2.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  }),
});
new aws.iam.RolePolicy("hermes-policy", {
  role: role.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["sns:Publish", "ses:SendEmail", "ses:SendRawEmail"], Resource: "*" },
      { Effect: "Allow", Action: ["s3:GetObject"], Resource: "arn:aws:s3:::<deploy-bucket>/*" },
    ],
  }),
});
const profile = new aws.iam.InstanceProfile("hermes-profile", { role: role.name });

// ── EC2 ───────────────────────────────────────────────────────────────────

const instance = new aws.ec2.Instance("hermes", {
  ami: ami.then(a => a.id),
  instanceType: "t4g.small",
  vpcSecurityGroupIds: [sg.id],
  iamInstanceProfile: profile.name,
  rootBlockDevice: { volumeSize: 20, encrypted: true },
  userData: ami.then(a => `#!/bin/bash
    mkdir -p /opt/hermes /data /data/attachments
    useradd --system --create-home hermes
    chown -R hermes:hermes /data /data/attachments /opt/hermes
    aws s3 cp s3://<deploy-bucket>/hermes-linux-arm64 /opt/hermes/hermes
    chmod +x /opt/hermes/hermes
    cat > /etc/systemd/system/hermes.service << 'UNIT'
    [Unit]
    Description=HERMES mail server
    After=network.target
    [Service]
    Type=simple
    User=hermes
    WorkingDirectory=/opt/hermes
    Environment="FYLO_ROOT=/data"
    Environment="ATTACHMENT_ROOT=/data/attachments"
    Environment="SMS_ADAPTER=aws"
    Environment="SMTP_ADAPTER=aws"
    EnvironmentFile=/opt/hermes/.env
    ExecStart=/opt/hermes/hermes serve
    Restart=always
    RestartSec=5
    NoNewPrivileges=yes
    ProtectSystem=strict
    ReadWritePaths=/data /opt/hermes
    UNIT
    systemctl daemon-reload
    systemctl enable --now hermes
  `),
});

const dataVolume = new aws.ebs.Volume("hermes-data", {
  availabilityZone: instance.availabilityZone,
  size: 50,
  encrypted: true,
  type: "gp3",
});
new aws.ec2.VolumeAttachment("hermes-data-attach", {
  deviceName: "/dev/sdf",
  volumeId: dataVolume.id,
  instanceId: instance.id,
});

export const publicIp = instance.publicIp;
```
