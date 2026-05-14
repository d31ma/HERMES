/**
 * Take screenshots of key pages to verify they aren't blank.
 * Starts the E2E API server first (which bundles the dist), applies patches,
 * then starts the preview server.
 *
 * Usage: bun scripts/screenshots.mjs
 * Output: screenshots/ directory
 */
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(__dirname, '..')
const screenshotDir = join(projectRoot, 'screenshots')

if (existsSync(screenshotDir)) rmSync(screenshotDir, { recursive: true })
mkdirSync(screenshotDir, { recursive: true })

const fyloRoot = join(projectRoot, '.screenshot-data')
const API_PORT = 19876
const PREVIEW_PORT = 3000

let shuttingDown = false
function cleanup(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  apiServer?.kill('SIGTERM')
  previewServer?.kill('SIGTERM')
  if (existsSync(fyloRoot)) rmSync(fyloRoot, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => cleanup(0))
process.on('SIGTERM', () => cleanup(0))

// ── Step 1: Start API server (bundles the dist) ──────────────────────────
const apiServer = spawn('bun', [join(projectRoot, 'node_modules', '.bin', 'yon.serve')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    FYLO_ROOT: fyloRoot,
    JWT_SECRET: 'screenshot-test-secret',
    INBOUND_WEBHOOK_SECRET: 'screenshot-test-secret',
    CADUCEUS_ENABLE_TEST_ROUTES: 'true',
    NODE_ENV: 'test',
    SMS_ADAPTER: 'console',
    SMTP_ADAPTER: 'console',
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
  },
})

// Wait for bundle to complete (dist appears + API server is ready)
let attempts = 0
while (!existsSync(join(projectRoot, 'dist', 'index.html')) && attempts++ < 60) {
  await new Promise(r => setTimeout(r, 500))
}
if (attempts >= 60) throw new Error('Timeout waiting for bundle to complete')
// Extra wait for bundle to fully complete
await new Promise(r => setTimeout(r, 2000))

// ── Step 2: Start preview server ──────────────────────────────────────────
const previewServer = spawn('bun', [join(projectRoot, 'node_modules', '.bin', 'tac.preview')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, YON_PREVIEW_PORT: String(PREVIEW_PORT) },
})
await new Promise(r => setTimeout(r, 2000))

// ── Playwright screenshots ────────────────────────────────────────────────
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })

const routes = [
  { path: '/', name: 'login', description: 'Login page' },
  { path: '/compose', name: 'compose', description: 'Compose' },
  { path: '/settings', name: 'settings', description: 'Settings' },
  { path: '/inbox', name: 'inbox', description: 'Inbox' },
]

const API_URL = `http://127.0.0.1:${API_PORT}`

for (const route of routes) {
  const page = await browser.newPage()
  const errors = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text().substring(0, 200))
  })
  page.on('pageerror', err => errors.push(err.message.substring(0, 200)))

  await page.addInitScript(apiUrl => {
    window.CADUCEUS_CONFIG = { apiUrl }
  }, API_URL)

  const url = `http://127.0.0.1:${PREVIEW_PORT}${route.path}`
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
  } catch (err) {
    console.error(`  Failed to load ${url}: ${err.message}`)
    await page.waitForTimeout(3000)
  }
  await page.waitForTimeout(2000)

  const filepath = join(screenshotDir, `${route.name}.png`)
  await page.screenshot({ path: filepath, fullPage: true })
  console.log(`${route.name}: ${url} -> ${filepath}`)

  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '<empty body>')
  console.log(`  body: "${bodyText}"`)
  if (errors.length) console.log(`  errors: [${errors.join(' | ')}]`)
  await page.close()
}

await browser.close()
cleanup(0)
