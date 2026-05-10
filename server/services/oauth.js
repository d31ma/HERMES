import { createHash, randomBytes } from 'node:crypto'

/**
 * @typedef {'google' | 'microsoft' | 'apple'} OAuthProvider
 */

const PROVIDERS = /** @type {const} */ ({
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['openid', 'email', 'profile', 'User.Read'],
  },
  apple: {
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    scopes: ['name', 'email'],
  },
})

/** @param {OAuthProvider} provider */
function getConfig(provider) {
  const prefix = `OAUTH_${provider.toUpperCase()}`
  const clientId = process.env[`${prefix}_CLIENT_ID`]
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]
  const redirectUri = process.env[`${prefix}_REDIRECT_URI`] || process.env.OAUTH_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    return null
  }

  return {
    ...PROVIDERS[provider],
    clientId,
    clientSecret,
    redirectUri,
  }
}

/**
 * Generate a state token for CSRF protection.
 * @returns {string}
 */
export function generateOAuthState() {
  return randomBytes(32).toString('hex')
}

/**
 * Build the authorization URL for a provider.
 * @param {OAuthProvider} provider
 * @param {string} state
 * @returns {{ url: string } | { error: string }}
 */
export function getAuthorizationUrl(provider, state) {
  const config = getConfig(provider)
  if (!config) return { error: `${provider} OAuth is not configured` }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
  })

  if (provider === 'apple') {
    params.set('response_mode', 'form_post')
  }

  return { url: `${config.authUrl}?${params.toString()}` }
}

/**
 * Exchange an authorization code for tokens.
 * @param {OAuthProvider} provider
 * @param {string} code
 * @returns {Promise<{ accessToken: string, idToken?: string } | { error: string }>}
 */
export async function exchangeCode(provider, code) {
  const config = getConfig(provider)
  if (!config) return { error: `${provider} OAuth is not configured` }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })

  if (provider === 'apple') {
    body.set('client_secret', config.clientSecret)
  }

  try {
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const data = await res.json()
    if (data.error) return { error: data.error_description || data.error }
    return {
      accessToken: data.access_token,
      idToken: data.id_token,
    }
  } catch (e) {
    return { error: /** @type {Error} */(e).message }
  }
}

/**
 * Fetch the user's profile from the OAuth provider.
 * @param {OAuthProvider} provider
 * @param {string} accessToken
 * @returns {Promise<{ email: string, name?: string, sub: string } | { error: string }>}
 */
export async function getUserProfile(provider, accessToken) {
  const config = getConfig(provider)
  if (!config) return { error: `${provider} OAuth is not configured` }

  try {
    const res = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()
    if (data.error) return { error: data.error_description || data.error }

    // Normalize fields across providers
    if (provider === 'microsoft') {
      return {
        email: data.mail || data.userPrincipalName,
        name: data.displayName,
        sub: data.id,
      }
    }
    if (provider === 'google') {
      return {
        email: data.email,
        name: data.name,
        sub: data.sub,
      }
    }
    // Apple returns user info only on first login (in the id_token)
    // For subsequent logins, we extract from id_token
    return {
      email: data.email || '',
      sub: data.sub,
    }
  } catch (e) {
    return { error: /** @type {Error} */(e).message }
  }
}

/**
 * Check if a provider is configured (has env vars set).
 * @param {OAuthProvider} provider
 * @returns {boolean}
 */
function isProviderConfigured(provider) {
  return getConfig(provider) !== null
}

/**
 * Get a list of configured providers.
 * @returns {OAuthProvider[]}
 */
export function getConfiguredProviders() {
  return /** @type {OAuthProvider[]} */ (
    ['google', 'microsoft', 'apple'].filter(p => isProviderConfigured(p))
  )
}
