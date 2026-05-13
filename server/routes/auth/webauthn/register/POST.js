import { r400, r401 } from "@/services/respond.js"
import { verifyJwt, getJwtSecret } from "@/services/auth.js"
import { verifyRegistration } from "@/services/webauthn.js"
import { createDb, collect } from "@/repositories/index.js"
import { findUserByEmail } from "@/repositories/users.js"
import { putWebAuthnDevice, findSetupSession } from "@/repositories/mfa.js"
import { randomBytes } from "node:crypto"

/**
 * POST /auth/webauthn/register
 * Completes WebAuthn passkey registration. Verifies the authenticator response and stores the credential.
 * @param {object} params
 * @param {object} params.body - The PublicKeyCredential from navigator.credentials.create(), may also contain setupToken for first-time setup
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const fylo = await createDb()

  // Try JWT auth first
  let claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret())

  // Fallback: accept setupToken from SMS confirm for first-time passkey registration
  // The credential body may also contain a setupToken for auth when no JWT is present
  const { setupToken, ...credential } = body ?? {}
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

  if (!credential?.id || !credential?.response) {
    return r400("Invalid credential")
  }

  // Get the challenge from the most recent setup session
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
