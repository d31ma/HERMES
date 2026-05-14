/**
 * CADUCEUS on AWS EKS (Elastic Kubernetes Service).
 *
 * Provisions: EKS cluster (or references an existing one), Kubernetes
 * Deployment (1 replica, ghcr.io/d31ma/caduceus), ClusterIP Service on
 * port 8080, ALB Ingress Controller for public HTTPS, EFS CSI driver
 * with PersistentVolumeClaim for /data, IRSA for SES/SNS permissions,
 * and Kubernetes Secrets for JWT/webhook keys.
 *
 * Prerequisites:
 *   - An existing EKS cluster (or set caduceus:createCluster to true)
 *   - AWS Load Balancer Controller installed on the cluster
 *   - EFS CSI driver installed on the cluster
 *
 * Usage:
 *   cd examples/aws/eks
 *   pulumi stack init <stack-name>
 *   pulumi config set aws:region <region>
 *   pulumi config set caduceus:clusterName <eks-cluster-name>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set caduceus:certificateArn <acm-cert-arn>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as aws from '@pulumi/aws'
import * as eks from '@pulumi/eks'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const clusterName = config.require('clusterName')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const certificateArn = config.require('certificateArn')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const createCluster = config.getBoolean('createCluster') || false
const namespace = config.get('namespace') || 'caduceus'

const tags = {
  project: 'caduceus',
  environment: 'production',
  domain: mailDomain,
  managedBy: 'pulumi',
}

// ── EKS Cluster ──────────────────────────────────────────────────────────
let kubeconfig
if (createCluster) {
  const vpc = aws.ec2.getVpc({ default: true })
  const subnets = aws.ec2.getSubnets({ filters: [{ name: 'vpc-id', values: [vpc.then(v => v.id)] }] })

  const cluster = new eks.Cluster('caduceus', {
    name: clusterName,
    vpcId: vpc.then(v => v.id),
    subnetIds: subnets.then(s => s.ids),
    instanceType: 't4g.medium',
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 3,
    tags: { ...tags, Name: clusterName },
  })
  kubeconfig = cluster.kubeconfig
} else {
  // Reference an existing cluster
  const cluster = aws.eks.getCluster({ name: clusterName })
  kubeconfig = Promise.resolve(cluster).then(c => {
    const endpoint = c.endpoint
    const certificate = c.certificateAuthorities?.[0]?.data
    return JSON.stringify({
      apiVersion: 'v1',
      clusters: [{ name: clusterName, cluster: { server: endpoint, 'certificate-authority-data': certificate } }],
      contexts: [{ name: clusterName, context: { cluster: clusterName, user: clusterName } }],
      'current-context': clusterName,
      users: [{ name: clusterName }],
    })
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

// ── EFS CSI + PersistentVolumeClaim ──────────────────────────────────────
const efs = new aws.efs.FileSystem('caduceus-efs', {
  creationToken: `caduceus-${clusterName}`,
  encrypted: true,
  tags: { ...tags, Name: 'caduceus-efs' },
})

// Create mount targets in the cluster's VPC subnets
const clusterInfo = aws.eks.getCluster({ name: clusterName })
const subnets = aws.ec2.getSubnets({
  filters: [{ name: 'vpc-id', values: [clusterInfo.then(c => c.vpcConfig?.vpcId || '')] }],
})

const efsSg = new aws.ec2.SecurityGroup('caduceus-efs-sg', {
  vpcId: clusterInfo.then(c => c.vpcConfig?.vpcId || ''),
  description: 'EFS NFS from EKS nodes',
  ingress: [{ fromPort: 2049, toPort: 2049, protocol: 'tcp', cidrBlocks: ['0.0.0.0/0'] }],
  tags: { ...tags, Name: 'caduceus-efs-sg' },
})

subnets.then(s => s.ids.map((subnetId, i) =>
  new aws.efs.MountTarget(`caduceus-efs-mt-${i}`, {
    fileSystemId: efs.id,
    subnetId,
    securityGroups: [efsSg.id],
  })
))

// PVC backed by EFS (requires EFS CSI driver)
new k8s.core.v1.PersistentVolumeClaim('caduceus-pvc', {
  metadata: { name: 'caduceus-data', namespace: ns.metadata.name },
  spec: {
    accessModes: ['ReadWriteOnce'],
    storageClassName: 'efs-sc',
    resources: { requests: { storage: '10Gi' } },
  },
}, { provider })

// ── IAM (IRSA) ───────────────────────────────────────────────────────────
const oidcProvider = clusterInfo.then(c => {
  const issuer = c.identities?.[0]?.oidcs?.[0]?.issuer || ''
  const oidcArn = `arn:aws:iam::${aws.getCallerIdentity({}).then(id => id.accountId)}:oidc-provider/${issuer.replace('https://', '')}`
  return oidcArn
})

const saRole = new aws.iam.Role('caduceus-sa', {
  name: `caduceus-${clusterName}-sa`,
  assumeRolePolicy: pulumi.all([oidcProvider, ns.metadata.name]).apply(([oidc, ns]) => JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Federated: oidc },
      Action: 'sts:AssumeRoleWithWebIdentity',
      Condition: {
        StringEquals: { [`${oidc.replace('arn:aws:iam::', '').split(':').pop()}:sub`]: `system:serviceaccount:${ns}:caduceus` },
      },
    }],
  })),
  tags: { ...tags, Name: 'caduceus-sa-role' },
})

new aws.iam.RolePolicy('caduceus-sa-ses-sns', {
  role: saRole.id,
  policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['ses:SendEmail', 'ses:SendRawEmail', 'sesv2:SendEmail'], Resource: '*' },
      { Effect: 'Allow', Action: ['sns:Publish'], Resource: '*' },
    ],
  }),
})

// ── Deployment ───────────────────────────────────────────────────────────
const labels = { app: 'caduceus' }

new k8s.apps.v1.Deployment('caduceus', {
  metadata: { name: 'caduceus', namespace: ns.metadata.name },
  spec: {
    replicas: 1, // Fylo requires single-writer
    selector: { matchLabels: labels },
    template: {
      metadata: {
        labels,
        annotations: { 'prometheus.io/scrape': 'true', 'prometheus.io/port': '8080' },
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

// ── Ingress (ALB) ────────────────────────────────────────────────────────
new k8s.networking.v1.Ingress('caduceus-ingress', {
  metadata: {
    name: 'caduceus',
    namespace: ns.metadata.name,
    annotations: {
      'alb.ingress.kubernetes.io/scheme': 'internet-facing',
      'alb.ingress.kubernetes.io/target-type': 'ip',
      'alb.ingress.kubernetes.io/listen-ports': '[{"HTTPS":443},{"HTTP":80}]',
      'alb.ingress.kubernetes.io/ssl-redirect': '443',
      'alb.ingress.kubernetes.io/certificate-arn': certificateArn,
      'alb.ingress.kubernetes.io/healthcheck-path': '/health',
      'alb.ingress.kubernetes.io/healthcheck-port': '8080',
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

// ── ServiceAccount ───────────────────────────────────────────────────────
const sa = new k8s.core.v1.ServiceAccount('caduceus-sa', {
  metadata: {
    name: 'caduceus',
    namespace: ns.metadata.name,
    annotations: { 'eks.amazonaws.com/role-arn': saRole.arn },
  },
}, { provider })

// ── Outputs ──────────────────────────────────────────────────────────────
export const clusterEndpoint = clusterInfo.then(c => c.endpoint)
export const websiteUrl = `https://${hostname}`
