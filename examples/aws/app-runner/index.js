/**
 * CADUCEUS on AWS App Runner.
 *
 * Provisions: App Runner service pulling from ghcr.io/d31ma/caduceus,
 * IAM instance role with SES/SNS permissions, Secrets Manager for
 * JWT and webhook secrets, CloudWatch logs, and optional custom
 * domain with Route53 alias.
 *
 * App Runner is the simplest AWS container service — just point it at
 * a public image and it handles HTTPS, scaling, and health checks.
 * The trade-off is no EFS; use this for stateless or demo deployments
 * where durable mail storage isn't required.
 *
 * Usage:
 *   cd examples/aws/app-runner
 *   pulumi stack init <stack-name>
 *   pulumi config set aws:region <region>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set caduceus:route53ZoneId <zone-id>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const zoneId = config.require('route53ZoneId')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'

const tags = {
  project: 'caduceus',
  environment: 'production',
  domain: mailDomain,
  managedBy: 'pulumi',
}

// ── Secrets ──────────────────────────────────────────────────────────────
const jwtSecretObj = new aws.secretsmanager.Secret('caduceus-jwt', {
  name: 'caduceus-jwt-secret',
  tags: { ...tags, Name: 'caduceus-jwt' },
})
new aws.secretsmanager.SecretVersion('caduceus-jwt-v', {
  secretId: jwtSecretObj.id,
  secretString: jwtSecret,
})

const inboundSecretObj = new aws.secretsmanager.Secret('caduceus-inbound', {
  name: 'caduceus-inbound-secret',
  tags: { ...tags, Name: 'caduceus-inbound' },
})
new aws.secretsmanager.SecretVersion('caduceus-inbound-v', {
  secretId: inboundSecretObj.id,
  secretString: webhookSecret,
})

// ── IAM ──────────────────────────────────────────────────────────────────
const instanceRole = new aws.iam.Role('caduceus-apprunner-role', {
  name: 'caduceus-apprunner',
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'build.apprunner.amazonaws.com' },
      Action: 'sts:AssumeRole',
    }],
  }),
  tags: { ...tags, Name: 'caduceus-apprunner-role' },
})

new aws.iam.RolePolicy('caduceus-apprunner-ses-sns', {
  role: instanceRole.id,
  policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['ses:SendEmail', 'ses:SendRawEmail', 'sesv2:SendEmail'], Resource: '*' },
      { Effect: 'Allow', Action: ['sns:Publish'], Resource: '*' },
    ],
  }),
})

// Allow App Runner to read secrets
new aws.iam.RolePolicy('caduceus-apprunner-secrets', {
  role: instanceRole.id,
  policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Action: ['secretsmanager:GetSecretValue'],
      Resource: [jwtSecretObj.arn, inboundSecretObj.arn],
    }],
  }),
})

// ── App Runner Service ───────────────────────────────────────────────────
const service = new aws.apprunner.Service('caduceus', {
  serviceName: 'caduceus',
  sourceConfiguration: {
    imageRepository: {
      imageIdentifier: image,
      imageConfiguration: {
        port: '8080',
        runtimeEnvironmentVariables: {
          FYLO_ROOT: '/tmp/data',
          ATTACHMENT_ROOT: '/tmp/attachments',
          MAIL_DOMAIN: mailDomain,
          VAPID_SUBJECT: `mailto:postmaster@${mailDomain}`,
          SMS_ADAPTER: config.get('smsAdapter') || 'console',
          SMTP_ADAPTER: config.get('smtpAdapter') || 'console',
          LOG_LEVEL: config.get('logLevel') || 'info',
        },
        runtimeEnvironmentSecrets: {
          JWT_SECRET: jwtSecretObj.arn,
          INBOUND_WEBHOOK_SECRET: inboundSecretObj.arn,
          EVENTS_WEBHOOK_SECRET: inboundSecretObj.arn,
        },
      },
    },
  },
  instanceConfiguration: {
    cpu: '1024',
    memory: '2048',
    instanceRoleArn: instanceRole.arn,
  },
  healthCheckConfiguration: {
    path: '/health',
    protocol: 'HTTP',
    interval: 10,
    timeout: 5,
    healthyThreshold: 1,
    unhealthyThreshold: 5,
  },
  tags: { ...tags, Name: 'caduceus' },
})

// ── Custom Domain ────────────────────────────────────────────────────────
if (hostname && zoneId) {
  const cname = new aws.route53.Record('caduceus-dns', {
    zoneId,
    name: hostname,
    type: 'CNAME',
    ttl: 300,
    records: [service.serviceUrl.apply(u => new URL(u).hostname)],
  })
}

// ── Outputs ──────────────────────────────────────────────────────────────
export const serviceUrl = service.serviceUrl
export const serviceArn = service.arn
export const websiteUrl = `https://${hostname}`
