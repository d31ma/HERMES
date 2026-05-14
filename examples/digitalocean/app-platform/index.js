/**
 * CADUCEUS on DigitalOcean App Platform.
 *
 * Provisions: App Platform app pulling from ghcr.io/d31ma/caduceus,
 * with health checks, scaling config, and environment secrets.
 *
 * App Platform is the simplest DO deployment — point at an image,
 * DO handles HTTPS, routing, and scaling. No persistence by default;
 * attach a Spaces bucket or managed database for durable mail data.
 *
 * Usage:
 *   cd examples/digitalocean/app-platform
 *   pulumi stack init <stack-name>
 *   pulumi config set digitalocean:token <do-api-token> --secret
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as digitalocean from '@pulumi/digitalocean'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const region = config.get('region') || 'nyc3'

new digitalocean.App('caduceus', {
  spec: {
    name: 'caduceus',
    region,
    domains: hostname ? [{ name: hostname, type: 'PRIMARY' }] : [],
    services: [{
      name: 'caduceus',
      image: {
        registryType: 'DOCKER_HUB',
        registry: image.split('/')[0],
        repository: image.split('/').slice(1).join('/').split(':')[0],
        tag: image.split(':')[1] || 'latest',
      },
      httpPort: 8080,
      instanceCount: 1,
      instanceSizeSlug: 'basic-xxs',
      healthCheck: {
        httpPath: '/health',
        initialDelaySeconds: 5,
        periodSeconds: 30,
      },
      envs: [
        { key: 'FYLO_ROOT', value: '/mnt/data' },
        { key: 'ATTACHMENT_ROOT', value: '/mnt/data/attachments' },
        { key: 'MAIL_DOMAIN', value: mailDomain },
        { key: 'VAPID_SUBJECT', value: `mailto:postmaster@${mailDomain}` },
        { key: 'SMS_ADAPTER', value: config.get('smsAdapter') || 'console' },
        { key: 'SMTP_ADAPTER', value: config.get('smtpAdapter') || 'console' },
        { key: 'LOG_LEVEL', value: config.get('logLevel') || 'info' },
        { key: 'JWT_SECRET', value: jwtSecret, type: 'SECRET' },
        { key: 'INBOUND_WEBHOOK_SECRET', value: webhookSecret, type: 'SECRET' },
        { key: 'EVENTS_WEBHOOK_SECRET', value: webhookSecret, type: 'SECRET' },
      ],
    }],
  },
})

export const websiteUrl = `https://${hostname}`
