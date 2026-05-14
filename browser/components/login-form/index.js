// @ts-check

/**
 * Multi-step authentication / login component.
 *
 * Implements a step-based login flow that supports:
 * - OAuth provider selection (Google, Microsoft, etc.)
 * - WebAuthn / passkey authentication
 * - SMS / phone-based OTP as a backup factor
 * - Passkey registration for first-time setup
 *
 * The flow progresses through these steps:
 * 1. `start` — Email input, OAuth provider buttons, and passkey detection
 * 2. `passkey` — Biometric / PIN-based WebAuthn authentication
 * 3. `phone-input` — Phone number entry for SMS fallback
 * 4. `phone-code` — 6-digit SMS code verification
 * 5. `passkey-setup` — Register a new passkey after SMS confirmation
 *
 * On successful authentication, emits a `login` event with the server response
 * data so the parent app can store the session and redirect.
 *
 * @extends Tac
 */
export default class extends Tac {
  /** @type {string} Current step in the login flow */
  $step = 'start'
  /** @type {string} */
  $email = ''; /** @type {string} */
  $phone = ''; /** @type {string} */
  $otpCode = ''; /** @type {string} */
  $deviceCode = ''; /** @type {string} */
  $deviceName = ''
  /** @type {string} WebAuthn session ID from `/auth/webauthn/auth-request` */
  $mfaSessionId = ''; /** @type {string} SMS OTP session ID from `/auth/sms/request` */
  $otpSessionId = ''; /** @type {string} Setup token for passkey registration */
  $setupToken = ''; /** @type {string} TOTP secret for QR-based authenticator setup */
  $totpSecret = ''; /** @type {string} TOTP URI (otpauth://) for QR code rendering */
  $totpUri = ''
  /** @type {boolean} */
  $loading = false; /** @type {string} */
  $error = ''
  /** @type {Array<{ id: string, name: string }>} Available OAuth identity providers */
  $providers = []

  /**
   * @description Base API URL from the global CADUCEUS_CONFIG.
   * @returns {string}
   */
  get _api() { return window.CADUCEUS_CONFIG?.apiUrl || '' }

  /**
   * Fetch the list of available OAuth identity providers on mount.
   *
   * @async
   * @returns {Promise<void>}
   */
  @onMount
  async fetchProviders() {
    try {
      const res = await fetch(`${this._api}/auth/oauth/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      if (res.ok) { const data = await res.json(); this.$providers = data.providers || [] }
    } catch { /* providers not available */ }
  }

  /**
   * Initiate an OAuth login flow with a specific provider.
   *
   * Fetches an authorization URL from the API and redirects the browser to the
   * provider's consent screen. The OAuth state and provider are stored in
   * sessionStorage for the callback.
   *
   * @async
   * @param {string} provider - The OAuth provider ID (e.g. 'google', 'microsoft')
   * @returns {Promise<void>}
   */
  async initOAuth(provider) {
    this.$loading = true; this.$error = ''
    try {
      const res = await fetch(`${this._api}/auth/oauth/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }),
      })
      const data = await res.json()
      if (!res.ok) { this.$error = data.error || 'OAuth unavailable'; return }
      sessionStorage.setItem('caduceus_oauth_state', data.state)
      sessionStorage.setItem('caduceus_oauth_provider', provider)
      location.href = data.url
    } catch { this.$error = 'Network error. Check your connection.' }
    finally { this.$loading = false }
  }

  /**
   * Read the current value of a form input by CSS selector.
   *
   * Safe to call server-side (returns empty string when `document` is undefined).
   *
   * @param {string} selector - CSS selector for the input element
   * @param {string} [fallback=''] - Fallback value when the element is not found
   * @returns {string} The trimmed input value, or the fallback
   */
  formValue(selector, fallback = '') {
    const value = typeof document !== 'undefined' ? /** @type {HTMLInputElement} */ (document.querySelector(selector))?.value : ''
    return String(value ?? fallback ?? '').trim()
  }

  // ── Step: start → check if user has passkeys ─────────────────────────────

  /**
   * Begin the login process: submit the email address and check for passkeys.
   *
   * If the user has passkeys registered, the flow advances to the `passkey`
   * step and triggers WebAuthn authentication. Otherwise it falls through to
   * `phone-input` for SMS-based authentication.
   *
   * @async
   * @returns {Promise<void>}
   */
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

  /**
   * Perform WebAuthn authentication using the provided public-key credential
   * options.
   *
   * On success, emits a `login` event. On failure, the flow resets to `start`
   * so the user can try an alternative method.
   *
   * @async
   * @param {PublicKeyCredentialRequestOptions} options - WebAuthn get() options from the server
   * @returns {Promise<void>}
   */
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
      // @ts-ignore
      this.emit('login', data)
    } catch (e) {
      if (/** @type {Error} */ (e).name === 'NotAllowedError' || /** @type {Error} */ (e).name === 'AbortError') {
        this.$error = 'Passkey authentication was cancelled.'
        this.$step = 'start'
      } else {
        this.$error = 'Passkey error: ' + (e instanceof Error ? e.message : String(e) || 'Unknown')
        this.$step = 'start'
      }
    }
    finally { this.$loading = false }
  }

  // ── Step: phone-input ────────────────────────────────────────────────────

  /**
   * Request an SMS OTP code to the user's phone number.
   *
   * Advances to the `phone-code` step on success.
   *
   * @async
   * @returns {Promise<void>}
   */
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

  /**
   * Confirm the 6-digit SMS OTP code.
   *
   * If the user does not yet have a passkey registered, the flow advances to
   * `passkey-setup` and triggers passkey registration. Otherwise, a `login`
   * event is emitted.
   *
   * @async
   * @returns {Promise<void>}
   */
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
        // @ts-ignore
        this.emit('login', data)
      }
    } catch { this.$error = 'Network error. Check your connection.' }
    finally { this.$loading = false }
  }

  // ── Step: passkey-setup → register a new passkey ─────────────────────────

  /**
   * Register a new WebAuthn passkey for the authenticated user.
   *
   * If called with a `$setupToken` (from SMS confirmation), the registration
   * is pre-authorised. On success, emits a `login` event to complete the flow.
   *
   * @async
   * @returns {Promise<void>}
   */
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
        // @ts-ignore
        this.emit('login', saveData)
      } else {
        this.$step = 'start'
        this.$error = ''
      }
    } catch (e) {
      if (/** @type {Error} */ (e).name === 'NotAllowedError' || /** @type {Error} */ (e).name === 'AbortError') {
        this.$error = 'Passkey registration was cancelled.'
      } else {
        this.$error = 'Passkey error: ' + (e instanceof Error ? e.message : String(e) || 'Unknown')
      }
    }
    finally { this.$loading = false }
  }

  /**
   * Switch from the passkey step to phone-based backup authentication.
   *
   * Resets phone and OTP fields and advances to `phone-input`.
   *
   * @returns {void}
   */
  usePhoneBackup() { this.$phone = ''; this.$otpCode = ''; this.$error = ''; this.$step = 'phone-input' }

  /**
   * Navigate back one step in the login flow.
   *
   * Clears the current error. The back target depends on the current step:
   * - `passkey` -> `start`
   * - `phone-input` -> `start` (clears phone)
   * - `phone-code` -> `phone-input` (clears code)
   *
   * @returns {void}
   */
  back() {
    this.$error = ''
    if (this.$step === 'passkey') { this.$step = 'start' }
    else if (this.$step === 'phone-input') { this.$phone = ''; this.$step = 'start' }
    else if (this.$step === 'phone-code') { this.$otpCode = ''; this.$step = 'phone-input' }
  }
}
