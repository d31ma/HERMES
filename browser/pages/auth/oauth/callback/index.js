// @ts-check

/**
 * OAuth callback handler page.
 *
 * Processes the OAuth2 authorization code redirect after the user authenticates
 * with an external provider. Validates the state parameter to prevent CSRF,
 * exchanges the authorization code for a session token via the API, and emits
 * a 'login' event so the root page can complete the sign-in flow.
 */
export default class extends Tac {
  /** @type {string} */
  $error = ''
  /** @type {boolean} */
  $loading = true

  /**
   * Handles the OAuth callback by extracting the authorization code and state
   * from the query string, validating them against session storage, and
   * exchanging them for an authenticated session via the API.
   *
   * @async
   * @returns {Promise<void>}
   */
  @onMount
  async handleCallback() {
    const params = new URLSearchParams(location.search)
    const code = params.get('code')
    const state = params.get('state')
    const savedState = sessionStorage.getItem('caduceus_oauth_state')
    const provider = sessionStorage.getItem('caduceus_oauth_provider')

    // Clean up session storage
    sessionStorage.removeItem('caduceus_oauth_state')
    sessionStorage.removeItem('caduceus_oauth_provider')

    if (!code || !state || !provider) {
      this.$error = 'Invalid OAuth callback — missing parameters.'
      this.$loading = false
      return
    }

    if (state !== savedState) {
      this.$error = 'OAuth state mismatch — possible CSRF attack.'
      this.$loading = false
      return
    }

    try {
      const apiUrl = window.CADUCEUS_CONFIG?.apiUrl || ''
      const res = await fetch(`${apiUrl}/auth/oauth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, code, state }),
      })

      const data = await res.json()
      if (!res.ok) {
        this.$error = data.error || 'OAuth login failed.'
        this.$loading = false
        return
      }

      // Emit login event — the root page handles it via @login handler
      // @ts-ignore
      this.emit('login', data)
    } catch {
      this.$error = 'Network error. Please try again.'
      this.$loading = false
    }
  }
}
