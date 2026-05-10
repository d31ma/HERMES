import { randomBytes } from "node:crypto"
import { r400, r401 } from "@/services/respond.js"
import { verifyJwt, getJwtSecret } from "@/services/auth.js"
import { buildRegistrationOptions } from "@/services/webauthn.js"
import { createDb } from "@/repositories/index.js"
import { listDevices, putSetupSession } from "@/repositories/mfa.js"

/**
 * POST /auth/webauthn/register-request
 * Initiates WebAuthn passkey registration. Returns creation options for navigator.credentials.create().
 * @param {object} params
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret())
  if (!claims) return r401("Authentication required")

  const fylo = await createDb()
  const existingDevices = await listDevices(fylo, claims.email)

  const { challenge, options } = buildRegistrationOptions(
    claims.email,
    claims.email.split("@")[0],
    existingDevices.map(d => ({ credentialId: d.credentialId || d.id }))
  )

  // Store challenge in a setup session for verification
  await putSetupSession(fylo, {
    id: `webauthn-register-${randomBytes(16).toString("hex")}`,
    email: claims.email,
    totpSecret: challenge,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  })

  return {
    challenge,
    options,
  }
}
