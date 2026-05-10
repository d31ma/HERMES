// @ts-check
export default class extends Tac {
  $step = 'start'
  $email = ''; $phone = ''; $otpCode = ''; $deviceCode = ''; $deviceName = ''
  $mfaSessionId = ''; $otpSessionId = ''; $setupToken = ''; $totpSecret = ''; $totpUri = ''
  $loading = false; $error = ''
  $providers = []

  get _api() { return window.HERMES_CONFIG?.apiUrl || '' }

  @onMount
  async fetchProviders() {
    try {
      const res = await fetch(`${this._api}/auth/oauth/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      if (res.ok) { const data = await res.json(); this.$providers = data.providers || [] }
    } catch { /* providers not available */ }
  }

  async initOAuth(provider) {
    this.$loading = true; this.$error = ''
    try {
      const res = await fetch(`${this._api}/auth/oauth/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }),
      })
      const data = await res.json()
      if (!res.ok) { this.$error = data.error || 'OAuth unavailable'; return }
      sessionStorage.setItem('hermes_oauth_state', data.state)
      sessionStorage.setItem('hermes_oauth_provider', provider)
      location.href = data.url
    } catch { this.$error = 'Network error. Check your connection.' }
    finally { this.$loading = false }
  }

  formValue(selector, fallback = '') {
    const value = typeof document !== 'undefined' ? document.querySelector(selector)?.value : ''
    return String(value ?? fallback ?? '').trim()
  }

  // ── Step: start → check if user has passkeys ─────────────────────────────
  async requestMfa() {
    this.$email = this.formValue('[data-login-email]', this.$email)
    if (!this.$email) { this.$error = 'Email is required.'; return }
    this.$loading = true; this.$error = ''
    try {
      const res = await fetch(`${this._api}/auth/webauthn/auth-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: this.$email }),
      })
      const data = await res.json()
      if (!res.ok) { this.$error = data.error || 'Unable to sign in.'; return }
      if (data.requiresSetup) {
        this.$step = 'phone-input'
      } else {
        this.$mfaSessionId = data.sessionId
        this.$step = 'passkey'
        // Trigger WebAuthn authentication
        await this.authenticatePasskey(data.options)
      }
    } catch { this.$error = 'Network error. Check your connection.' }
    finally { this.$loading = false }
  }

  // ── Step: passkey → biometric/PIN authentication ────────────────────────
  async authenticatePasskey(options) {
    try {
      if (typeof PublicKeyCredential === 'undefined') {
        this.$error = 'Passkeys not supported on this device.'
        this.$step = 'mfa'
        return
      }
      const credential = await navigator.credentials.get({ publicKey: options })
      this.$loading = true; this.$error = ''
      const res = await fetch(`${this._api}/auth/webauthn/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.$mfaSessionId, credential }),
      })
      const data = await res.json()
      if (!res.ok) {
        // If passkey not found, user might have TOTP devices — fallback
        this.$error = data.error || 'Authentication failed.'
        this.$step = 'start'
        return
      }
      this.emit('login', data)
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') {
        this.$error = 'Passkey authentication was cancelled.'
        this.$step = 'start'
      } else {
        this.$error = 'Passkey error: ' + (e.message || 'Unknown')
        this.$step = 'start'
      }
    }
    finally { this.$loading = false }
  }

  // ── Step: phone-input ────────────────────────────────────────────────────
  async requestSms() {
    this.$phone = this.formValue('[data-login-phone]', this.$phone)
    if (!this.$phone) { this.$error = 'Phone number is required.'; return }
    this.$loading = true; this.$error = ''
    try {
      const res = await fetch(`${this._api}/auth/sms/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: this.$email, phone: this.$phone }),
      })
      const data = await res.json()
      if (!res.ok) { this.$error = data.error || 'Unable to send code.'; return }
      this.$otpSessionId = data.sessionId; this.$step = 'phone-code'
    } catch { this.$error = 'Network error. Check your connection.' }
    finally { this.$loading = false }
  }

  // ── Step: phone-code ─────────────────────────────────────────────────────
  async confirmSms() {
    this.$otpCode = this.formValue('[data-login-otp]', this.$otpCode)
    if (!this.$otpCode || this.$otpCode.length !== 6) { this.$error = 'Enter the 6-digit code from your SMS.'; return }
    this.$loading = true; this.$error = ''
    try {
      const res = await fetch(`${this._api}/auth/sms/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: this.$otpSessionId, code: this.$otpCode }),
      })
      const data = await res.json()
      if (!res.ok) { this.$error = data.error || 'Invalid code.'; return }
      if (data.requiresSetup) {
        this.$setupToken = data.setupToken
        this.$step = 'passkey-setup'
        // Trigger passkey registration
        await this.registerPasskey()
      } else {
        this.emit('login', data)
      }
    } catch { this.$error = 'Network error. Check your connection.' }
    finally { this.$loading = false }
  }

  // ── Step: passkey-setup → register a new passkey ─────────────────────────
  async registerPasskey() {
    try {
      if (typeof PublicKeyCredential === 'undefined') {
        this.$error = 'Passkeys not supported on this device.'
        this.$step = 'start'
        return
      }
      this.$loading = true
      // Get registration options (requires auth token from SMS confirm)
      const setupData = this.$setupToken
        ? { setupToken: this.$setupToken }
        : {}

      const regRes = await fetch(`${this._api}/auth/webauthn/register-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setupData),
      })
      const regData = await regRes.json()
      if (!regRes.ok) { this.$error = regData.error || 'Registration failed.'; this.$step = 'start'; return }

      const credential = await navigator.credentials.create({ publicKey: regData.options })
      const saveRes = await fetch(`${this._api}/auth/webauthn/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credential),
      })
      const saveData = await saveRes.json()
      if (!saveRes.ok) { this.$error = saveData.error || 'Failed to save passkey.'; this.$step = 'start'; return }

      // Success — emit login if we have a setup token
      if (this.$setupToken) {
        this.emit('login', saveData)
      } else {
        this.$step = 'start'
        this.$error = ''
      }
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') {
        this.$error = 'Passkey registration was cancelled.'
      } else {
        this.$error = 'Passkey error: ' + (e.message || 'Unknown')
      }
    }
    finally { this.$loading = false }
  }

  usePhoneBackup() { this.$phone = ''; this.$otpCode = ''; this.$error = ''; this.$step = 'phone-input' }
  back() {
    this.$error = ''
    if (this.$step === 'passkey') { this.$step = 'start' }
    else if (this.$step === 'phone-input') { this.$phone = ''; this.$step = 'start' }
    else if (this.$step === 'phone-code') { this.$otpCode = ''; this.$step = 'phone-input' }
  }
}
