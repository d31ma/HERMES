/**
 * Comprehensive UI audit — screenshots of every page in both
 * unauthenticated and authenticated states.
 *
 * Uses the E2E test setup (CORS proxy) so API calls work from the browser.
 * Seeds an admin user via the test route, obtains a real JWT, and injects
 * it into sessionStorage before page load for authenticated captures.
 */
import { mkdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(__dirname, '..')
const auditDir = join(projectRoot, 'screenshots', 'audit')

if (existsSync(auditDir)) rmSync(auditDir, { recursive: true, force: true })
mkdirSync(auditDir, { recursive: true })

const fyloRoot = mkdtempSync(join(tmpdir(), 'caduceus-audit-'))
const PROXY_PORT = 9876
const API_PORT = 9877
const PREVIEW_PORT = 3000
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Caduceus-Signature',
  'Access-Control-Max-Age': '86400',
}

let shuttingDown = false
function cleanup(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  apiProc?.kill('SIGTERM')
  previewProc?.kill('SIGTERM')
  proxyProc?.stop(true)
  if (existsSync(fyloRoot)) rmSync(fyloRoot, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => cleanup(0))
process.on('SIGTERM', () => cleanup(0))

// ── Step 1: Start API server ────────────────────────────────────────────
console.log('Starting API server...')
const apiProc = spawn('bun', [join(projectRoot, 'node_modules', '.bin', 'yon.serve')], {
  cwd: projectRoot, stdio: 'inherit',
  env: {
    ...process.env, FYLO_ROOT: fyloRoot,
    JWT_SECRET: 'audit-secret', INBOUND_WEBHOOK_SECRET: 'audit-secret',
    EVENTS_WEBHOOK_SECRET: 'audit-events-secret',
    CADUCEUS_ENABLE_TEST_ROUTES: 'true', NODE_ENV: 'test',
    SMS_ADAPTER: 'console', SMTP_ADAPTER: 'console',
    PORT: String(API_PORT), HOST: '127.0.0.1',
  },
})

// Wait for bundle + server ready
let attempts = 0
while (!existsSync(join(projectRoot, 'dist', 'index.html')) && attempts++ < 60) {
  await new Promise(r => setTimeout(r, 500))
}
await new Promise(r => setTimeout(r, 3000))

// ── Step 2: CORS proxy ──────────────────────────────────────────────────
console.log('Starting CORS proxy...')
const proxyProc = Bun.serve({
  port: PROXY_PORT, hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    const url = new URL(req.url)
    const upstream = `http://127.0.0.1:${API_PORT}${url.pathname}${url.search}`
    try {
      const proxyReq = new Request(upstream, {
        method: req.method,
        headers: req.headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      })
      const res = await fetch(proxyReq)
      const resHeaders = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) resHeaders.set(k, v)
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: resHeaders })
    } catch (e) {
      return new Response(`Proxy error: ${e.message}`, { status: 502 })
    }
  },
})

// ── Step 3: Start preview server ─────────────────────────────────────────
console.log('Starting preview server...')
const previewProc = spawn('bun', [join(projectRoot, 'node_modules', '.bin', 'tac.preview')], {
  cwd: projectRoot, stdio: 'inherit',
  env: { ...process.env, YON_PREVIEW_PORT: String(PREVIEW_PORT) },
})
await new Promise(r => setTimeout(r, 2000))

