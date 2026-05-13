import { r400 } from "@/services/respond.js"
import { buildAuthOptions } from "@/services/webauthn.js"
import { createDb } from "@/repositories/index.js"
import { findUserByEmail } from "@/repositories/users.js"
import { listDevices, putMfaSession, purgeExpiredMfaSessions } from "@/repositories/mfa.js"
import { checkRateLimit } from "@/services/rate-limit.js"
import { randomBytes } from "node:crypto"

/**
 * POST /auth/webauthn/auth-request
 * Starts WebAuthn passkey authentication. Returns request options for navigator.credentials.get().
 * @param {object} params
 * @param {{ email: string }} params.body - Request payload
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const { email } = body ?? {}
  if (!email) return r400("email required")

  const fylo = await createDb()
  const limit = await checkRateLimit(fylo, ["webauthn-auth", email.toLowerCase(), context.ipAddress], 20, 15 * 60 * 1000)
  if (!limit.allowed) return { error: "Too many sign-in attempts", retryAfterSeconds: limit.retryAfterSeconds, rateLimited: true }

  const [, user] = await findUserByEmail(fylo, email.toLowerCase())
  if (!user) return { error: "No account found", notFound: true }

  const devices = await listDevices(fylo, user.email)
  if (devices.length === 0) return { requiresSetup: true }

  await purgeExpiredMfaSessions(fylo, user.email)

  // @ts-ignore - credentialId exists on WebAuthn devices stored in Fylo, not on MfaDevice type
  const allowedCredentials = /** @type {Array<{ credentialId: string }>} */ (devices.filter(d => d.credentialId).map(d => ({ credentialId: d.credentialId })))
  const { challenge, options } = buildAuthOptions(allowedCredentials)

  // Store challenge in session for verification
  const sessionId = `webauthn-auth-${randomBytes(16).toString("hex")}`
  await putMfaSession(fylo, {
    id: sessionId,
    email: user.email,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    failedAttempts: 0,
    challenge,
  })

  return {
    challenge,
    options,
    sessionId,
  }
}
