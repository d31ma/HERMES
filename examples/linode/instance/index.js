/**
 * CADUCEUS on Linode Nanode.
 *
 * Provisions: Linode instance (Nanode 1 GB, Ubuntu 24.04) with Docker
 * pre-installed via cloud-init, a Block Storage volume mounted at
 * /data, and a Domain record if configured.
 *
 * Usage:
 *   cd examples/linode/instance
 *   pulumi stack init <stack-name>
 *   pulumi config set linode:token <linode-api-token> --secret
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as linode from '@pulumi/linode'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const region = config.get('region') || 'us-east'
const instanceType = config.get('instanceType') || 'g6-nanode-1'

const stackScript = pulumi.interpolate`#!/bin/bash
set -euo pipefail

apt-get update
apt-get install -y docker.io
systemctl enable --now docker

# Mount block storage volume
mkfs.ext4 -F /dev/sdc || true
mkdir -p /data
mount /dev/sdc /data
mkdir -p /data/attachments

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
  -v /data:/data \
  ${image}
`

const volume = new linode.Volume('caduceus-data', {
  label: 'caduceus-data',
  region,
  size: 50,
})

const instance = new linode.Instance('caduceus', {
  label: 'caduceus',
  image: 'linode/ubuntu24.04',
  type: instanceType,
  region,
  rootPass: config.requireSecret('rootPass'),
  stackscriptData: { script: stackScript },
  disks: [{
    label: 'caduceus-os',
    size: 25600,
    filesystem: 'ext4',
    image: 'linode/ubuntu24.04',
  }],
  configs: [{
    label: 'caduceus-config',
    kernel: 'linode/latest-64bit',
    devices: {
      sda: { diskLabel: 'caduceus-os' },
      sdc: { volumeId: volume.id },
    },
    rootDevice: '/dev/sda',
  }],
  booted: true,
})

if (hostname) {
  const domain = hostname.split('.').slice(-2).join('.')
  const subdomain = hostname.replace(`.${domain}`, '')
  new linode.DomainRecord('caduceus-dns', {
    domainId: linode.getDomain({ domain }).then(d => d.id),
    name: subdomain,
    type: 'A',
    target: instance.ipAddress,
    ttlSec: 300,
  })
}

export const ipv4 = instance.ipAddress
export const websiteUrl = `http://${instance.ipAddress}:8080`
