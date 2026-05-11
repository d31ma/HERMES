/**
 * Take screenshots of key pages to verify they aren't blank.
 * Starts the E2E preview + API servers, then captures each route.
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

// ── Start servers ─────────────────────────────────────────────────────────
const fyloRoot = join(projectRoot, '.screenshot-data')
const API_PORT = 19876
const PREVIEW_PORT = 3000

// API server
const apiServer = spawn('bun', [join(projectRoot, 'node_modules', '.bin', 'yon.serve')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    FYLO_ROOT: fyloRoot,
    JWT_SECRET: 'screenshot-test-secret',
    INBOUND_WEBHOOK_SECRET: 'screenshot-test-secret',
    HERMES_ENABLE_TEST_ROUTES: 'true',
    NODE_ENV: 'test',
    SMS_ADAPTER: 'console',
    SMTP_ADAPTER: 'console',
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
  },
})

// Preview server
const previewServer = spawn('bun', [join(projectRoot, 'node_modules', '.bin', 'tac.preview')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    YON_PREVIEW_PORT: String(PREVIEW_PORT),
  },
})

let shuttingDown = false
function cleanup(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  apiServer.kill('SIGTERM')
  previewServer.kill('SIGTERM')
  if (existsSync(fyloRoot)) rmSync(fyloRoot, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => cleanup(0))
process.on('SIGTERM', () => cleanup(0))

// Wait for servers
await new Promise(r => setTimeout(r, 5000))

// ── Playwright screenshots ────────────────────────────────────────────────
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })

const routes = [
  { path: '/', name: 'login', description: 'Login page — should show Sign in' },
  { path: '/compose', name: 'compose', description: 'Compose — redirect to login' },
  { path: '/settings', name: 'settings', description: 'Settings — redirect to login' },
  { path: '/inbox', name: 'inbox', description: 'Inbox — redirect to login' },
]

const API_URL = `http://127.0.0.1:${API_PORT}`

for (const route of routes) {
  const page = await browser.newPage()

  // Inject HERMES config so the page knows the API URL
  await page.addInitScript(apiUrl => {
    window.HERMES_CONFIG = { apiUrl }
  }, API_URL)

  const url = `http://127.0.0.1:${PREVIEW_PORT}${route.path}`
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
  } catch {
    // page may not fully load — still take screenshot
    await page.waitForTimeout(2000)
  }

  const filepath = join(screenshotDir, `${route.name}.png`)
  await page.screenshot({ path: filepath, fullPage: true })
  console.log(`${route.name}: ${url} → ${filepath}`)

  // Log page text content for quick validation
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 120) || '<empty body>')
  console.log(`  body: "${bodyText}"`)
  await page.close()
}

await browser.close()
cleanup(0)
