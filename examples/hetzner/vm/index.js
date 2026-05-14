/**
 * CADUCEUS on Hetzner Cloud.
 *
 * Provisions: CX instance (cx22) running Ubuntu 24.04 with Docker,
 * a block volume mounted at /data for persistent mail storage,
 * firewall rules for HTTP (8080) and SSH, and an optional DNS
 * record if a zone is configured.
 *
 * Hetzner is cost-effective for single-instance deployments with
 * good EU datacenter coverage.
 *
 * Usage:
 *   cd examples/hetzner/vm
 *   pulumi stack init <stack-name>
 *   pulumi config set hetzner:token <hcloud-api-token> --secret
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as hetzner from '@pulumi/hetzner'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const serverType = config.get('serverType') || 'cx22'
const datacenter = config.get('datacenter') || 'nbg1-dc3'

const sshKeys = config.get('sshKeys') ? config.get('sshKeys')!.split(',').map(s => s.trim()) : []

const cloudInit = pulumi.interpolate`#cloud-config
package_update: true
packages:
  - docker.io

write_files:
  - path: /etc/docker/daemon.json
    content: '{"log-driver":"journald"}'

runcmd:
  - systemctl enable --now docker
  - mkfs.ext4 -F /dev/disk/by-id/scsi-0HC_Volume_caduceus-data || true
  - mkdir -p /data
  - mount /dev/disk/by-id/scsi-0HC_Volume_caduceus-data /data || true
  - mkdir -p /data/attachments
  - |
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

const volume = new hetzner.Volume('caduceus-data', {
  name: 'caduceus-data',
  size: 50,
  location: datacenter.replace(/-dc\d+$/, ''),
})

const server = new hetzner.Server('caduceus', {
  name: 'caduceus',
  serverType,
  image: 'ubuntu-24.04',
  datacenter,
  sshKeys,
  userData: cloudInit.apply(d => d),
})

// Attach volume
new hetzner.VolumeAttachment('caduceus-data-attach', {
  volumeId: volume.id,
  serverId: server.id,
})

// Firewall
const fw = new hetzner.Firewall('caduceus-fw', {
  name: 'caduceus',
  rules: [
    { direction: 'in', protocol: 'tcp', port: '8080', sourceIps: ['0.0.0.0/0', '::/0'] },
    { direction: 'in', protocol: 'tcp', port: '22', sourceIps: ['0.0.0.0/0', '::/0'] },
  ],
})

new hetzner.FirewallAttachment('caduceus-fw-attach', {
  firewallId: fw.id,
  serverIds: [server.id],
})

export const ipv4 = server.ipv4Address
export const websiteUrl = `http://${server.ipv4Address}:8080`
