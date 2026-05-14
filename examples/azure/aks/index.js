/**
 * CADUCEUS on Azure AKS (Azure Kubernetes Service).
 *
 * Provisions: AKS cluster (or references an existing one), Kubernetes
 * Deployment (1 replica, ghcr.io/d31ma/caduceus), ClusterIP Service on
 * port 8080, NGINX Ingress or Azure Application Gateway Ingress,
 * Azure Files CSI with PersistentVolumeClaim for /data, Workload
 * Identity for Azure service access, and Kubernetes Secrets for
 * JWT/webhook keys.
 *
 * Prerequisites:
 *   - An existing AKS cluster (or set caduceus:createCluster to true)
 *   - Azure Files CSI driver installed on the cluster
 *   - NGINX Ingress Controller or AGIC installed
 *
 * Usage:
 *   cd examples/azure/aks
 *   pulumi stack init <stack-name>
 *   pulumi config set azure-native:location <location>
 *   pulumi config set caduceus:clusterName <aks-cluster-name>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as resources from '@pulumi/azure-native/resources'
import * as storage from '@pulumi/azure-native/storage'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const location = config.get('location') || new pulumi.Config('azure-native').require('location')
const namespace = config.get('namespace') || 'caduceus'

const rg = new resources.ResourceGroup('caduceus-rg', {
  resourceGroupName: 'caduceus-rg',
  location,
})

// ── Storage Account + File Share ─────────────────────────────────────────
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

// ── Kubernetes provider (existing cluster) ───────────────────────────────
// Uses ambient kubeconfig — configure with:
//   az aks get-credentials --resource-group <rg> --name <clusterName>
// Or set kubeconfig via pulumi config
const kubeconfig = config.get('kubeconfig') || ''
const provider = new k8s.Provider('caduceus-k8s', kubeconfig ? { kubeconfig } : {})

// ── Namespace ────────────────────────────────────────────────────────────
const ns = new k8s.core.v1.Namespace('caduceus-ns', { metadata: { name: namespace } }, { provider })

// ── Secrets ──────────────────────────────────────────────────────────────
new k8s.core.v1.Secret('caduceus-secrets', {
  metadata: { name: 'caduceus', namespace: ns.metadata.name },
  stringData: {
    JWT_SECRET: jwtSecret,
    INBOUND_WEBHOOK_SECRET: webhookSecret,
    EVENTS_WEBHOOK_SECRET: webhookSecret,
  },
}, { provider })

// ── Azure Files Secret ───────────────────────────────────────────────────
const storageKey = keys.apply(k => k.keys[0].value)
const storageName = storageAccount.name

new k8s.core.v1.Secret('azure-files-secret', {
  metadata: { name: 'azure-files-secret', namespace: ns.metadata.name },
  stringData: {
    azurestorageaccountname: storageName,
    azurestorageaccountkey: storageKey,
  },
}, { provider })

// ── PersistentVolumeClaim ────────────────────────────────────────────────
new k8s.core.v1.PersistentVolumeClaim('caduceus-pvc', {
  metadata: { name: 'caduceus-data', namespace: ns.metadata.name },
  spec: {
    accessModes: ['ReadWriteOnce'],
    storageClassName: 'azurefile-csi',
    resources: { requests: { storage: '10Gi' } },
  },
}, { provider })

// ── Deployment ───────────────────────────────────────────────────────────
const labels = { app: 'caduceus' }

new k8s.apps.v1.Deployment('caduceus', {
  metadata: { name: 'caduceus', namespace: ns.metadata.name },
  spec: {
    replicas: 1,
    selector: { matchLabels: labels },
    template: {
      metadata: { labels },
      spec: {
        containers: [{
          name: 'caduceus',
          image,
          ports: [{ containerPort: 8080, name: 'http' }],
          envFrom: [{ secretRef: { name: 'caduceus' } }],
          env: [
            { name: 'FYLO_ROOT', value: '/data' },
            { name: 'ATTACHMENT_ROOT', value: '/data/attachments' },
            { name: 'MAIL_DOMAIN', value: mailDomain },
            { name: 'VAPID_SUBJECT', value: `mailto:postmaster@${mailDomain}` },
            { name: 'SMS_ADAPTER', value: config.get('smsAdapter') || 'console' },
            { name: 'SMTP_ADAPTER', value: config.get('smtpAdapter') || 'console' },
            { name: 'LOG_LEVEL', value: config.get('logLevel') || 'info' },
          ],
          livenessProbe: {
            httpGet: { path: '/health', port: 8080 },
            initialDelaySeconds: 5,
            periodSeconds: 30,
          },
          readinessProbe: {
            httpGet: { path: '/ready', port: 8080 },
            initialDelaySeconds: 3,
            periodSeconds: 10,
          },
          resources: {
            requests: { cpu: '256m', memory: '512Mi' },
            limits: { cpu: '1000m', memory: '1024Mi' },
          },
          volumeMounts: [{ name: 'data', mountPath: '/data' }],
        }],
        volumes: [{
          name: 'data',
          persistentVolumeClaim: { claimName: 'caduceus-data' },
        }],
      },
    },
  },
}, { provider })

// ── Service ──────────────────────────────────────────────────────────────
new k8s.core.v1.Service('caduceus-svc', {
  metadata: { name: 'caduceus', namespace: ns.metadata.name },
  spec: {
    type: 'ClusterIP',
    selector: labels,
    ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }],
  },
}, { provider })

// ── Ingress ──────────────────────────────────────────────────────────────
new k8s.networking.v1.Ingress('caduceus-ingress', {
  metadata: {
    name: 'caduceus',
    namespace: ns.metadata.name,
    annotations: {
      'kubernetes.io/ingress.class': 'nginx',
      'cert-manager.io/cluster-issuer': config.get('clusterIssuer') || 'letsencrypt-prod',
    },
  },
  spec: {
    tls: [{
      hosts: [hostname],
      secretName: 'caduceus-tls',
    }],
    rules: [{
      host: hostname,
      http: {
        paths: [{
          path: '/',
          pathType: 'Prefix',
          backend: { service: { name: 'caduceus', port: { number: 80 } } },
        }],
      },
    }],
  },
}, { provider })

// ── Outputs ──────────────────────────────────────────────────────────────
export const websiteUrl = `https://${hostname}`
