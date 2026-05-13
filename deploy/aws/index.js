/**
 * HERMES AWS deployment for mail.del.ma.
 *
 * Provisions: Lambda function (container image), EFS for persistent mail storage,
 * Lambda Function URL, Route53 alias record, and CloudWatch log group.
 *
 * Security: Lambda runs in the default VPC with EFS mount. Secrets are injected
 * via environment variables (encrypted at rest by Lambda). The Function URL is
 * publicly accessible with auth handled by the application layer.
 *
 * Usage:
 *   cd deploy/aws
 *   pulumi stack select delma
 *   pulumi config set --secret hermes:jwtSecret <value>
 *   pulumi config set --secret hermes:webhookSecret <value>
 *   pulumi up
 */
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config('hermes')
const hostname = config.require('hostname')         // mail.del.ma
const mailDomain = config.require('mailDomain')      // del.ma
const zoneId = config.require('route53ZoneId')
const adminEmail = config.require('adminEmail')
const adminPhone = config.require('adminPhone')
const version = config.require('version')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')

const tags = {
  project: 'hermes',
  environment: 'production',
  domain: mailDomain,
  managedBy: 'pulumi',
}

// ── ECR repository ────────────────────────────────────────────────────────
const ecrRepo = new aws.ecr.Repository('hermes-lambda', {
  name: 'hermes/delma',
  imageTagMutability: 'MUTABLE',
  forceDelete: true,
  tags: { ...tags, Name: 'hermes-delma' },
})

// ── CloudWatch Logs ──────────────────────────────────────────────────────
const logGroup = new aws.cloudwatch.LogGroup('hermes-logs', {
  name: '/aws/lambda/hermes-delma',
  retentionInDays: 30,
  tags: { ...tags, Name: 'hermes-delma-logs' },
})

// ── IAM role ─────────────────────────────────────────────────────────────
const lambdaRole = new aws.iam.Role('hermes-lambda-role', {
  name: 'hermes-delma-lambda',
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' },
      Action: 'sts:AssumeRole',
    }],
  }),
  tags: { ...tags, Name: 'hermes-delma-role' },
})

// Basic execution + VPC + EFS access
const managedPolicies = [
  'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
  'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
  'arn:aws:iam::aws:policy/AmazonElasticFileSystemClientReadWriteAccess',
]
managedPolicies.forEach((policyArn, idx) => {
  new aws.iam.RolePolicyAttachment(`hermes-lambda-policy-${idx}`, {
    role: lambdaRole.name,
    policyArn,
  })
})

// SES + SNS permissions for mail delivery
new aws.iam.RolePolicy('hermes-lambda-ses-sns', {
  role: lambdaRole.id,
  policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['ses:SendEmail', 'ses:SendRawEmail', 'sesv2:SendEmail'], Resource: '*' },
      { Effect: 'Allow', Action: ['sns:Publish'], Resource: '*' },
    ],
  }),
})

// ── Network ──────────────────────────────────────────────────────────────
// Use the default VPC and subnets
const vpc = aws.ec2.getVpc({ default: true })
const subnets = aws.ec2.getSubnets({ filters: [{ name: 'vpc-id', values: [vpc.then(v => v.id)] }] })

const lambdaSg = new aws.ec2.SecurityGroup('hermes-lambda-sg', {
  vpcId: vpc.then(v => v.id),
  description: 'HERMES Lambda — EFS + outbound only',
  egress: [{ fromPort: 0, toPort: 0, protocol: '-1', cidrBlocks: ['0.0.0.0/0'], description: 'All outbound' }],
  tags: { ...tags, Name: 'hermes-delma-sg' },
})

// ── EFS ──────────────────────────────────────────────────────────────────
const efs = new aws.efs.FileSystem('hermes-efs', {
  creationToken: 'hermes-delma-efs',
  encrypted: true,
  tags: { ...tags, Name: 'hermes-delma-efs' },
})

