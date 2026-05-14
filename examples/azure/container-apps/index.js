/**
 * CADUCEUS on Azure Container Apps.
 *
 * Provisions: Container App Environment, Container App pulling from
 * ghcr.io/d31ma/caduceus, Azure Files share for Fylo persistence,
 * Secrets for JWT and webhook keys, and ingress with HTTP support.
 *
 * Container Apps is the recommended Azure deployment — it auto-scales
 * to zero, provides managed HTTPS, and is simpler than AKS.
 *
 * Usage:
 *   cd examples/azure/container-apps
 *   pulumi stack init <stack-name>
 *   pulumi config set azure-native:location <location>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as app from '@pulumi/azure-native/app'
import * as resources from '@pulumi/azure-native/resources'
import * as storage from '@pulumi/azure-native/storage'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const location = config.get('location') || new pulumi.Config('azure-native').require('location')

// ── Resource Group ───────────────────────────────────────────────────────
const rg = new resources.ResourceGroup('caduceus-rg', {
  resourceGroupName: 'caduceus-rg',
  location,
})

// ── Container App Environment ────────────────────────────────────────────
const env = new app.ManagedEnvironment('caduceus-env', {
  resourceGroupName: rg.name,
  location: rg.location,
})

// ── Storage Account + File Share for Fylo ────────────────────────────────
const storageAccount = new storage.StorageAccount('caduceusdata', {
  resourceGroupName: rg.name,
  location: rg.location,
  kind: 'StorageV2',
  sku: { name: 'Standard_LRS' },
})

const share = new storage.FileShare('caduceus-data', {
  accountName: storageAccount.name,
  resourceGroupName: rg.name,
  shareQuota: 50,
})

const keys = storage.listStorageAccountKeysOutput({
  accountName: storageAccount.name,
  resourceGroupName: rg.name,
})

// ── Container App ────────────────────────────────────────────────────────
const containerApp = new app.ContainerApp('caduceus', {
  resourceGroupName: rg.name,
  environmentId: env.id,
  configuration: {
    ingress: {
      external: true,
      targetPort: 8080,
      allowInsecure: false,
    },
    secrets: [
      { name: 'jwt-secret', value: jwtSecret },
      { name: 'inbound-secret', value: webhookSecret },
    ],
  },
  template: {
    containers: [{
      name: 'caduceus',
      image,
      resources: { cpu: 0.5, memory: '1Gi' },
      env: [
        { name: 'FYLO_ROOT', value: '/data' },
        { name: 'ATTACHMENT_ROOT', value: '/data/attachments' },
        { name: 'MAIL_DOMAIN', value: mailDomain },
        { name: 'VAPID_SUBJECT', value: `mailto:postmaster@${mailDomain}` },
        { name: 'SMS_ADAPTER', value: config.get('smsAdapter') || 'console' },
        { name: 'SMTP_ADAPTER', value: config.get('smtpAdapter') || 'console' },
        { name: 'LOG_LEVEL', value: config.get('logLevel') || 'info' },
        { name: 'JWT_SECRET', secretRef: 'jwt-secret' },
        { name: 'INBOUND_WEBHOOK_SECRET', secretRef: 'inbound-secret' },
        { name: 'EVENTS_WEBHOOK_SECRET', secretRef: 'inbound-secret' },
      ],
      volumeMounts: [{ volumeName: 'caduceus-data', mountPath: '/data' }],
      probes: [{
        type: 'Liveness',
        httpGet: { path: '/health', port: 8080 },
        initialDelaySeconds: 5,
        periodSeconds: 30,
      }, {
        type: 'Readiness',
        httpGet: { path: '/ready', port: 8080 },
        initialDelaySeconds: 3,
        periodSeconds: 10,
      }, {
        type: 'Startup',
        httpGet: { path: '/health', port: 8080 },
        initialDelaySeconds: 3,
      }],
    }],
    volumes: [{
      name: 'caduceus-data',
      storageType: 'AzureFile',
      storageName: 'caduceus-data-vol',
      mountOptions: 'uid=65532,gid=65532',
      azureFile: {
        accountName: storageAccount.name,
        accountKey: keys.apply(k => k.keys[0].value),
        shareName: share.name,
      },
    }],
  },
})

// ── Outputs ──────────────────────────────────────────────────────────────
export const appUrl = containerApp.configuration.ingress.apply(i => `https://${i?.fqdn}`)
export const websiteUrl = `https://${hostname}`
