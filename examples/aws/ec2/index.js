/**
 * CADUCEUS on AWS EC2 (standalone binary).
 *
 * Provisions: EC2 instance (ARM64 Amazon Linux 2023), security group,
 * EBS data volume for persistent mail storage, IAM instance profile
 * with SES/SNS permissions, systemd unit for the CADUCEUS binary, and
 * optional ALB + Route53 alias for production HTTPS.
 *
 * The user data script downloads the compiled CADUCEUS binary from S3
 * and installs it as a systemd service. For a simpler setup, use the
 * Docker variant which pulls from ghcr.io/d31ma/caduceus.
 *
 * Usage:
 *   cd examples/aws/ec2
 *   pulumi stack init <stack-name>
 *   pulumi config set aws:region <region>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set caduceus:route53ZoneId <zone-id>
 *   pulumi config set caduceus:deployBucket <s3-bucket-with-binary>
 *   pulumi config set --secret caduceus:jwtSecret <value>
 *   pulumi config set --secret caduceus:webhookSecret <value>
 *   pulumi up
 */
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('caduceus')
const hostname = config.require('hostname')
const mailDomain = config.require('mailDomain')
const zoneId = config.require('route53ZoneId')
const deployBucket = config.require('deployBucket')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const instanceType = config.get('instanceType') || 't4g.small'
const sshCidr = config.get('sshCidr') || ''
const useAlb = config.getBoolean('useAlb') || false
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'

const tags = {
  project: 'caduceus',
  environment: 'production',
  domain: mailDomain,
  managedBy: 'pulumi',
}

// ── AMI ──────────────────────────────────────────────────────────────────
const ami = aws.ec2.getAmi({
  mostRecent: true,
  filters: [{ name: 'name', values: ['al2023-ami-2023*-arm64'] }],
  owners: ['amazon'],
})

// ── Security Group ───────────────────────────────────────────────────────
const ingressRules = [
  { fromPort: 8080, toPort: 8080, protocol: 'tcp', cidrBlocks: ['0.0.0.0/0'], description: 'HTTP API' },
]
if (sshCidr) {
  ingressRules.push({ fromPort: 22, toPort: 22, protocol: 'tcp', cidrBlocks: [sshCidr], description: 'SSH' })
}

const sg = new aws.ec2.SecurityGroup('caduceus-sg', {
  name: 'caduceus-ec2',
  ingress: ingressRules,
  egress: [{ fromPort: 0, toPort: 0, protocol: '-1', cidrBlocks: ['0.0.0.0/0'] }],
  tags: { ...tags, Name: 'caduceus-ec2-sg' },
})

// ── IAM ──────────────────────────────────────────────────────────────────
const role = new aws.iam.Role('caduceus-ec2-role', {
  name: 'caduceus-ec2',
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'ec2.amazonaws.com' },
      Action: 'sts:AssumeRole',
    }],
  }),
  tags: { ...tags, Name: 'caduceus-ec2-role' },
})

new aws.iam.RolePolicyAttachment('caduceus-ssm', {
  role: role.name,
  policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
})

new aws.iam.RolePolicy('caduceus-ec2-policy', {
  role: role.id,
  policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['ses:SendEmail', 'ses:SendRawEmail', 'sesv2:SendEmail'], Resource: '*' },
      { Effect: 'Allow', Action: ['sns:Publish'], Resource: '*' },
      { Effect: 'Allow', Action: ['s3:GetObject'], Resource: `arn:aws:s3:::${deployBucket}/*` },
    ],
  }),
})

const profile = new aws.iam.InstanceProfile('caduceus-profile', {
  name: 'caduceus-ec2-profile',
  role: role.name,
})

// ── EC2 Instance ─────────────────────────────────────────────────────────
const secretEnvFile = pulumi.interpolate`cat > /opt/caduceus/.env << 'SECRETS'
JWT_SECRET=${jwtSecret}
INBOUND_WEBHOOK_SECRET=${webhookSecret}
EVENTS_WEBHOOK_SECRET=${webhookSecret}
SECRETS
chmod 600 /opt/caduceus/.env
chown caduceus:caduceus /opt/caduceus/.env
`

