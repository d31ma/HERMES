/**
 * CADUCEUS on Fly.io.
 *
 * Provisions: Fly App + Machine running from ghcr.io/d31ma/caduceus,
 * with a Fly Volume for persistent mail data, public IP, and
 * health checks. Fly handles global routing and TLS automatically.
 *
 * Fly.io runs Docker images globally — deploy once and it's live in
 * every region you select. The volume is single-region (Fylo requires
 * single-writer), so start with one machine in one region.
 *
 * Usage:
 *   cd examples/fly/machine
 *   pulumi stack init <stack-name>
 *   pulumi config set fly:flyApiToken <fly-api-token> --secret
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as fly from '@pulumi/fly'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const region = config.get('region') || 'iad'

const app = new fly.App('caduceus', {
  name: 'caduceus',
  org: config.require('org'),
})

const ip = new fly.IP('caduceus-ip', {
  app: app.name,
  type: 'v4',
})

const volume = new fly.Volume('caduceus-data', {
  app: app.name,
  name: 'caduceus_data',
  region,
  size: 10,
})

new fly.Machine('caduceus', {
  app: app.name,
  name: 'caduceus',
  region,
  image,
  services: [{
    ports: [
      { port: 80, handlers: ['http'] },
      { port: 443, handlers: ['tls', 'http'] },
    ],
    protocol: 'tcp',
    internalPort: 8080,
    checks: [{
      type: 'http',
      path: '/health',
      interval: '15s',
      timeout: '5s',
    }],
  }],
  env: {
    FYLO_ROOT: '/data',
    ATTACHMENT_ROOT: '/data/attachments',
    MAIL_DOMAIN: mailDomain,
    VAPID_SUBJECT: `mailto:postmaster@${mailDomain}`,
    SMS_ADAPTER: config.get('smsAdapter') || 'console',
    SMTP_ADAPTER: config.get('smtpAdapter') || 'console',
    LOG_LEVEL: config.get('logLevel') || 'info',
    JWT_SECRET: jwtSecret,
    INBOUND_WEBHOOK_SECRET: webhookSecret,
    EVENTS_WEBHOOK_SECRET: webhookSecret,
  },
  mounts: [{
    volume: volume.id,
    path: '/data',
  }],
})

if (hostname) {
  new fly.Certificate('caduceus-cert', {
    app: app.name,
    hostname,
  })
}

export const appName = app.name
export const publicIp = ip.address
export const websiteUrl = `https://${hostname}`
