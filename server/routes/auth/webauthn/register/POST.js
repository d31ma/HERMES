import { r400, r401 } from "@/services/respond.js"
import { verifyJwt, getJwtSecret } from "@/services/auth.js"
import { verifyRegistration } from "@/services/webauthn.js"
import { createDb } from "@/repositories/index.js"
import { findUserByEmail } from "@/repositories/users.js"
import { putWebAuthnDevice } from "@/repositories/mfa.js"
import { randomBytes } from "node:crypto"

/**
 * POST /auth/webauthn/register
 * Completes WebAuthn passkey registration. Verifies the authenticator response and stores the credential.
 * @param {object} params
 * @param {object} params.body - The PublicKeyCredential from navigator.credentials.create()
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret())
  if (!claims) return r401("Authentication required")

  const credential = body
  if (!credential?.id || !credential?.response) {
    return r400("Invalid credential")
  }

  const fylo = await createDb()

  // Get the challenge from the most recent setup session
  const { collect } = await import("@/repositories/index.js")
  const sessions = await collect(
    fylo.findDocs("setup-sessions", { $ops: [{ email: { $eq: claims.email } }] }).collect()
  )
  const sessionEntry = Object.entries(sessions).find(([, s]) => s.totpSecret && new Date(s.expiresAt) > new Date())
  if (!sessionEntry) return r400("No active registration session found")
  const [, session] = sessionEntry

  const result = verifyRegistration(credential, session.totpSecret)
  if (!result.valid) return r400(result.error)

  // Store the WebAuthn credential
  const deviceId = randomBytes(16).toString("hex")
  await putWebAuthnDevice(fylo, {
    id: deviceId,
    userEmail: claims.email,
    name: credential.name || `Passkey ${new Date().toLocaleDateString()}`,
    credentialId: result.credentialId,
    publicKey: result.publicKey.toString("base64"),
    signCount: result.signCount,
  })

  // Clean up the setup session
  await fylo.delDoc("setup-sessions", sessionEntry[0])

  return {
    id: deviceId,
    credentialId: result.credentialId,
    name: credential.name || "Passkey",
  }
}
