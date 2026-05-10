// @ts-check
export default class extends Tac {
  $error = ''
  $loading = true

  @onMount
  async handleCallback() {
    const params = new URLSearchParams(location.search)
    const code = params.get('code')
    const state = params.get('state')
    const savedState = sessionStorage.getItem('hermes_oauth_state')
    const provider = sessionStorage.getItem('hermes_oauth_provider')

    // Clean up session storage
    sessionStorage.removeItem('hermes_oauth_state')
    sessionStorage.removeItem('hermes_oauth_provider')

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
      const apiUrl = window.HERMES_CONFIG?.apiUrl || ''
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
      this.emit('login', data)
    } catch {
      this.$error = 'Network error. Please try again.'
      this.$loading = false
    }
  }
}