const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`

// ── Step 4: Seed admin user and get JWT ──────────────────────────────────
console.log('Seeding admin user...')
let jwtToken = ''
let adminEmail = 'audit@caduceus.test'

try {
  // Create admin via test seed
  const seedResp = await fetch(`${PROXY_URL}/test/seed/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, phones: ['+10000000000'], role: 'admin', domains: ['caduceus.test'] }),
  })
  const seedData = await seedResp.json()
  console.log(`  seed: ${JSON.stringify(seedData)}`)

  if (seedData.token) {
    jwtToken = seedData.token
  } else {
    // Try the auth flow
    const authResp = await fetch(`${PROXY_URL}/auth/webauthn/auth-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail }),
    })
    const authData = await authResp.json()
    console.log(`  auth-request: ${JSON.stringify(authData)}`)
    if (authData.token) jwtToken = authData.token
  }
} catch (e) {
  console.log(`  seed/auth failed: ${e.message}`)
}

// ── Helpers ──────────────────────────────────────────────────────────────
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })

async function capture(name, urlPath, { width = 1280, height = 800, waitMs = 2000, auth = false, mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    // Use a persistent context so sessionStorage survives between auth captures
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().substring(0, 150)) })
  page.on('pageerror', err => errors.push(err.message.substring(0, 150)))

  // Inject CORS-friendly API URL (use proxy) and auth token
  await page.addInitScript(({ apiUrl, token, email, role }) => {
    window.CADUCEUS_CONFIG = { apiUrl }
    if (token) {
      sessionStorage.setItem('caduceus_token', token)
      sessionStorage.setItem('caduceus_email', email)
      sessionStorage.setItem('caduceus_role', role || 'admin')
      sessionStorage.setItem('caduceus_domains', JSON.stringify(['caduceus.test']))
    }
  }, { apiUrl: PROXY_URL, token: auth ? jwtToken : '', email: adminEmail, role: 'admin' })

  try {
    await page.goto(`${PREVIEW_URL}${urlPath}`, { waitUntil: 'networkidle', timeout: 15000 })
  } catch (e) {
    console.log(`    goto timeout: ${e.message.substring(0, 80)}`)
    await page.waitForTimeout(3000)
  }
  await page.waitForTimeout(waitMs)

  const filepath = join(auditDir, `${name}.png`)
  await page.screenshot({ path: filepath, fullPage: true })

  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '<empty>')
  const hasLogin = await page.evaluate(() => !!document.querySelector('.login-card'))
  const hasShell = await page.evaluate(() => !!document.querySelector('.app-shell'))
  console.log(`  ${name}: auth=${hasShell} login=${hasLogin} text="${bodyText.substring(0, 60).replace(/\n/g, ' ')}"`)
  if (errors.length) console.log(`    errors: [${errors.slice(0, 2).join(' | ')}]`)

  await ctx.close()
}

// ── Capture all pages ────────────────────────────────────────────────────

// Unauthenticated — desktop
console.log('\n=== Unauthenticated (Desktop) ===')
await capture('01-login', '/')
await capture('02-compose-redirect', '/compose')
await capture('03-settings-redirect', '/settings')
await capture('04-inbox-redirect', '/inbox')

// Unauthenticated — mobile
console.log('\n=== Unauthenticated (Mobile) ===')
await capture('05-login-mobile', '/', { width: 390, height: 844 })

// Authenticated — desktop
if (jwtToken) {
  console.log('\n=== Authenticated (Desktop) ===')
  await capture('06-inbox', '/inbox', { auth: true, waitMs: 3000 })
  await capture('07-compose', '/compose', { auth: true, waitMs: 2000 })
  await capture('08-settings', '/settings', { auth: true, waitMs: 3000 })

  // Authenticated — mobile
  console.log('\n=== Authenticated (Mobile) ===')
  await capture('09-inbox-mobile', '/inbox', { auth: true, width: 390, height: 844, waitMs: 3000 })
  await capture('10-compose-mobile', '/compose', { auth: true, width: 390, height: 844 })
  await capture('11-settings-mobile', '/settings', { auth: true, width: 390, height: 844, waitMs: 3000 })

  // Login-form states (different steps)
  console.log('\n=== Login Form States ===')
  await capture('12-login-oauth', '/', { width: 390, height: 844 })
} else {
  console.log('\n=== Skipping authenticated captures — no JWT ===')
}

await browser.close()
proxyProc.stop(true)
cleanup(0)
