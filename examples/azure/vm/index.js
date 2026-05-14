/**
 * CADUCEUS on Azure Linux VM.
 *
 * Provisions: Resource Group, Virtual Network, Subnet, Network Security
 * Group, Public IP, Managed Disk for mail data, and an Ubuntu VM that
 * runs the CADUCEUS container from ghcr.io/d31ma/caduceus via Docker.
 *
 * The startup script installs Docker, mounts the managed disk at /data,
 * and starts CADUCEUS with restart-always.
 *
 * Usage:
 *   cd examples/azure/vm
 *   pulumi stack init <stack-name>
 *   pulumi config set azure-native:location <location>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as compute from '@pulumi/azure-native/compute'
import * as network from '@pulumi/azure-native/network'
import * as resources from '@pulumi/azure-native/resources'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'
const location = config.get('location') || new pulumi.Config('azure-native').require('location')
const vmSize = config.get('vmSize') || 'Standard_B2s'
const adminUser = config.get('adminUser') || 'caduceus'

const rg = new resources.ResourceGroup('caduceus-rg', {
  resourceGroupName: 'caduceus-rg',
  location,
})

// ── Networking ───────────────────────────────────────────────────────────
const vnet = new network.VirtualNetwork('caduceus-vnet', {
  resourceGroupName: rg.name,
  location: rg.location,
  addressSpace: { addressPrefixes: ['10.0.0.0/24'] },
})

const subnet = new network.Subnet('caduceus-subnet', {
  resourceGroupName: rg.name,
  virtualNetworkName: vnet.name,
  addressPrefix: '10.0.0.0/28',
})

const publicIp = new network.PublicIPAddress('caduceus-pip', {
  resourceGroupName: rg.name,
  location: rg.location,
  publicIPAllocationMethod: 'Static',
  dnsSettings: { domainNameLabel: hostname.replace(/\./g, '-') },
})

const nsg = new network.NetworkSecurityGroup('caduceus-nsg', {
  resourceGroupName: rg.name,
  location: rg.location,
  securityRules: [
    {
      name: 'HTTP',
      priority: 100,
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Tcp',
      sourcePortRange: '*',
      destinationPortRange: '8080',
      sourceAddressPrefix: '*',
      destinationAddressPrefix: '*',
    },
    {
      name: 'SSH',
      priority: 110,
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Tcp',
      sourcePortRange: '*',
      destinationPortRange: '22',
      sourceAddressPrefix: config.get('sshCidr') || '*',
      destinationAddressPrefix: '*',
    },
  ],
})

const nic = new network.NetworkInterface('caduceus-nic', {
  resourceGroupName: rg.name,
  location: rg.location,
  networkSecurityGroup: { id: nsg.id },
  ipConfigurations: [{
    name: 'ipconfig1',
    subnet: { id: subnet.id },
    publicIPAddress: { id: publicIp.id },
  }],
})

// ── Managed Disk ─────────────────────────────────────────────────────────
const disk = new compute.Disk('caduceus-data', {
  resourceGroupName: rg.name,
  location: rg.location,
  diskSizeGB: 50,
  sku: { name: 'StandardSSD_LRS' },
})

// ── VM ───────────────────────────────────────────────────────────────────
const startupScript = pulumi.interpolate`#!/bin/bash
set -euo pipefail

# Install Docker
apt-get update
apt-get install -y docker.io
systemctl enable --now docker

# Mount managed disk
mkfs.ext4 -F /dev/sdc || true
mkdir -p /data
mount /dev/sdc /data
echo '/dev/sdc /data ext4 defaults,nofail 0 2' >> /etc/fstab
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

new compute.VirtualMachine('caduceus', {
  resourceGroupName: rg.name,
  location: rg.location,
  networkProfile: { networkInterfaces: [{ id: nic.id }] },
  hardwareProfile: { vmSize },
  osProfile: {
    computerName: 'caduceus',
    adminUsername: adminUser,
    customData: Buffer.from(startupScript).toString('base64'),
    linuxConfiguration: {
      disablePasswordAuthentication: true,
      ssh: {
        publicKeys: config.get('sshKey') ? [{
          path: `/home/${adminUser}/.ssh/authorized_keys`,
          keyData: config.get('sshKey') || '',
        }] : [],
      },
    },
  },
  storageProfile: {
    osDisk: {
      createOption: 'FromImage',
      managedDisk: { storageAccountType: 'StandardSSD_LRS' },
    },
    imageReference: {
      publisher: 'canonical',
      offer: 'ubuntu-24_04-lts',
      sku: 'server',
      version: 'latest',
    },
    dataDisks: [{
      lun: 0,
      createOption: 'Attach',
      managedDisk: { id: disk.id },
    }],
  },
})

// ── Outputs ──────────────────────────────────────────────────────────────
export const publicIpAddress = publicIp.ipAddress
export const fqdn = publicIp.dnsSettings?.fqdn
export const websiteUrl = `http://${publicIp.ipAddress}:8080`
