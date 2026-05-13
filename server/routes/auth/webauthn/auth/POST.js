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
  // @ts-ignore - session from Fylo inferred as Record<string, any>; MfaSession type is incomplete
  if (new Date(session.expiresAt) < new Date()) {
    await deleteMfaSession(fylo, docId)
    return r401("Session expired")
  }

  // @ts-ignore - session from Fylo
  if (!session.challenge) {
    await deleteMfaSession(fylo, docId)
    return r401("Invalid session")
  }

  // Find the WebAuthn device by credential ID
  const [deviceDocId, device] = await findDeviceByCredentialId(fylo, credential.id)
  if (!deviceDocId || !device || !device.publicKey) {
    // @ts-ignore - session from Fylo
    const failedAttempts = (session.failedAttempts ?? 0) + 1
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await deleteMfaSession(fylo, docId)
    } else {
      // @ts-ignore - docId narrowed from check above, TS doesn't track it
      await fylo.patchDoc(Collections.MFA_SESSIONS, { [docId]: { failedAttempts } })
    }
    return r401("Invalid passkey")
  }

  // Verify the WebAuthn assertion
  const result = await verifyAuthentication(
    credential,
    // @ts-ignore - session from Fylo
    session.challenge,
    Buffer.from(device.publicKey, "base64"),
    device.signCount ?? 0
  )

  if (!result.valid) {
    // @ts-ignore - session from Fylo
    const failedAttempts = (session.failedAttempts ?? 0) + 1
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await deleteMfaSession(fylo, docId)
    } else {
      // @ts-ignore - docId narrowed from check above
      await fylo.patchDoc(Collections.MFA_SESSIONS, { [docId]: { failedAttempts } })
    }
    return r401(result.error)
  }

  // Update sign count and clean up session
  await updateDeviceSignCount(fylo, deviceDocId, result.signCount)
  await deleteMfaSession(fylo, docId)

  // @ts-ignore - session from Fylo
  const [, user] = await findUserByEmail(fylo, session.email)
  const token = signJwt(
    // @ts-ignore - session from Fylo
    { email: session.email, domains: user?.domains ?? [], role: user?.role ?? "viewer" },
    getJwtSecret()
  )

  return {
    token,
    // @ts-ignore - session from Fylo
    email: session.email,
    role: user?.role ?? "viewer",
    domains: user?.domains ?? [],
  }
}
