import { randomBytes } from "node:crypto"
import { r400, r401 } from "@/services/respond.js"
import { verifyJwt, getJwtSecret } from "@/services/auth.js"
import { buildRegistrationOptions } from "@/services/webauthn.js"
import { createDb } from "@/repositories/index.js"
import { listDevices, putSetupSession, findSetupSession } from "@/repositories/mfa.js"

/**
 * POST /auth/webauthn/register-request
 * Initiates WebAuthn passkey registration. Returns creation options for navigator.credentials.create().
 * @param {object} params
 * @param {object} [params.body] - Request payload, may contain setupToken for first-time setup
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const fylo = await createDb()

  // Try JWT auth first
  let claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret())

  // Fallback: accept setupToken from SMS confirm for first-time passkey registration
  const { setupToken } = body ?? {}
  if (!claims && setupToken) {
    const [sessionDocId, session] = await findSetupSession(fylo, setupToken)
    // @ts-ignore - session from Fylo inferred as string | Record<string, any>
    if (!session || !sessionDocId || new Date(session.expiresAt) < new Date()) {
      return r401("Invalid or expired setup token")
    }
    // @ts-ignore - session from Fylo; claims is overridden from JwtClaims to a subset
    claims = { email: session.email }
  }

  if (!claims) return r401("Authentication required")

  const existingDevices = await listDevices(fylo, claims.email)

  const { challenge, options } = buildRegistrationOptions(
    claims.email,
    claims.email.split("@")[0],
    // @ts-ignore - credentialId exists on WebAuthn devices stored in Fylo, not on MfaDevice type
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
