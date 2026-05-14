/**
 * CADUCEUS on Linode LKE (Kubernetes).
 *
 * Provisions: Kubernetes Deployment (1 replica), ClusterIP Service,
 * Linode Block Storage PVC for /data, and an Ingress with cert-manager
 * for HTTPS. Uses the LKE cluster from kubeconfig.
 *
 * Prerequisites:
 *   - An existing LKE cluster
 *   - cert-manager installed
 *   - linode-cli configured or kubeconfig pointing to the cluster
 *
 * Usage:
 *   cd examples/linode/kubernetes
 *   pulumi stack init <stack-name>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const namespace = config.get('namespace') || 'caduceus'

const provider = new k8s.Provider('caduceus-k8s', {})

const ns = new k8s.core.v1.Namespace('caduceus-ns', { metadata: { name: namespace } }, { provider })

new k8s.core.v1.Secret('caduceus-secrets', {
  metadata: { name: 'caduceus', namespace: ns.metadata.name },
  stringData: {
    JWT_SECRET: jwtSecret,
    INBOUND_WEBHOOK_SECRET: webhookSecret,
    EVENTS_WEBHOOK_SECRET: webhookSecret,
  },
}, { provider })

// Linode Block Storage CSI
new k8s.core.v1.PersistentVolumeClaim('caduceus-pvc', {
  metadata: { name: 'caduceus-data', namespace: ns.metadata.name },
  spec: {
    accessModes: ['ReadWriteOnce'],
    storageClassName: 'linode-block-storage-retain',
    resources: { requests: { storage: '10Gi' } },
  },
}, { provider })

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
          ],
          livenessProbe: { httpGet: { path: '/health', port: 8080 }, initialDelaySeconds: 5, periodSeconds: 30 },
          readinessProbe: { httpGet: { path: '/ready', port: 8080 }, initialDelaySeconds: 3, periodSeconds: 10 },
          resources: { requests: { cpu: '256m', memory: '512Mi' }, limits: { cpu: '1000m', memory: '1024Mi' } },
          volumeMounts: [{ name: 'data', mountPath: '/data' }],
        }],
        volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'caduceus-data' } }],
      },
    },
  },
}, { provider })

new k8s.core.v1.Service('caduceus-svc', {
  metadata: { name: 'caduceus', namespace: ns.metadata.name },
  spec: { type: 'ClusterIP', selector: labels, ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }] },
}, { provider })

new k8s.networking.v1.Ingress('caduceus-ingress', {
  metadata: {
    name: 'caduceus',
    namespace: ns.metadata.name,
    annotations: {
      'cert-manager.io/cluster-issuer': config.get('clusterIssuer') || 'letsencrypt-prod',
    },
  },
  spec: {
    tls: [{ hosts: [hostname], secretName: 'caduceus-tls' }],
    rules: [{ host: hostname, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'caduceus', port: { number: 80 } } } }] } }],
  },
}, { provider })

export const websiteUrl = `https://${hostname}`