const userData = pulumi.interpolate`#!/bin/bash
set -euo pipefail
mkdir -p /opt/caduceus /data /data/attachments
useradd --system --create-home caduceus
chown -R caduceus:caduceus /data /data/attachments /opt/caduceus

# Download the compiled binary from S3
aws s3 cp s3://${deployBucket}/caduceus-linux-arm64 /opt/caduceus/caduceus
chmod +x /opt/caduceus/caduceus

${secretEnvFile}

cat > /etc/systemd/system/caduceus.service << 'UNIT'
[Unit]
Description=CADUCEUS mail server
After=network.target
[Service]
Type=simple
User=caduceus
Group=caduceus
WorkingDirectory=/opt/caduceus
Environment="FYLO_ROOT=/data"
Environment="ATTACHMENT_ROOT=/data/attachments"
Environment="MAIL_DOMAIN=${mailDomain}"
Environment="VAPID_SUBJECT=mailto:postmaster@${mailDomain}"
EnvironmentFile=/opt/caduceus/.env
ExecStart=/opt/caduceus/caduceus serve
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/data /opt/caduceus
UNIT

# Format and mount EBS data volume
DATA_DEVICE=""
for _ in $(seq 1 30); do
  DATA_DEVICE=$(lsblk -ndo NAME,TYPE,SIZE,MOUNTPOINT | awk '$2 == "disk" && $3 == "50G" && $4 == "" { print "/dev/" $1; exit }')
  [ -n "$DATA_DEVICE" ] && break
  sleep 2
done
if [ -z "$DATA_DEVICE" ]; then
  for candidate in /dev/nvme1n1 /dev/xvdf /dev/sdf; do
    [ -b "$candidate" ] && DATA_DEVICE="$candidate" && break
  done
fi
[ -n "$DATA_DEVICE" ] || { echo "Unable to find CADUCEUS data volume" >&2; exit 1; }
blkid "$DATA_DEVICE" >/dev/null 2>&1 || mkfs -t ext4 "$DATA_DEVICE"
mkdir -p /mnt/data
mount "$DATA_DEVICE" /mnt/data
DATA_UUID=$(blkid -s UUID -o value "$DATA_DEVICE")
echo "UUID=$DATA_UUID /mnt/data ext4 defaults,nofail 0 2" >> /etc/fstab

systemctl daemon-reload
systemctl enable --now caduceus
`

const instance = new aws.ec2.Instance('caduceus', {
  ami: ami.then(a => a.id),
  instanceType,
  vpcSecurityGroupIds: [sg.id],
  iamInstanceProfile: profile.name,
  rootBlockDevice: { volumeSize: 20, volumeType: 'gp3', encrypted: true },
  userData: userData.apply(d => Buffer.from(d).toString('base64')),
  userDataReplaceOnChange: true,
  tags: { ...tags, Name: 'caduceus-ec2', Version: config.get('version') || 'latest' },
})

// ── EBS Data Volume ──────────────────────────────────────────────────────
const dataVolume = new aws.ebs.Volume('caduceus-data', {
  availabilityZone: instance.availabilityZone,
  size: 50,
  type: 'gp3',
  encrypted: true,
  tags: { ...tags, Name: 'caduceus-data' },
})

new aws.ec2.VolumeAttachment('caduceus-data-attach', {
  deviceName: '/dev/sdf',
  volumeId: dataVolume.id,
  instanceId: instance.id,
})

// ── DNS / Load Balancer ──────────────────────────────────────────────────
if (useAlb) {
  const vpc = aws.ec2.getVpc({ default: true })
  const subnets = aws.ec2.getSubnets({ filters: [{ name: 'vpc-id', values: [vpc.then(v => v.id)] }] })

  const alb = new aws.lb.LoadBalancer('caduceus-alb', {
    name: 'caduceus-alb',
    internal: false,
    loadBalancerType: 'application',
    securityGroups: [sg.id],
    subnets: subnets.then(s => s.ids),
    tags: { ...tags, Name: 'caduceus-alb' },
  })

  const tg = new aws.lb.TargetGroup('caduceus-tg', {
    name: 'caduceus-tg',
    port: 8080,
    protocol: 'HTTP',
    targetType: 'instance',
    vpcId: vpc.then(v => v.id),
    healthCheck: { path: '/health', port: '8080' },
    tags: { ...tags, Name: 'caduceus-tg' },
  })

  new aws.lb.TargetGroupAttachment('caduceus-tg-attach', {
    targetGroupArn: tg.arn,
    targetId: instance.id,
    port: 8080,
  })

  const certificateArn = config.require('certificateArn')
  new aws.lb.Listener('caduceus-https', {
    loadBalancerArn: alb.arn,
    port: 443,
    protocol: 'HTTPS',
    certificateArn,
    defaultActions: [{ type: 'forward', targetGroupArn: tg.arn }],
  })

  new aws.route53.Record('caduceus-dns', {
    zoneId,
    name: hostname,
    type: 'A',
    aliases: [{
      name: alb.dnsName,
      zoneId: alb.zoneId,
      evaluateTargetHealth: true,
    }],
  })

  export const albDnsName = alb.dnsName
} else {
  // Direct DNS to instance public IP
  const eip = new aws.ec2.Eip('caduceus-eip', {
    instance: instance.id,
    tags: { ...tags, Name: 'caduceus-eip' },
  })

  new aws.route53.Record('caduceus-dns', {
    zoneId,
    name: hostname,
    type: 'A',
    ttl: 300,
    records: [eip.publicIp],
  })

  export const publicIp = eip.publicIp
}

// ── Outputs ──────────────────────────────────────────────────────────────
export const instanceId = instance.id
export const instanceArn = instance.arn
export const websiteUrl = `https://${hostname}`
