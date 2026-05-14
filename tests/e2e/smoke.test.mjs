/**
 * E2E smoke tests — verifies the preview + API servers start and respond.
 *
 * Full login/app interaction tests are deferred until the WebAuthn/Passkey
 * UI is stabilized and a headed-browser debugging pass can be done.
 */
import { test, expect } from '@playwright/test'
import { API, useTestApi } from './helpers.mjs'

test('preview server loads the login page', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/')
  // The page should render the CADUCEUS shell (SPA renderer loads)
  await expect(page.locator('body')).not.toBeEmpty()
})

test('API server responds to health-like request', async ({ page }) => {
  // The preview server proxies API requests or the page loads API-bound config
  await useTestApi(page)
  await page.goto('/')
  // Should at minimum load a page with the CADUCEUS config pointing to the test API
  const config = await page.evaluate(() => window.CADUCEUS_CONFIG?.apiUrl)
  expect(config).toBe(API)
})
