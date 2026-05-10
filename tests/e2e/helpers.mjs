/**
 * Shared helpers for Playwright E2E tests.
 * Handles: test server seeding via SMS OTP flow, and page setup.
 */
import { createHmac } from 'node:crypto'

export const API = 'http://localhost:9876'
const INBOUND_WEBHOOK_SECRET = 'hermes-e2e-inbound-secret'

// ── Unique test email ─────────────────────────────────────────────────────────

let _counter = 0

/** Returns a unique email address for each call — keeps tests independent. */
export function uniqueEmail() {
  return `test-${Date.now()}-${++_counter}@example.com`
}

// ── Test server seed helpers ──────────────────────────────────────────────────

async function post(path, data) {
  const headers = { 'Content-Type': 'application/json' }
  if (path === '/inbound/webhook') {
    const body = JSON.stringify(data ?? {})
    headers['X-Hermes-Signature'] = createHmac('sha256', INBOUND_WEBHOOK_SECRET).update(body).digest('hex')
  }
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Seed ${path} failed: ${await res.text()}`)
  return res.json()
}

/**
 * Creates a user in the test backend.
 */
export async function seedUser(email, { phones = ['+14165550100'], domains = ['example.com'], role = 'admin' } = {}) {
  await post('/test/seed/user', { email, phones, domains, role })
}

/**
 * Seeds an OTP session with a known code (no SMS sent).
 * Returns { sessionId, code } for the SMS confirm step.
 */
export async function seedOtp(email, phone = '+14165550100') {
  return post('/test/seed/otp', { email, phone })
}

export async function seedDomain(token, domain = 'example.com') {
  const res = await fetch(`${API}/domains`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      domain,
      routes: [{ id: `route-${Date.now()}`, match: `*@${domain}`, action: { type: 'store' }, enabled: true }],
      inboundEnabled: true,
    }),
  })
  if (!res.ok) throw new Error(`Seed domain failed: ${await res.text()}`)
  return res.json()
}

export async function deliverEmail({ recipient, sender = 'sender@other.com', subject, body = '', messageId }) {
  return post('/inbound/webhook', { recipient, sender, subject, body, messageId })
}

// ── Auth flow (SMS OTP) ──────────────────────────────────────────────────────

/**
 * Seeds a passkey device for a user (bypasses WebAuthn ceremony).
 * Only works in test mode — required for E2E tests in headless CI.
 */
export async function seedDevice(email, name = 'E2E Test Device') {
  return post('/test/seed/device', { email, name })
}

/**
 * Gets a JWT for a user via the SMS OTP login flow.
 * Seeds a passkey device first so the SMS confirm returns a JWT.
 */
export async function getToken(email, phone = '+14165550100') {
  // Seed a device so the user passes the has-device check
  await seedDevice(email)
  const { sessionId, code } = await seedOtp(email, phone)

  const r = await fetch(`${API}/auth/sms/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, code }),
  })
  const data = await r.json()
  if (!data.token) throw new Error(`getToken failed: ${JSON.stringify(data)}`)
  return data
}

// ── Page setup ────────────────────────────────────────────────────────────────

/**
 * Intercepts /assets/config.js to point the app at the local test server.
 * Must be called before page.goto().
 */
export async function useTestApi(page) {
  await page.addInitScript(() => {
    window.__HERMES_DISABLE_SW = true
  })
  await page.addInitScript(api => {
    window.HERMES_CONFIG = { apiUrl: api }
  }, API)
  await page.route('**/assets/config.js', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.HERMES_CONFIG={apiUrl:"${API}"};`,
    })
  )
}

/**
 * Seeds sessionStorage to simulate a logged-in user, bypassing the login flow.
 * Must be called before page.goto().
 */
export async function loginAs(page, token, email, role = 'admin', domains = ['example.com']) {
  await page.addInitScript(({ token, email, role, domains }) => {
    sessionStorage.setItem('hermes_token', token)
    sessionStorage.setItem('hermes_email', email)
    sessionStorage.setItem('hermes_role', role)
    sessionStorage.setItem('hermes_domains', JSON.stringify(domains))
  }, { token, email, role, domains })
}
