import { r400, r401 } from "@/services/respond.js"
import { signJwt, getJwtSecret } from "@/services/auth.js"
import { verifyAuthentication } from "@/services/webauthn.js"
import { createDb, Collections } from "@/repositories/index.js"
import { findUserByEmail } from "@/repositories/users.js"
import { findMfaSession, deleteMfaSession, findDeviceByCredentialId, updateDeviceSignCount } from "@/repositories/mfa.js"

const MAX_FAILED_ATTEMPTS = 5

/**
 * POST /auth/webauthn/auth
 * Completes WebAuthn passkey authentication. Verifies the authenticator response and issues a JWT.
 * @param {object} params
 * @param {{ sessionId: string, credential: object }} params.body - Request payload
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const { sessionId, credential } = body ?? {}
  if (!sessionId || !credential) return r400("sessionId and credential required")

  const fylo = await createDb()

  const [docId, session] = await findMfaSession(fylo, sessionId)
  if (!session || !docId) return r401("Invalid or expired session")
  if (new Date(session.expiresAt) < new Date()) {
    await deleteMfaSession(fylo, docId)
    return r401("Session expired")
  }

  if (!session.challenge) {
    await deleteMfaSession(fylo, docId)
    return r401("Invalid session")
  }

  // Find the WebAuthn device by credential ID
  const [deviceDocId, device] = await findDeviceByCredentialId(fylo, credential.id)
  if (!deviceDocId || !device || !device.publicKey) {
    const failedAttempts = (session.failedAttempts ?? 0) + 1
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await deleteMfaSession(fylo, docId)
    } else {
      await fylo.patchDoc(Collections.MFA_SESSIONS, { [docId]: { failedAttempts } })
    }
    return r401("Invalid passkey")
  }

  // Verify the WebAuthn assertion
  const result = await verifyAuthentication(
    credential,
    session.challenge,
    Buffer.from(device.publicKey, "base64"),
    device.signCount ?? 0
  )

  if (!result.valid) {
    const failedAttempts = (session.failedAttempts ?? 0) + 1
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await deleteMfaSession(fylo, docId)
    } else {
      await fylo.patchDoc(Collections.MFA_SESSIONS, { [docId]: { failedAttempts } })
    }
    return r401(result.error)
  }

  // Update sign count and clean up session
  await updateDeviceSignCount(fylo, deviceDocId, result.signCount)
  await deleteMfaSession(fylo, docId)

  const [, user] = await findUserByEmail(fylo, session.email)
  const token = signJwt(
    { email: session.email, domains: user?.domains ?? [], role: user?.role ?? "viewer" },
    getJwtSecret()
  )

  return {
    token,
    email: session.email,
    role: user?.role ?? "viewer",
    domains: user?.domains ?? [],
  }
}
