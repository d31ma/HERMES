// Floci integration tests for AWS SMS (SNS) and Email (SES) adapters.
// Run via: bun run test:floci
//
// Requires CADUCEUS + Floci running via docker-compose.
// The CADUCEUS_URL and AWS_ENDPOINT_URL env vars are set by docker-compose.

import { describe, it, expect, beforeAll } from 'bun:test'

const CADUCEUS_URL = process.env.CADUCEUS_URL || 'http://localhost:8080'
const AWS_URL = process.env.AWS_ENDPOINT_URL || process.env.LOCALSTACK_URL || 'http://localhost:4566'
const JWT_SECRET = process.env.JWT_SECRET || 'caduceus-local-test-secret'

// Helper: sign a JWT for admin access
import { signJwt } from '../../server/services/auth.js'

let adminToken
let testEmail

beforeAll(async () => {
  testEmail = `test-${Date.now()}@example.com`

  await waitForAwsEndpoint()

  // Verify email addresses in Floci SES (matches the AWS SES Query API).
  const fromAddress = 'admin@example.com'
  const verifyParams = new URLSearchParams({
    Action: 'VerifyEmailIdentity',
    Version: '2010-12-01',
    EmailAddress: fromAddress,
  })
  try {
    await awsQuery(verifyParams)
  } catch { /* non-critical */ }

  // Create admin token
  adminToken = signJwt(
    { email: 'admin@example.com', domains: ['example.com'], role: 'admin' },
    JWT_SECRET
  )

  // Create domain in CADUCEUS
  const domainRes = await fetch(`${CADUCEUS_URL}/domains`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      domain: 'example.com',
      routes: [{ id: 'r1', match: '*@example.com', action: { type: 'store' }, enabled: true }],
      inboundEnabled: true,
    }),
  })
  if (!domainRes.ok) {
    console.warn('Failed to create domain:', await domainRes.text())
  }

  // Create a test user
  await fetch(`${CADUCEUS_URL}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      email: testEmail,
      phones: ['+15551234567'],
      domains: ['example.com'],
      role: 'admin',
    }),
  })
}, 60000)

async function waitForAwsEndpoint() {
  const deadline = Date.now() + 30000
  let lastError
  while (Date.now() < deadline) {
    try {
      const params = new URLSearchParams({ Action: 'ListIdentities', Version: '2010-12-01' })
      const res = await awsQuery(params)
      if (res.ok || res.status < 500) return
      lastError = new Error(`AWS emulator returned ${res.status}`)
    } catch (err) {
      lastError = err
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw lastError || new Error('AWS emulator did not become ready')
}

async function awsQuery(params) {
  return await fetch(`${AWS_URL}/?${params.toString()}`, { method: 'POST' })
}

describe('AWS SMS adapter (SNS via Floci)', () => {
  it('sends SMS via Floci SNS', async () => {
    // Request SMS code
    const res = await fetch(`${CADUCEUS_URL}/auth/sms/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        phone: '+15551234567',
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(true)
  })

  it('accepts direct SNS Publish through the AWS Query API', async () => {
    const params = new URLSearchParams({
      Action: 'Publish',
      Version: '2010-03-31',
      PhoneNumber: '+15551234567',
      Message: 'direct floci sns smoke',
    })
    const res = await awsQuery(params)
    expect(res.status).toBeLessThan(500)
  })
})

describe('AWS SES adapter (SES via Floci)', () => {
  it('sends email via Floci SES', async () => {
    const sendRes = await fetch(`${CADUCEUS_URL}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        to: ['recipient@example.com'],
        subject: 'Floci SES Test',
        text: 'This email was sent via Floci SES adapter.',
      }),
    })

    expect(sendRes.status).toBe(200)
    const body = await sendRes.json()
    expect(typeof body.messageId).toBe('string')
  })

  it('lists SES identities through the AWS Query API', async () => {
    const params = new URLSearchParams({ Action: 'ListIdentities', Version: '2010-12-01' })
    const res = await awsQuery(params)
    expect(res.status).toBeLessThan(500)
  })
})

describe('CADUCEUS health checks', () => {
  it('returns ok on /health', async () => {
    const res = await fetch(`${CADUCEUS_URL}/health`)
    expect(res.status).toBe(200)
    const health = await res.json()
    expect(health.status).toBe('ok')
  })

  it('returns ready on /ready when secrets are set', async () => {
    const res = await fetch(`${CADUCEUS_URL}/ready`)
    expect(res.status).toBe(200)
  })

  it('creates and lists domains', async () => {
    const res = await fetch(`${CADUCEUS_URL}/domains`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(200)
    const domains = await res.json()
    expect(Array.isArray(domains)).toBe(true)
    expect(domains.length).toBeGreaterThan(0)
  })
})
