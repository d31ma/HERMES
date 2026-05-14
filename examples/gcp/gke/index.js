/**
 * CADUCEUS on GCP GKE (Google Kubernetes Engine).
 *
 * Provisions: GKE Autopilot cluster (or references an existing one),
 * Kubernetes Deployment (1 replica, ghcr.io/d31ma/caduceus), ClusterIP
 * Service on port 8080, GCP external load balancer via Ingress,
 * GCS Fuse CSI driver with PersistentVolumeClaim for /data, Workload
 * Identity for Secret Manager access, and Kubernetes Secrets for
 * JWT/webhook keys.
 *
 * Prerequisites:
 *   - Workload Identity enabled on the cluster
 *   - GCS Fuse CSI driver installed
 *   - A managed certificate or cert-manager for HTTPS
 *
 * Usage:
 *   cd examples/gcp/gke
 *   pulumi stack init <stack-name>
 *   pulumi config set gcp:project <project-id>
 *   pulumi config set gcp:region <region>
 *   pulumi config set caduceus:clusterName <cluster-name>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as gcp from '@pulumi/gcp'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const clusterName = config.require('clusterName')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const project = config.get('project') || new pulumi.Config('gcp').require('project')
const region = config.get('region') || new pulumi.Config('gcp').require('region')
const namespace = config.get('namespace') || 'caduceus'
const createCluster = config.getBoolean('createCluster') || false

// ── GKE Cluster ──────────────────────────────────────────────────────────
let kubeconfig
if (createCluster) {
  const cluster = new gcp.container.Cluster('caduceus', {
    name: clusterName,
    location: region,
    enableAutopilot: true,
    releaseChannel: { channel: 'REGULAR' },
    deletionProtection: false,
  })
  kubeconfig = pulumi.all([cluster.name, cluster.endpoint, cluster.masterAuth]).apply(([name, endpoint, auth]) => {
    const cert = auth.clusterCaCertificate
    return `apiVersion: v1
kind: Config
clusters:
- name: ${name}
  cluster:
    server: https://${endpoint}
    certificate-authority-data: ${cert}
contexts:
- name: ${name}
  context:
    cluster: ${name}
    user: ${name}
current-context: ${name}
users:
- name: ${name}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gke-gcloud-auth-plugin
      installHint: Install gke-gcloud-auth-plugin for use with kubectl
`
  })
} else {
  const cluster = gcp.container.getCluster({ name: clusterName, location: region })
  kubeconfig = pulumi.all([cluster.name, cluster.endpoint, cluster.masterAuths]).apply(([name, endpoint, authList]) => {
    const cert = authList[0]?.clusterCaCertificate
    return `apiVersion: v1
kind: Config
clusters:
- name: ${name}
  cluster:
    server: https://${endpoint}
    certificate-authority-data: ${cert}
contexts:
- name: ${name}
  context:
    cluster: ${name}
    user: ${name}
current-context: ${name}
users:
- name: ${name}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gke-gcloud-auth-plugin
`
  })
}

const provider = new k8s.Provider('caduceus-k8s', { kubeconfig })

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

// ── GCS Bucket + Workload Identity ───────────────────────────────────────
const bucket = new gcp.storage.Bucket('caduceus-data', {
  name: `caduceus-data-${project}`,
  location: region,
  forceDestroy: true,
})

const sa = new gcp.serviceaccount.Account('caduceus-gke-sa', {
  accountId: 'caduceus-gke',
  displayName: 'CADUCEUS GKE service account',
})

new gcp.storage.BucketIAMMember('caduceus-data-access', {
  bucket: bucket.name,
  role: 'roles/storage.objectAdmin',
  member: pulumi.interpolate`serviceAccount:${sa.email}`,
})

new gcp.serviceaccount.IAMBinding('caduceus-wi', {
  serviceAccountId: sa.id,
  role: 'roles/iam.workloadIdentityUser',
  members: [
    pulumi.interpolate`serviceAccount:${project}.svc.id.goog[${namespace}/caduceus]`,
  ],
})

// ── Deployment ───────────────────────────────────────────────────────────
const labels = { app: 'caduceus' }

new k8s.apps.v1.Deployment('caduceus', {
  metadata: { name: 'caduceus', namespace: ns.metadata.name },
  spec: {
    replicas: 1,
    selector: { matchLabels: labels },
    template: {
      metadata: {
        labels,
        annotations: {
          'iam.gke.io/gcp-service-account': sa.email,
        },
      },
      spec: {
        serviceAccountName: 'caduceus',
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

// ── ServiceAccount ───────────────────────────────────────────────────────
new k8s.core.v1.ServiceAccount('caduceus-sa', {
  metadata: {
    name: 'caduceus',
    namespace: ns.metadata.name,
    annotations: { 'iam.gke.io/gcp-service-account': sa.email },
  },
}, { provider })

// ── Ingress ──────────────────────────────────────────────────────────────
new k8s.networking.v1.Ingress('caduceus-ingress', {
  metadata: {
    name: 'caduceus',
    namespace: ns.metadata.name,
    annotations: {
      'kubernetes.io/ingress.class': 'gce',
      'kubernetes.io/ingress.global-static-ip-name': config.get('globalIpName') || '',
      'networking.gke.io/managed-certificates': config.get('managedCertName') || '',
    },
  },
  spec: {
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
