/**
 * E2E app interaction tests — runs against the real local API server.
 *
 * Each test seeds an isolated user and obtains a JWT via the SMS OTP flow.
 *
 * Run: bun run test:e2e
 */
import { test, expect } from '@playwright/test'
import { uniqueEmail, seedUser, seedDomain, deliverEmail, useTestApi, loginAs, getToken } from './helpers.mjs'

// ── Fixture: authenticated page ───────────────────────────────────────────────

async function withAuth(page, opts = {}) {
  const domain = opts.domain ?? `e2e-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.test`
  const email = opts.email ?? `test-${Date.now()}@${domain}`
  const userOpts = { domains: [domain], ...(opts.user ?? {}) }
  await seedUser(email, userOpts)
  const data = await getToken(email)
  await useTestApi(page)
  await loginAs(page, data.token, data.email, data.role, data.domains)
  return { email, token: data.token, domains: data.domains }
}

// Navigates to '/' and waits for the app screen to be visible.
async function gotoApp(page) {
  await page.goto('/')
  await expect(page.locator('.app-brand')).toBeVisible()
}

// ── Navigation ────────────────────────────────────────────────────────────────

test('shows app header after login', async ({ page }) => {
  const { email } = await withAuth(page)
  await gotoApp(page)
  await expect(page.locator('.app-user')).toContainText(email)
})

test('shows login screen when not authenticated', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/')
  await expect(page.getByText('Sign in')).toBeVisible()
})

test('Sign out returns to login screen', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Sign in')).toBeVisible()
})

// ── Inbox ─────────────────────────────────────────────────────────────────────

test('shows empty inbox message when no emails', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await expect(page.getByText(/No emails/)).toBeVisible()
})

test('401 response logs out and shows login screen', async ({ page }) => {
  await useTestApi(page)
  await page.addInitScript(() => {
    sessionStorage.setItem('caduceus_token', 'invalid-token')
    sessionStorage.setItem('caduceus_email', 'user@example.com')
    sessionStorage.setItem('caduceus_role', 'admin')
    sessionStorage.setItem('caduceus_domains', '["example.com"]')
  })
  await page.goto('/')
  await expect(page.getByText('Sign in')).toBeVisible()
})

test('searches inbox messages', async ({ page }) => {
  const { email, token, domains } = await withAuth(page)
  await seedDomain(token, domains[0])
  const key = `playwright-${Date.now()}`
  await deliverEmail({
    recipient: email,
    sender: 'billing@vendor.com',
    subject: `${key} Invoice`,
    body: 'blue searchable body',
    messageId: `${key}-invoice`,
  })
  await deliverEmail({
    recipient: email,
    sender: 'alerts@vendor.com',
    subject: `${key} Alert`,
    body: 'green hidden body',
    messageId: `${key}-alert`,
  })

  await gotoApp(page)
  await expect(page.getByText(`${key} Invoice`)).toBeVisible()
  await page.getByLabel('Search mail').fill('blue searchable')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText(`${key} Invoice`)).toBeVisible()
  await expect(page.getByText(`${key} Alert`)).not.toBeVisible()
})

test('uses mobile bottom navigation at phone widths', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await withAuth(page)
  await gotoApp(page)

  await expect(page.locator('.sidebar')).toBeHidden()
  const mobileNav = page.locator('.mobile-bottom-nav')
  await expect(mobileNav).toBeVisible()

  await mobileNav.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()

  await mobileNav.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.settings-panel .settings-section-title').filter({ hasText: 'Notifications' })).toBeVisible()

  await mobileNav.getByRole('button', { name: 'Inbox' }).click()
  await expect(page.getByText(/No emails/)).toBeVisible()
})

test('loads app pages directly from Tachyon routes', async ({ page }) => {
  await withAuth(page)

  await page.goto('/compose')
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()

  await page.goto('/settings')
  await expect(page.locator('.settings-panel .settings-section-title').filter({ hasText: 'Notifications' })).toBeVisible()

  await page.goto('/inbox')
  await expect(page.getByText(/No emails/)).toBeVisible()
})

test('loads an email detail page directly', async ({ page }) => {
  const { email, token, domains } = await withAuth(page)
  await seedDomain(token, domains[0])
  const key = `direct-${Date.now()}`
  const delivered = await deliverEmail({
    recipient: email,
    sender: 'news@example.com',
    subject: `${key} Direct route`,
    body: 'opened from a Tachyon page route',
    messageId: `${key}-message`,
  })

  await page.goto(`/email/${encodeURIComponent(delivered.emailId)}`)
  await expect(page.getByText(`${key} Direct route`)).toBeVisible()
  await expect(page.getByText('opened from a Tachyon page route')).toBeVisible()
})

test('protected app routes show login when unauthenticated', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/settings')
  await expect(page.getByText('Sign in')).toBeVisible()
})

// ── Compose ───────────────────────────────────────────────────────────────────

test('shows error when To or Subject is empty', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('To and Subject are required.')).toBeVisible()
})

test('opens compose via C keyboard shortcut', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.keyboard.press('c')
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()
})

test('Discard returns to inbox', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByText(/No emails/)).toBeVisible()
})

test('send succeeds and returns to inbox', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()
  await page.getByPlaceholder('recipient@example.com').fill('bob@example.com')
  await page.getByPlaceholder('Subject').fill('Test email')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(/No emails/)).toBeVisible()
})

// ── Settings ──────────────────────────────────────────────────────────────────

test('navigates to settings', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.settings-panel .settings-section-title').filter({ hasText: 'Routing Rules' })).toBeVisible()
})

test('can add a passkey from settings', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()

  // Click add passkey button
  await page.getByRole('button', { name: 'Add passkey' }).click()

  // The form should appear with a device name field
  await expect(page.getByLabel(/Device name/)).toBeVisible()
  await page.getByLabel(/Device name/).fill('Test Passkey')

  // WebAuthn registration requires a real authenticator in headful mode.
  // In headless CI, the browser's virtual authenticator can be used.
  // For now, verify the setup UI appears correctly.
  await expect(page.getByRole('button', { name: 'Register' })).toBeVisible()

  // Navigate back — settings should still be visible
  await page.getByText(/Back to settings/).click()
  await expect(page.locator('.settings-panel .settings-section-title').filter({ hasText: 'Notifications' })).toBeVisible()
})
