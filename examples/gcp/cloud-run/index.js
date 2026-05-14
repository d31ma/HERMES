/**
 * CADUCEUS on GCP Cloud Run.
 *
 * Provisions: Cloud Run service pulling from ghcr.io/d31ma/caduceus,
 * Secret Manager for JWT and webhook secrets, IAM bindings for
 * secret access, GCS bucket for Fylo data (via gcsfuse), and
 * public IAM binding so the service is internet-accessible.
 *
 * Cloud Run is the recommended GCP deployment — it auto-scales to
 * zero, provides automatic HTTPS, and charges per-request.
 * Set max-instances to 1 when using a GCS-backed Fylo volume to
 * avoid concurrent-write conflicts.
 *
 * Usage:
 *   cd examples/gcp/cloud-run
 *   pulumi stack init <stack-name>
 *   pulumi config set gcp:project <project-id>
 *   pulumi config set gcp:region <region>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as gcp from '@pulumi/gcp'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const project = config.get('project') || new pulumi.Config('gcp').require('project')
const region = config.get('region') || new pulumi.Config('gcp').require('region')

// ── Enable required APIs ─────────────────────────────────────────────────
const apis = ['run.googleapis.com', 'secretmanager.googleapis.com', 'cloudbuild.googleapis.com']
apis.forEach(api => {
  new gcp.projects.Service(`caduceus-api-${api.replace('.', '-')}`, {
    service: api,
    disableOnDestroy: false,
  })
})

// ── Secrets ──────────────────────────────────────────────────────────────
const jwtSecretObj = new gcp.secretmanager.Secret('caduceus-jwt', {
  secretId: 'caduceus-jwt-secret',
  replication: { auto: {} },
})
new gcp.secretmanager.SecretVersion('caduceus-jwt-v', {
  secret: jwtSecretObj.id,
  secretData: jwtSecret,
})

const inboundSecretObj = new gcp.secretmanager.Secret('caduceus-inbound', {
  secretId: 'caduceus-inbound-secret',
  replication: { auto: {} },
})
new gcp.secretmanager.SecretVersion('caduceus-inbound-v', {
  secret: inboundSecretObj.id,
  secretData: webhookSecret,
})

// ── Service account ──────────────────────────────────────────────────────
const sa = new gcp.serviceaccount.Account('caduceus-sa', {
  accountId: 'caduceus-cloud-run',
  displayName: 'CADUCEUS Cloud Run service account',
})

// Grant secret access
new gcp.secretmanager.SecretIamMember('jwt-access', {
  secretId: jwtSecretObj.id,
  role: 'roles/secretmanager.secretAccessor',
  member: pulumi.interpolate`serviceAccount:${sa.email}`,
})
new gcp.secretmanager.SecretIamMember('inbound-access', {
  secretId: inboundSecretObj.id,
  role: 'roles/secretmanager.secretAccessor',
  member: pulumi.interpolate`serviceAccount:${sa.email}`,
})

// ── GCS Bucket for Fylo data ─────────────────────────────────────────────
const bucket = new gcp.storage.Bucket('caduceus-data', {
  name: `caduceus-data-${project}`,
  location: region,
  forceDestroy: true,
})

// ── Cloud Run service ────────────────────────────────────────────────────
const service = new gcp.cloudrunv2.Service('caduceus', {
  name: 'caduceus',
  location: region,
  ingress: 'INGRESS_TRAFFIC_ALL',
  template: {
    serviceAccount: sa.email,
    containers: [{
      name: 'caduceus',
      image,
      ports: [{ containerPort: 8080 }],
      envs: [
        { name: 'FYLO_ROOT', value: '/data' },
        { name: 'ATTACHMENT_ROOT', value: '/data/attachments' },
        { name: 'MAIL_DOMAIN', value: mailDomain },
        { name: 'VAPID_SUBJECT', value: `mailto:postmaster@${mailDomain}` },
        { name: 'SMS_ADAPTER', value: config.get('smsAdapter') || 'console' },
        { name: 'SMTP_ADAPTER', value: config.get('smtpAdapter') || 'console' },
        { name: 'LOG_LEVEL', value: config.get('logLevel') || 'info' },
        {
          name: 'JWT_SECRET',
          valueSource: { secretKeyRef: { secret: jwtSecretObj.secretId, version: 'latest' } },
        },
        {
          name: 'INBOUND_WEBHOOK_SECRET',
          valueSource: { secretKeyRef: { secret: inboundSecretObj.secretId, version: 'latest' } },
        },
        {
          name: 'EVENTS_WEBHOOK_SECRET',
          valueSource: { secretKeyRef: { secret: inboundSecretObj.secretId, version: 'latest' } },
        },
      ],
      resources: {
        cpuIdle: true,
        limits: { cpu: '1000m', memory: '512Mi' },
      },
      startupProbe: { httpGet: { path: '/health' }, initialDelaySeconds: 3 },
      livenessProbe: { httpGet: { path: '/health' } },
      volumeMounts: [{ name: 'data', mountPath: '/data' }],
    }],
    scaling: { minInstanceCount: 0, maxInstanceCount: 1 },
    volumes: [{
      name: 'data',
      gcs: { bucket: bucket.name, readOnly: false },
    }],
  },
})

// ── Public IAM binding ───────────────────────────────────────────────────
new gcp.cloudrunv2.ServiceIamMember('caduceus-public', {
  name: service.name,
  location: service.location,
  project: service.project,
  role: 'roles/run.invoker',
  member: 'allUsers',
})

// ── Outputs ──────────────────────────────────────────────────────────────
export const serviceUrl = service.uri
export const websiteUrl = `https://${hostname}`
