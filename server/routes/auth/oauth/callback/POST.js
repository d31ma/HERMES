import { r400, r401 } from "@/services/respond.js"
import { signJwt, getJwtSecret } from "@/services/auth.js"
import { createDb } from "@/repositories/index.js"
import { findUserByEmail, putUser, normalizeUser } from "@/repositories/users.js"
import { exchangeCode, getUserProfile } from "@/services/oauth.js"

/**
 * POST /auth/oauth/callback
 * Exchanges OAuth authorization code for tokens, finds or creates user, issues JWT.
 * @param {object} params
 * @param {{ provider?: string, code?: string, state?: string }} params.body - Request payload
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body }) {
  const provider = /** @type {string} */ (body?.provider || '')
  const code = /** @type {string} */ (body?.code || '')
  const state = /** @type {string} */ (body?.state || '')

  if (!provider || !code || !state) {
    return r400('provider, code, and state are required')
  }

  if (!['google', 'microsoft', 'apple'].includes(provider)) {
    return r400('invalid provider')
  }

  // Exchange code for tokens
  // @ts-ignore - provider validated above, exchangeCode returns discriminated union
  const tokenResult = await exchangeCode(provider, code)
  // @ts-ignore - discriminated union: 'error' only exists on error variant
  if (tokenResult.error) return r400(tokenResult.error)

  // Get user profile from provider
  // @ts-ignore - provider validated above, getUserProfile returns discriminated union
  const profile = await getUserProfile(provider, tokenResult.accessToken)
  // @ts-ignore - discriminated union: 'error' only exists on error variant
  if (profile.error) return r400(profile.error)

  // @ts-ignore - discriminated union: 'email' only exists on success variant
  if (!profile.email) return r400('OAuth provider did not return an email address')

  // Find or create user
  const fylo = await createDb()
  // @ts-ignore - discriminated union: 'email' only exists on success variant
  const [, existingUser] = await findUserByEmail(fylo, profile.email)

  if (existingUser) {
    // Existing user — issue JWT
    const token = signJwt(
      { email: existingUser.email, domains: existingUser.domains, role: existingUser.role },
      getJwtSecret()
    )
    return {
      token,
      email: existingUser.email,
      role: existingUser.role,
      domains: existingUser.domains,
      isNew: false,
    }
  }

  // New user — create with viewer role, no domains
  const defaultDomain = process.env.OAUTH_DEFAULT_DOMAIN
  const domains = defaultDomain ? [defaultDomain] : []
  // @ts-ignore - discriminated union: 'email' only exists on success variant
  const newUser = normalizeUser({
    // @ts-ignore - discriminated union
    email: profile.email,
    phones: [],
    domains,
    role: 'viewer',
    aliases: [],
  })

  await putUser(fylo, newUser)

  const token = signJwt(
    { email: newUser.email, domains, role: 'viewer' },
    getJwtSecret()
  )

  return {
    token,
    email: newUser.email,
    role: 'viewer',
    domains,
    isNew: true,
  }
}