const efsSg = new aws.ec2.SecurityGroup('hermes-efs-sg', {
  vpcId: vpc.then(v => v.id),
  description: 'HERMES EFS — NFS from Lambda',
  ingress: [{
    fromPort: 2049, toPort: 2049, protocol: 'tcp',
    securityGroups: [lambdaSg.id],
    description: 'NFS from Lambda',
  }],
  tags: { ...tags, Name: 'hermes-delma-efs-sg' },
})

// Mount targets in each subnet
const mountTargets = subnets.then(s => s.ids.map((subnetId, i) =>
  new aws.efs.MountTarget(`hermes-efs-mt-${i}`, {
    fileSystemId: efs.id,
    subnetId,
    securityGroups: [efsSg.id],
  })
))

// Access point for Lambda (uid/gid 65532 = Bun distroless user)
const accessPoint = new aws.efs.AccessPoint('hermes-efs-ap', {
  fileSystemId: efs.id,
  posixUser: { uid: 65532, gid: 65532 },
  rootDirectory: { path: '/data', creationInfo: { ownerUid: 65532, ownerGid: 65532, permissions: '755' } },
  tags: { ...tags, Name: 'hermes-delma-ap' },
})

// ── Lambda function ──────────────────────────────────────────────────────
const accountId = aws.getCallerIdentity({}).then(id => id.accountId)
const imageUri = pulumi.interpolate`${accountId}.dkr.ecr.ca-central-1.amazonaws.com/hermes/delma:${version}`

const lambda = new aws.lambda.Function('hermes', {
  name: 'hermes-delma',
  role: lambdaRole.arn,
  packageType: 'Image',
  imageUri,
  architectures: ['arm64'],
  timeout: 60,
  memorySize: 2048,
  reservedConcurrentExecutions: 1, // Fylo requires single-writer
  vpcConfig: {
    subnetIds: subnets.then(s => s.ids),
    securityGroupIds: [lambdaSg.id],
  },
  fileSystemConfig: {
    arn: accessPoint.arn,
    localMountPath: '/mnt/data',
  },
  environment: {
    variables: {
      HOME: '/tmp',
      YON_DIST_PATH: '/tmp/dist',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '8080',
      FYLO_ROOT: '/mnt/data',
      ATTACHMENT_ROOT: '/mnt/data/attachments',
      MAIL_DOMAIN: mailDomain,
      VAPID_SUBJECT: `mailto:postmaster@${mailDomain}`,
      JWT_SECRET: jwtSecret,
      INBOUND_WEBHOOK_SECRET: webhookSecret,
      EVENTS_WEBHOOK_SECRET: webhookSecret,
      SMS_ADAPTER: 'console',
      SMTP_ADAPTER: 'console',
      LOG_LEVEL: 'info',
    },
  },
  tags: { ...tags, Name: 'hermes-delma', Version: version },
})

// ── Function URL ─────────────────────────────────────────────────────────
const functionUrl = new aws.lambda.FunctionUrl('hermes-url', {
  functionName: lambda.name,
  authorizationType: 'NONE',
})

// ── DNS ──────────────────────────────────────────────────────────────────
const record = new aws.route53.Record('hermes-dns', {
  zoneId,
  name: hostname,
  type: 'A',
  aliases: [{
    name: functionUrl.functionUrl.apply(u => new URL(u).hostname),
    zoneId: functionUrl.functionUrl.apply(() => 'Z2Z2Z2Z2Z2Z2'), // Lambda URL alias zone (fixed by AWS)
    evaluateTargetHealth: false,
  }],
})

// ── Outputs ──────────────────────────────────────────────────────────────
export const functionUrlOutput = functionUrl.functionUrl
export const functionName = lambda.name
export const functionArn = lambda.arn
export const logGroupName = logGroup.name
export const ecrRepositoryUrl = ecrRepo.repositoryUrl
export const websiteUrl = `https://${hostname}`
