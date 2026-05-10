/**
 * E2E login flow tests — runs against the real local API server.
 *
 * Tests the SMS-based login flow. WebAuthn passkey tests are skipped
 * in headless CI (requires CDP virtual authenticator support).
 *
 * Run: bun run test:e2e
 */
import { test, expect } from '@playwright/test'
import { uniqueEmail, seedUser, seedOtp, useTestApi } from './helpers.mjs'

// ── Start step ────────────────────────────────────────────────────────────────

test('shows email input on load', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/')
  await expect(page.getByText('Sign in')).toBeVisible()
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
})

test('shows error for unknown email', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('nobody@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(/Unable to sign in/)).toBeVisible()
})

test('shows error when email field is empty', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Email is required.')).toBeVisible()
})

// ── Phone-input step (no passkey registered yet) ──────────────────────────────

test('shows phone-input step for user with no device', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Phone verification')).toBeVisible()
})

test('Back from phone-input returns to email step', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Phone verification')).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
})

test('does not reveal whether a phone is linked to an account', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+19995550000')
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByText('Enter your code')).toBeVisible()
})

test('sends SMS and shows phone-code step', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByText('Enter your code')).toBeVisible()
})

// ── Phone-code step ───────────────────────────────────────────────────────────

test('shows passkey setup after correct SMS code (no passkey)', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  const { code } = await seedOtp(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill(code)
  await page.getByRole('button', { name: 'Verify' }).click()
  // After SMS confirm with no passkey device, triggers passkey registration
  await expect(page.getByText(/Passkey/)).toBeVisible()
})

test('shows error for wrong SMS code', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill('000000')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(/Invalid code/)).toBeVisible()
})
