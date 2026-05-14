/**
 * Enhanced DOM audit — captures structural details about each page.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(__dirname, '..')
const fyloRoot = mkdtempSync(join(tmpdir(), 'caduceus-audit-dom-'))
const PROXY_PORT = 9876, PREVIEW_PORT = 3000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Caduceus-Signature',
  'Access-Control-Max-Age': '86400',
}

const apiProc = spawn('bun', [join(projectRoot, 'node_modules', '.bin', 'yon.serve')], {
  cwd: projectRoot, stdio: 'ignore',
  env: { ...process.env, FYLO_ROOT: fyloRoot, JWT_SECRET: 'audit', INBOUND_WEBHOOK_SECRET: 'audit', EVENTS_WEBHOOK_SECRET: 'audit', CADUCEUS_ENABLE_TEST_ROUTES: 'true', NODE_ENV: 'test', SMS_ADAPTER: 'console', SMTP_ADAPTER: 'console', PORT: '9877', HOST: '127.0.0.1' },
})

let a = 0
while (!existsSync(join(projectRoot, 'dist', 'index.html')) && a++ < 60) await new Promise(r => setTimeout(r, 500))
await new Promise(r => setTimeout(r, 2000))

const proxy = Bun.serve({ port: PROXY_PORT, hostname: '127.0.0.1', async fetch(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(req.url)
  const r = await fetch(`http://127.0.0.1:9877${url.pathname}${url.search}`, { method: req.method, headers: req.headers, body: req.method !== 'GET' ? req.body : undefined })
  const h = new Headers(r.headers); for (const [k,v] of Object.entries(CORS)) h.set(k,v)
  return new Response(r.body, { status: r.status, headers: h })
}})

const previewProc = spawn('bun', [join(projectRoot, 'node_modules', '.bin', 'tac.preview')], {
  cwd: projectRoot, stdio: 'ignore', env: { ...process.env, YON_PREVIEW_PORT: String(PREVIEW_PORT) },
})
await new Promise(r => setTimeout(r, 2000))

// Seed and get JWT
let jwt = ''
try {
  const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/test/seed/user`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'audit@h.test', phones: ['+10000000000'], role: 'admin', domains: ['h.test'] }) })
  const d = await r.json()
  jwt = d.token || ''
} catch {}

const browser = await chromium.launch({ headless: true })

async function audit(name, path, { width = 1280, height = 800, auth = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.addInitScript(({ url, token }) => {
    window.CADUCEUS_CONFIG = { apiUrl: url }
    if (token) { sessionStorage.setItem('caduceus_token', token); sessionStorage.setItem('caduceus_email', 'audit@h.test'); sessionStorage.setItem('caduceus_role', 'admin'); sessionStorage.setItem('caduceus_domains', JSON.stringify(['h.test'])) }
  }, { url: `http://127.0.0.1:${PROXY_PORT}`, token: auth ? jwt : '' })

  try { await page.goto(`http://127.0.0.1:${PREVIEW_PORT}${path}`, { waitUntil: 'networkidle', timeout: 15000 }) } catch { await page.waitForTimeout(3000) }
  await page.waitForTimeout(2000)

  const info = await page.evaluate(() => {
    const count = (sel) => document.querySelectorAll(sel).length
    return {
      title: document.title,
      bodyLen: document.body?.innerHTML?.length || 0,
      bodyText: (document.body?.innerText || '').substring(0, 300).replace(/\n+/g, ' | '),
      sidebar: count('.app-sidebar'),
      sidebarItems: count('.sidebar-folder'),
      sidebarActive: document.querySelector('.sidebar-folder.active')?.textContent?.trim() || 'none',
      mailLayout: count('.mail-layout'),
      mailList: count('.mail-list-panel'),
      mailDetail: count('.mail-detail-panel'),
      mailDetailEmpty: count('.mail-detail-empty'),
      emailRows: count('.email-row'),
      emailRowSelected: count('.email-row.selected'),
      emailRowUnread: count('.email-row.unread'),
      loginCard: count('.login-card'),
      appShell: count('.app-shell'),
      appTopbar: count('.app-topbar'),
      mobileNav: count('.mobile-nav'),
      toolbarButtons: count('.email-toolbar md-text-button, .email-toolbar md-filled-tonal-button'),
      replyButton: !!document.querySelector('.email-toolbar')?.textContent?.includes('Reply'),
      forwardButton: !!document.querySelector('.email-toolbar')?.textContent?.includes('Forward'),
      settingsSections: count('.settings-section'),
      emptyState: count('.empty-state'),
      passkeyPrompt: count('.passkey-prompt'),
      topbarText: document.querySelector('.app-topbar')?.textContent?.trim().substring(0, 80) || 'none',
      visibleSidebar: !!document.querySelector('.app-sidebar') && getComputedStyle(document.querySelector('.app-sidebar')).display !== 'none',
      visibleMobileNav: !!document.querySelector('.mobile-nav') && getComputedStyle(document.querySelector('.mobile-nav')).display !== 'none',
    }
  })

  console.log(`\n=== ${name} (${width}x${height}) ===`)
  for (const [k, v] of Object.entries(info)) console.log(`  ${k}: ${JSON.stringify(v)}`)

  await page.close()
}

console.log('\n=== UNAUTHENTICATED DESKTOP ===')
await audit('Login', '/')
await audit('Settings redirect', '/settings')

console.log('\n=== UNAUTHENTICATED MOBILE ===')
await audit('Login mobile', '/', { width: 390, height: 844 })

if (jwt) {
  console.log('\n=== AUTHENTICATED DESKTOP ===')
  await audit('Inbox', '/inbox', { auth: true })
  await audit('Compose', '/compose', { auth: true })
  await audit('Settings', '/settings', { auth: true, waitMs: 3000 })
  await audit('Drafts', '/drafts', { auth: true })
  await audit('Sent', '/sent', { auth: true })
  await audit('Trash', '/trash', { auth: true })

  console.log('\n=== AUTHENTICATED MOBILE ===')
  await audit('Inbox mobile', '/inbox', { auth: true, width: 390, height: 844 })
  await audit('Compose mobile', '/compose', { auth: true, width: 390, height: 844 })
}

await browser.close()
proxy.stop(true)
apiProc.kill('SIGTERM')
previewProc.kill('SIGTERM')
rmSync(fyloRoot, { recursive: true, force: true })
process.exit(0)
