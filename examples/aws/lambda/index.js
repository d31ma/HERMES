/**
 * CADUCEUS on AWS Lambda (container image).
 *
 * Provisions: ECR repository, Lambda function (container image), EFS for
 * persistent mail storage, Lambda Function URL, Route53 alias record,
 * CloudWatch log group, and IAM roles with SES/SNS permissions.
 *
 * The Lambda runs in the default VPC with an EFS mount. Secrets are
 * injected via environment variables (encrypted at rest by Lambda).
 * The Function URL is publicly accessible — auth is handled by the
 * application layer.
 *
 * Usage:
 *   cd examples/aws/lambda
 *   pulumi stack init <stack-name>
 *   pulumi config set aws:region <region>
 *   pulumi config set caduceus:hostname <hostname>
 *   pulumi config set caduceus:mailDomain <domain>
 *   pulumi config set caduceus:route53ZoneId <zone-id>
 *   pulumi config set caduceus:adminEmail <email>
 *   pulumi config set caduceus:adminPhone <phone>
 *   pulumi config set caduceus:version <image-tag>
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
const adminEmail = config.require('adminEmail')
const adminPhone = config.require('adminPhone')
const version = config.require('version')
const jwtSecret = config.requireSecret('jwtSecret')
const webhookSecret = config.requireSecret('webhookSecret')
const region = config.get('awsRegion') || new pulumi.Config('aws').require('region')
const ecrName = config.get('ecrName') || 'caduceus/mail'

const tags = {
  project: 'caduceus',
  environment: 'production',
  domain: mailDomain,
  managedBy: 'pulumi',
}

// ── ECR repository ────────────────────────────────────────────────────────
const ecrRepo = new aws.ecr.Repository('caduceus-ecr', {
  name: ecrName,
  imageTagMutability: 'MUTABLE',
  forceDelete: true,
  tags: { ...tags, Name: 'caduceus-ecr' },
})

// ── CloudWatch Logs ──────────────────────────────────────────────────────
const logGroup = new aws.cloudwatch.LogGroup('caduceus-logs', {
  name: '/aws/lambda/caduceus',
  retentionInDays: 30,
  tags: { ...tags, Name: 'caduceus-logs' },
})

// ── IAM role ─────────────────────────────────────────────────────────────
const lambdaRole = new aws.iam.Role('caduceus-lambda-role', {
  name: 'caduceus-lambda',
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' },
      Action: 'sts:AssumeRole',
    }],
  }),
  tags: { ...tags, Name: 'caduceus-role' },
})

const managedPolicies = [
  'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
  'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
  'arn:aws:iam::aws:policy/AmazonElasticFileSystemClientReadWriteAccess',
]
managedPolicies.forEach((policyArn, idx) => {
  new aws.iam.RolePolicyAttachment(`caduceus-lambda-policy-${idx}`, {
    role: lambdaRole.name,
    policyArn,
  })
})

new aws.iam.RolePolicy('caduceus-lambda-ses-sns', {
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
const vpc = aws.ec2.getVpc({ default: true })
const subnets = aws.ec2.getSubnets({ filters: [{ name: 'vpc-id', values: [vpc.then(v => v.id)] }] })

const lambdaSg = new aws.ec2.SecurityGroup('caduceus-lambda-sg', {
  vpcId: vpc.then(v => v.id),
  description: 'CADUCEUS Lambda — EFS + outbound only',
  egress: [{ fromPort: 0, toPort: 0, protocol: '-1', cidrBlocks: ['0.0.0.0/0'], description: 'All outbound' }],
  tags: { ...tags, Name: 'caduceus-sg' },
})

// ── EFS ──────────────────────────────────────────────────────────────────
const efs = new aws.efs.FileSystem('caduceus-efs', {
  creationToken: 'caduceus-efs',
  encrypted: true,
  tags: { ...tags, Name: 'caduceus-efs' },
})

const efsSg = new aws.ec2.SecurityGroup('caduceus-efs-sg', {
  vpcId: vpc.then(v => v.id),
  description: 'CADUCEUS EFS — NFS from Lambda',
  ingress: [{
    fromPort: 2049, toPort: 2049, protocol: 'tcp',
    securityGroups: [lambdaSg.id],
    description: 'NFS from Lambda',
  }],
  tags: { ...tags, Name: 'caduceus-efs-sg' },
})

subnets.then(s => s.ids.map((subnetId, i) =>
  new aws.efs.MountTarget(`caduceus-efs-mt-${i}`, {
    fileSystemId: efs.id,
    subnetId,
    securityGroups: [efsSg.id],
  })
))

const accessPoint = new aws.efs.AccessPoint('caduceus-efs-ap', {
  fileSystemId: efs.id,
  posixUser: { uid: 65532, gid: 65532 },
  rootDirectory: { path: '/data', creationInfo: { ownerUid: 65532, ownerGid: 65532, permissions: '755' } },
  tags: { ...tags, Name: 'caduceus-ap' },
})

// ── Lambda function ──────────────────────────────────────────────────────
const accountId = aws.getCallerIdentity({}).then(id => id.accountId)
const imageUri = pulumi.interpolate`${accountId}.dkr.ecr.${region}.amazonaws.com/${ecrName}:${version}`

const lambda = new aws.lambda.Function('caduceus', {
  name: 'caduceus',
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
      SMS_ADAPTER: config.get('smsAdapter') || 'console',
      SMTP_ADAPTER: config.get('smtpAdapter') || 'console',
      LOG_LEVEL: config.get('logLevel') || 'info',
    },
  },
  tags: { ...tags, Name: 'caduceus', Version: version },
})

// ── Function URL ─────────────────────────────────────────────────────────
const functionUrl = new aws.lambda.FunctionUrl('caduceus-url', {
  functionName: lambda.name,
  authorizationType: 'NONE',
})

// ── DNS ──────────────────────────────────────────────────────────────────
new aws.route53.Record('caduceus-dns', {
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
