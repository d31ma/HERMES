/**
 * CADUCEUS on AWS ECS Fargate.
 *
 * Provisions: VPC, ECS Fargate cluster + service, Application Load Balancer
 * (HTTPS), EFS for persistent mail storage, Secrets Manager, CloudWatch
 * logs, and IAM roles with SES/SNS permissions.
 *
 * The task runs the ghcr.io/d31ma/caduceus container image. EFS is mounted
 * at /data for durable Fylo and attachment storage across restarts.
 *
 * Usage:
 *   cd examples/aws/ecs-fargate
 *   pulumi stack init <stack-name>
 *   pulumi config set aws:region <region>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set caduceus:route53ZoneId <zone-id>
 *   pulumi config set caduceus:certificateArn <acm-cert-arn>
 *   pulumi config set caduceus:adminEmail <email>
 *   pulumi config set caduceus:adminPhone <phone>
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
const certificateArn = config.require('certificateArn')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const image = config.get('image') || 'ghcr.io/d31ma/caduceus:latest'

const tags = {
  project: 'caduceus',
  environment: 'production',
  domain: mailDomain,
  managedBy: 'pulumi',
}

// ── Networking ───────────────────────────────────────────────────────────
const vpc = aws.ec2.getVpc({ default: true })
const subnets = aws.ec2.getSubnets({ filters: [{ name: 'vpc-id', values: [vpc.then(v => v.id)] }] })

const sg = new aws.ec2.SecurityGroup('caduceus-sg', {
  name: 'caduceus-ecs',
  vpcId: vpc.then(v => v.id),
  ingress: [
    { fromPort: 8080, toPort: 8080, protocol: 'tcp', cidrBlocks: ['0.0.0.0/0'], description: 'HTTP from ALB' },
  ],
  egress: [{ fromPort: 0, toPort: 0, protocol: '-1', cidrBlocks: ['0.0.0.0/0'] }],
  tags: { ...tags, Name: 'caduceus-ecs-sg' },
})

// ── EFS ──────────────────────────────────────────────────────────────────
const efs = new aws.efs.FileSystem('caduceus-efs', {
  creationToken: 'caduceus-efs',
  encrypted: true,
  tags: { ...tags, Name: 'caduceus-efs' },
})

subnets.then(s => s.ids.map((subnetId, i) =>
  new aws.efs.MountTarget(`caduceus-efs-mt-${i}`, {
    fileSystemId: efs.id,
    subnetId,
    securityGroups: [sg.id],
  })
))

// ── Secrets ──────────────────────────────────────────────────────────────
const jwtSecretObj = new aws.secretsmanager.Secret('caduceus-jwt', {
  name: 'caduceus-jwt-secret',
  tags: { ...tags, Name: 'caduceus-jwt' },
})
new aws.secretsmanager.SecretVersion('caduceus-jwt-v', {
  secretId: jwtSecretObj.id,
  secretString: jwtSecret,
})

const inboundSecretObj = new aws.secretsmanager.Secret('caduceus-inbound', {
  name: 'caduceus-inbound-secret',
  tags: { ...tags, Name: 'caduceus-inbound' },
})
new aws.secretsmanager.SecretVersion('caduceus-inbound-v', {
  secretId: inboundSecretObj.id,
  secretString: webhookSecret,
})

// ── CloudWatch ───────────────────────────────────────────────────────────
const logGroup = new aws.cloudwatch.LogGroup('caduceus-logs', {
  name: '/ecs/caduceus',
  retentionInDays: 30,
  tags: { ...tags, Name: 'caduceus-logs' },
})

// ── IAM ──────────────────────────────────────────────────────────────────
const execRole = new aws.iam.Role('caduceus-exec', {
  name: 'caduceus-ecs-execution',
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'ecs-tasks.amazonaws.com' },
      Action: 'sts:AssumeRole',
    }],
  }),
  tags: { ...tags, Name: 'caduceus-exec-role' },
})
new aws.iam.RolePolicyAttachment('caduceus-exec-policy', {
  role: execRole.name,
  policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
})
new aws.iam.RolePolicyAttachment('caduceus-exec-secrets', {
  role: execRole.name,
  policyArn: 'arn:aws:iam::aws:policy/SecretsManagerReadWrite',
})

const taskRole = new aws.iam.Role('caduceus-task', {
  name: 'caduceus-ecs-task',
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'ecs-tasks.amazonaws.com' },
      Action: 'sts:AssumeRole',
    }],
  }),
  tags: { ...tags, Name: 'caduceus-task-role' },
})
new aws.iam.RolePolicy('caduceus-task-ses-sns', {
  role: taskRole.id,
  policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['ses:SendEmail', 'ses:SendRawEmail', 'sesv2:SendEmail'], Resource: '*' },
      { Effect: 'Allow', Action: ['sns:Publish'], Resource: '*' },
    ],
  }),
})

// ── ECS Cluster ──────────────────────────────────────────────────────────
const cluster = new aws.ecs.Cluster('caduceus-cluster', {
  name: 'caduceus-cluster',
  tags: { ...tags, Name: 'caduceus-cluster' },
})

// ── Task Definition ──────────────────────────────────────────────────────
const taskDef = new aws.ecs.TaskDefinition('caduceus-task', {
  family: 'caduceus',
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '512',
  memory: '1024',
  executionRoleArn: execRole.arn,
  taskRoleArn: taskRole.arn,
  containerDefinitions: JSON.stringify([{
    name: 'caduceus',
    image,
    portMappings: [{ containerPort: 8080, protocol: 'tcp' }],
    environment: [
      { name: 'FYLO_ROOT', value: '/data' },
      { name: 'ATTACHMENT_ROOT', value: '/data/attachments' },
      { name: 'MAIL_DOMAIN', value: mailDomain },
      { name: 'SMS_ADAPTER', value: config.get('smsAdapter') || 'console' },
      { name: 'SMTP_ADAPTER', value: config.get('smtpAdapter') || 'console' },
      { name: 'LOG_LEVEL', value: config.get('logLevel') || 'info' },
    ],
    secrets: [
      { name: 'JWT_SECRET', valueFrom: jwtSecretObj.arn },
      { name: 'INBOUND_WEBHOOK_SECRET', valueFrom: inboundSecretObj.arn },
      { name: 'EVENTS_WEBHOOK_SECRET', valueFrom: inboundSecretObj.arn },
    ],
    logConfiguration: {
      logDriver: 'awslogs',
      options: {
        'awslogs-group': logGroup.name,
        'awslogs-region': pulumi.output(aws.getRegion()).name,
        'awslogs-stream-prefix': 'caduceus',
      },
    },
    mountPoints: [{
      sourceVolume: 'caduceus-data',
      containerPath: '/data',
    }],
  }]),
  volumes: [{
    name: 'caduceus-data',
    efsVolumeConfiguration: { fileSystemId: efs.id },
  }],
  tags: { ...tags, Name: 'caduceus-task' },
})

// ── Load Balancer ────────────────────────────────────────────────────────
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
  targetType: 'ip',
  vpcId: vpc.then(v => v.id),
  healthCheck: { path: '/health', port: '8080' },
  tags: { ...tags, Name: 'caduceus-tg' },
})

new aws.lb.Listener('caduceus-https', {
  loadBalancerArn: alb.arn,
  port: 443,
  protocol: 'HTTPS',
  sslPolicy: 'ELBSecurityPolicy-2016-08',
  certificateArn,
  defaultActions: [{ type: 'forward', targetGroupArn: tg.arn }],
})

// Redirect HTTP → HTTPS
new aws.lb.Listener('caduceus-http', {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: 'HTTP',
  defaultActions: [{
    type: 'redirect',
    redirect: { protocol: 'HTTPS', port: '443', statusCode: 'HTTP_301' },
  }],
})

// ── ECS Service ──────────────────────────────────────────────────────────
const service = new aws.ecs.Service('caduceus-svc', {
  name: 'caduceus',
  cluster: cluster.id,
  taskDefinition: taskDef.arn,
  desiredCount: 1,
  launchType: 'FARGATE',
  networkConfiguration: {
    subnets: subnets.then(s => s.ids),
    securityGroups: [sg.id],
    assignPublicIp: true,
  },
  loadBalancers: [{
    targetGroupArn: tg.arn,
    containerName: 'caduceus',
    containerPort: 8080,
  }],
  tags: { ...tags, Name: 'caduceus-svc' },
})

// ── DNS ──────────────────────────────────────────────────────────────────
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

// ── Outputs ──────────────────────────────────────────────────────────────
export const albDnsName = alb.dnsName
export const serviceName = service.name
export const clusterName = cluster.name
export const logGroupName = logGroup.name
export const websiteUrl = `https://${hostname}`
