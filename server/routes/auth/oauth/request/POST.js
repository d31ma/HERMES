import { r400 } from "@/services/respond.js"
import { generateOAuthState, getAuthorizationUrl, getConfiguredProviders } from "@/services/oauth.js"

/**
 * POST /auth/oauth/request
 * Returns OAuth authorization URL for a provider, or lists configured providers.
 * @param {object} params
 * @param {{ provider?: string }} params.body - Request payload
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body }) {
  const provider = /** @type {string} */ (body?.provider || '')

  // If no provider specified, return list of configured providers
  if (!provider) {
    return { providers: getConfiguredProviders() }
  }

  if (!['google', 'microsoft', 'apple'].includes(provider)) {
    return r400('provider must be google, microsoft, or apple')
  }

  const state = generateOAuthState()
  const result = getAuthorizationUrl(provider, state)

  if (result.error) return r400(result.error)

  return {
    url: result.url,
    state,
  }
}
