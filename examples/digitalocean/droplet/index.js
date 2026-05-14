/**
 * CADUCEUS on DigitalOcean Droplet.
 *
 * Provisions: Droplet (s-1vcpu-1gb) with Docker pre-installed via
 * cloud-init, a Block Storage volume mounted at /data, and DNS
 * record if a domain is configured.
 *
 * Usage:
 *   cd examples/digitalocean/droplet
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
const dropletSize = config.get('size') || 's-1vcpu-1gb'

const sshKeys = config.get('sshKeyFingerprints')
  ? config.get('sshKeyFingerprints')!.split(',').map(s => s.trim())
  : []

const userData = pulumi.interpolate`#!/bin/bash
set -euo pipefail

# Install Docker
apt-get update
apt-get install -y docker.io
systemctl enable --now docker

# Mount block storage volume
mkfs.ext4 -F /dev/sda || true
mkdir -p /data
mount /dev/sda /data
mkdir -p /data/attachments

# Run CADUCEUS
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

const volume = new digitalocean.Volume('caduceus-data', {
  name: 'caduceus-data',
  region,
  size: 50,
  initialFilesystemType: 'ext4',
})

const droplet = new digitalocean.Droplet('caduceus', {
  name: 'caduceus',
  image: 'ubuntu-24-04-x64',
  size: dropletSize,
  region,
  sshKeys,
  userData: userData.apply(d => d), // cloud-init string
  volumeIds: [volume.id],
})

if (hostname) {
  const domain = hostname.split('.').slice(-2).join('.')
  new digitalocean.DnsRecord('caduceus-dns', {
    domain,
    name: hostname.replace(`.${domain}`, ''),
    type: 'A',
    value: droplet.ipv4Address,
    ttl: 300,
  })
}

export const ipv4 = droplet.ipv4Address
export const websiteUrl = `http://${droplet.ipv4Address}:8080`
