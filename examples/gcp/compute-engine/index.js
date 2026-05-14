/**
 * CADUCEUS on GCP Compute Engine.
 *
 * Provisions: Compute Engine VM instance (e2-small, ARM64 not available
 * in all regions — adjust machine type), persistent disk for mail data,
 * firewall rule for HTTP, and IAM roles for the service account.
 *
 * The startup script installs Docker and runs the CADUCEUS container
 * from ghcr.io/d31ma/caduceus, mounting the persistent disk at /data.
 *
 * Usage:
 *   cd examples/gcp/compute-engine
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
const region = config.get('region') || new pulumi.Config('gcp').require('region')
const zone = config.get('zone') || `${region}-a`
const machineType = config.get('machineType') || 'e2-small'

// ── Enable APIs ──────────────────────────────────────────────────────────
new gcp.projects.Service('caduceus-compute', {
  service: 'compute.googleapis.com',
  disableOnDestroy: false,
})

// ── Service account ──────────────────────────────────────────────────────
const sa = new gcp.serviceaccount.Account('caduceus-vm-sa', {
  accountId: 'caduceus-vm',
  displayName: 'CADUCEUS VM service account',
})

// ── Network ──────────────────────────────────────────────────────────────
const network = new gcp.compute.Network('caduceus-net', { autoCreateSubnetworks: true })

const firewall = new gcp.compute.Firewall('caduceus-http', {
  network: network.name,
  allows: [
    { protocol: 'tcp', ports: ['8080'] },
    { protocol: 'tcp', ports: ['22'] },
  ],
  sourceRanges: ['0.0.0.0/0'],
  targetTags: ['caduceus'],
})

// ── Persistent disk ──────────────────────────────────────────────────────
const disk = new gcp.compute.Disk('caduceus-data', {
  name: 'caduceus-data',
  zone,
  size: 50,
  type: 'pd-ssd',
})

// ── VM Instance ──────────────────────────────────────────────────────────
const startupScript = pulumi.interpolate`#!/bin/bash
set -euo pipefail

# Install Docker
apt-get update
apt-get install -y docker.io
systemctl enable --now docker

# Mount persistent disk
mkfs.ext4 -F /dev/sdb || true
mkdir -p /data
mount /dev/sdb /data
echo '/dev/sdb /data ext4 defaults,nofail 0 2' >> /etc/fstab
mkdir -p /data/attachments

# Pull and run CADUCEUS
docker run -d --name caduceus \
  --restart always \
  -p 8080:8080 \
  -e JWT_SECRET=${jwtSecret} \
  -e INBOUND_WEBHOOK_SECRET=${webhookSecret} \
  -e EVENTS_WEBHOOK_SECRET=${webhookSecret} \
  -e MAIL_DOMAIN=${mailDomain} \
  -e VAPID_SUBJECT=mailto:postmaster@${mailDomain} \
  -e FYLO_ROOT=/data \
  -e ATTACHMENT_ROOT=/data/attachments \
  -e SMS_ADAPTER=${config.get('smsAdapter') || 'console'} \
  -e SMTP_ADAPTER=${config.get('smtpAdapter') || 'console'} \
  -v /data:/data \
  ${image}
`

const instance = new gcp.compute.Instance('caduceus', {
  name: 'caduceus',
  machineType,
  zone,
  tags: ['caduceus'],
  bootDisk: {
    initializeParams: {
      image: 'ubuntu-os-cloud/ubuntu-2404-lts-amd64',
      size: 20,
      type: 'pd-ssd',
    },
  },
  attachedDisk: [{
    source: disk.selfLink,
    deviceName: 'caduceus-data',
  }],
  networkInterfaces: [{
    network: network.selfLink,
    accessConfigs: [{}], // Ephemeral public IP
  }],
  metadataStartupScript: startupScript,
  serviceAccount: {
    email: sa.email,
    scopes: ['cloud-platform'],
  },
})

// ── Static IP ────────────────────────────────────────────────────────────
const staticIp = new gcp.compute.Address('caduceus-ip', {
  name: 'caduceus-ip',
  region,
})

// ── DNS ──────────────────────────────────────────────────────────────────
const dnsZone = config.get('dnsZone')
if (dnsZone) {
  const zone = gcp.dns.getManagedZone({ name: dnsZone })
  new gcp.dns.RecordSet('caduceus-dns', {
    name: `${hostname}.`,
    managedZone: zone.then(z => z.name),
    type: 'A',
    ttl: 300,
    rrdatas: [staticIp.address],
  })
}

// ── Outputs ──────────────────────────────────────────────────────────────
export const instanceName = instance.name
export const publicIp = instance.networkInterfaces.apply(ni => ni[0]?.accessConfigs?.[0]?.natIp || '')
export const websiteUrl = `http://${staticIp.address}:8080`
