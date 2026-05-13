// @ts-check

/**
 * Settings / administration panel component.
 *
 * Provides a tabbed interface for managing the Hermes email system:
 * - **Domains** — list of configured email domains
 * - **Users** — admin-only user management (add users with roles, phones, domains)
 * - **Rules** — server-side email processing rules with conditions and actions
 * - **MFA Devices** — TOTP authenticator device provisioning and removal
 * - **Notifications** — Web Push subscription management (enable / disable)
 * - **Signatures** — per-domain email signature management
 *
 * All data is loaded in parallel on mount via `Promise.all`. The MFA setup
 * wizard preserves its state across re-renders using a window-level cache.
 *
 * @extends Tac
 */
export default class extends Tac {
  /** @type {Array<object>} */
  $domains = []; /** @type {Array<object>} */
  $users = []; /** @type {Array<object>} */
  $rules = []; /** @type {Array<object>} */
  $mfaDevices = []; /** @type {Array<object>} */
  $pushSubscriptions = []; /** @type {boolean} */
  $loading = true
  /** @type {boolean} Whether the Add User form is visible */
  $showAddUser = false; /** @type {boolean} Whether the Add Rule form is visible */
  $showAddRule = false
  /** @type {string} */
  $newEmail = ''; /** @type {string} */
  $newPhones = ''; /** @type {string} */
  $newDomains = ''; /** @type {string} */
  $newRole = 'viewer'
  /** @type {string} */
  $newRuleName = ''; /** @type {string} */
  $newRuleDomain = ''; /** @type {string} */
  $newConditionMatch = 'all'
  /** @type {Array<object>} */
  $newConditions = []; /** @type {Array<object>} */
  $newActions = []
  /** @type {string} */
  $condField = 'from'; /** @type {string} */
  $condOp = 'contains'; /** @type {string} */
  $condValue = ''
  /** @type {string} */
  $actionType = 'folder'; /** @type {string} */
  $actionFolder = ''; /** @type {string} */
  $actionTo = ''
  /** @type {boolean} Whether the Add MFA Device wizard is open */
  $showAddDevice = false; /** @type {object|null} Provisioning data from `/mfa/provision` */
  $deviceProvision = null; /** @type {string} */
  $newDeviceName = ''; /** @type {string} */
  $newDeviceCode = ''
  /** @type {boolean} */
  $deviceLoading = false; /** @type {string} */
  $deviceError = ''
  /** @type {boolean} Whether the browser supports Web Push */
  $notificationSupported = false; /** @type {string} Current Notification API permission state */
  $notificationPermission = 'default'
  /** @type {boolean} */
  $notificationLoading = false; /** @type {string} */
  $notificationError = ''
  /** @type {boolean} Whether the current user has the admin role */
  $isAdmin = false
  /** @type {Array<{ id: string, domain: string, name: string, text: string }>} */
  $signatures = []
  /** @type {string} */
  $newSigDomain = ''; /** @type {string} */
  $newSigName = ''; /** @type {string} */
  $newSigText = ''; /** @type {string} */
  $signatureError = ''

  /** @type {number} Internal sequence counter for condition IDs */
  _condSeq = 0; /** @type {number} Internal sequence counter for action IDs */
  _actSeq = 0
  /** @type {string} Key used to persist MFA setup state on the window object */
  _mfaSetupStateKey = '__hermes_mfa_setup_state'

  /**
   * @description Whether the current browser supports the Web Push and
   * Service Worker APIs required for push notifications.
   * @returns {boolean}
   */
  get canUseNotifications() { return !window.__HERMES_DISABLE_SW && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window }

  /**
   * @description Human-readable label summarising the current notification status.
   * @returns {string}
   */
  get notificationStatusLabel() {
    if (!this.$notificationSupported) return 'Not available on this browser'
    if (this.$notificationPermission === 'granted' && this.$pushSubscriptions.length > 0) return 'On'
    if (this.$notificationPermission === 'denied') return 'Blocked'
    return 'Off'
  }

  /**
   * @description Contextual help text explaining the current notification state
   * and what the user can do to enable or manage alerts.
   * @returns {string}
   */
  get notificationHelpText() {
    if (!this.$notificationSupported) return 'Install Hermes with a browser that supports Web Push to receive new mail alerts.'
    if (this.$notificationPermission === 'denied') return 'Notifications are blocked in this browser. Allow them in site settings to turn alerts on.'
    if (this.$notificationPermission === 'granted' && this.$pushSubscriptions.length > 0) return 'This device will alert you when new mail arrives.'
    return 'Turn this on for an installed desktop or mobile app feel when mail arrives.'
  }

  /**
   * Load all settings data in parallel on mount.
   *
   * Fetches domains, rules, MFA devices, notifications subscriptions, and
   * signatures concurrently. If the user is an admin, also fetches the user list.
   * Restores any in-progress MFA setup wizard state.
   *
   * @async
   * @returns {Promise<void>}
   */
  @onMount
  async loadAll() {
    this.$loading = true; this.syncNotificationState()
    this.$isAdmin = sessionStorage.getItem('hermes_role') === 'admin'
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) { this.$loading = false; return }
    const [dr, rr, mr, nr, sr] = await Promise.all([apiFetch('/domains'), apiFetch('/rules'), apiFetch('/mfa/devices'), apiFetch('/notifications/subscriptions'), apiFetch('/signatures')])
    this.$domains = dr?.ok ? await dr.json() : []; this.$rules = rr?.ok ? await rr.json() : []
    this.$mfaDevices = mr?.ok ? await mr.json() : []; this.$signatures = sr?.ok ? await sr.json() : []; this.$pushSubscriptions = nr?.ok ? await nr.json() : []
    if (this.$isAdmin) { const ur = await apiFetch('/users'); this.$users = ur?.ok ? await ur.json() : [] }
    this.restoreMfaSetupState(); this.$loading = false
  }

  /**
   * Restore MFA setup wizard state during rendering.
   *
   * Used as a template-side expression (always returns `false`) to trigger
   * state restoration from the window-level cache without a dedicated mount hook.
   *
   * @returns {false}
   */
  restoreMfaSetupStateForRender() { this.restoreMfaSetupState(); return false }

  /**
   * Synchronise the notification state fields with the browser's current
   * capabilities and permission status.
   *
   * @returns {void}
   */
  syncNotificationState() {
    this.$notificationSupported = this.canUseNotifications
    this.$notificationPermission = this.$notificationSupported ? Notification.permission : 'unsupported'
  }

  /**
   * Persist the MFA device setup wizard state to a window-level cache so it
   * survives component re-renders.
   *
   * @returns {void}
   */
  saveMfaSetupState() { window[this._mfaSetupStateKey] = { showAddDevice: this.$showAddDevice, deviceProvision: this.$deviceProvision, newDeviceName: this.$newDeviceName, newDeviceCode: this.$newDeviceCode, deviceError: this.$deviceError } }

  /**
   * Restore the MFA device setup wizard state from the window-level cache.
   *
   * Only overwrites fields that are currently empty/falsy to avoid clobbering
   * user input.
   *
   * @returns {void}
   */
  restoreMfaSetupState() {
    const state = window[this._mfaSetupStateKey]; if (!state) return
    this.$showAddDevice = state.showAddDevice
    if (state.deviceProvision) this.$deviceProvision = state.deviceProvision
    if (!this.$newDeviceName && state.newDeviceName) this.$newDeviceName = state.newDeviceName
    if (!this.$newDeviceCode && state.newDeviceCode) this.$newDeviceCode = state.newDeviceCode
    if (!this.$deviceError && state.deviceError) this.$deviceError = state.deviceError
  }

  /**
   * Clear the cached MFA setup wizard state.
   *
   * @returns {void}
   */
  clearMfaSetupState() { delete window[this._mfaSetupStateKey] }

  /**
   * Re-fetch push notification subscriptions from the API and sync state.
   *
   * @async
   * @returns {Promise<void>}
   */
  async refreshPushSubscriptions() {
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch('/notifications/subscriptions'); this.$pushSubscriptions = res?.ok ? await res.json() : []; this.syncNotificationState()
  }

  /**
   * Enable Web Push notifications for this device.
   *
   * Requests notification permission, retrieves the VAPID public key from the
   * server, subscribes the service worker to push, and saves the subscription.
   *
   * @async
   * @returns {Promise<void>}
   */
  async enableNotifications() {
    this.$notificationError = ''; this.syncNotificationState()
    if (!this.$notificationSupported) { this.$notificationError = 'This browser cannot receive Web Push notifications.'; return }
    this.$notificationLoading = true
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) { this.$notificationLoading = false; return }
    try {
      const permission = await Notification.requestPermission(); this.$notificationPermission = permission
      if (permission !== 'granted') { this.$notificationError = 'Notifications were not allowed.'; return }
      const keyRes = await apiFetch('/notifications/vapid-public-key'); if (!keyRes?.ok) throw new Error('Unable to load notification key')
      const { publicKey } = await keyRes.json()
      const cb = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const b = (s + p).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from([...atob(b)].map(c => c.charCodeAt(0))) }
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cb(publicKey) })
      const saveRes = await apiFetch('/notifications/subscriptions', { method: 'POST', body: JSON.stringify(sub.toJSON()) })
      if (!saveRes?.ok) throw new Error('Unable to save notification subscription')
      await this.refreshPushSubscriptions(); window._hermes?.toast('Notifications enabled.')
    } catch { this.$notificationError = 'Unable to enable notifications on this device.' }
    finally { this.$notificationLoading = false }
  }

  /**
   * Disable Web Push notifications for this device.
   *
   * Deletes the subscription from the server and unsubscribes the local push
   * subscription.
   *
   * @async
   * @returns {Promise<void>}
   */
  async disableNotifications() {
    this.$notificationError = ''; this.syncNotificationState(); if (!this.$notificationSupported) return
    this.$notificationLoading = true; const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) { this.$notificationLoading = false; return }
    try {
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription()
      if (sub) { await apiFetch('/notifications/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe() }
      await this.refreshPushSubscriptions(); window._hermes?.toast('Notifications disabled.')
    } catch { this.$notificationError = 'Unable to disable notifications on this device.' }
    finally { this.$notificationLoading = false }
  }

  /**
   * Add a new user (admin only).
   *
   * Validates required fields, posts to `/users`, and refreshes the user list.
   *
   * @async
   * @returns {Promise<void>}
   */
  async addUser() {
    if (!this.$newEmail || !this.$newPhones || !this.$newDomains) return
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch('/users', { method: 'POST', body: JSON.stringify({ email: this.$newEmail, phones: this.$newPhones.split(',').map(p => p.trim()).filter(Boolean), domains: this.$newDomains.split(',').map(d => d.trim()).filter(Boolean), role: this.$newRole }) })
    if (res?.ok) { this.$showAddUser = false; this.$newEmail = this.$newPhones = this.$newDomains = ''; this.$newRole = 'viewer'; const ur = await apiFetch('/users'); this.$users = ur?.ok ? await ur.json() : []; window._hermes?.toast('User added.') }
    else { const data = await res?.json(); window._hermes?.toast(data?.error || 'Failed to add user.') }
  }

  /**
   * Append a condition to the new-rule form.
   *
   * Conditions define when a rule should fire (e.g. `from contains "example.com"`).
   *
   * @returns {void}
   */
  addCondition() { if (!this.$condValue) return; this.$newConditions = [...this.$newConditions, { _id: ++this._condSeq, field: this.$condField, op: this.$condOp, value: this.$condValue }]; this.$condValue = '' }

  /**
   * Remove a condition from the new-rule form by its internal ID.
   *
   * @param {number} id - The internal `_id` of the condition to remove
   * @returns {void}
   */
  removeCondition(id) { this.$newConditions = this.$newConditions.filter(c => c._id !== id) }

  /**
   * Append an action to the new-rule form.
   *
   * Actions define what happens when a rule's conditions are met (move to
   * folder, forward to address, or delete).
   *
   * @returns {void}
   */
  addAction() { if (this.$actionType === 'folder' && !this.$actionFolder) return; if (this.$actionType === 'forward' && !this.$actionTo) return; const a = this.$actionType === 'folder' ? { _id: ++this._actSeq, type: 'folder', folder: this.$actionFolder } : this.$actionType === 'forward' ? { _id: ++this._actSeq, type: 'forward', to: this.$actionTo } : { _id: ++this._actSeq, type: 'delete' }; this.$newActions = [...this.$newActions, a]; this.$actionFolder = this.$actionTo = '' }

  /**
   * Remove an action from the new-rule form by its internal ID.
   *
   * @param {number} id - The internal `_id` of the action to remove
   * @returns {void}
   */
  removeAction(id) { this.$newActions = this.$newActions.filter(a => a._id !== id) }

  /**
   * Reset all fields in the new-rule form to their defaults.
   *
   * @returns {void}
   */
  resetRuleForm() { this.$newRuleName = this.$newRuleDomain = ''; this.$newConditionMatch = 'all'; this.$newConditions = []; this.$newActions = []; this.$condField = 'from'; this.$condOp = 'contains'; this.$condValue = ''; this.$actionType = 'folder'; this.$actionFolder = this.$actionTo = ''; this.$showAddRule = false }

  /**
   * Persist the new rule to the API.
   *
   * Strips internal `_id` fields from conditions and actions before sending.
   * On success, refreshes the rules list and resets the form.
   *
   * @async
   * @returns {Promise<void>}
   */
  async saveRule() {
    if (!this.$newRuleName || !this.$newRuleDomain || this.$newActions.length === 0) { window._hermes?.toast('Name, domain, and at least one action are required.'); return }
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch('/rules', { method: 'POST', body: JSON.stringify({ name: this.$newRuleName, domain: this.$newRuleDomain, enabled: true, conditionMatch: this.$newConditionMatch, conditions: this.$newConditions.map(({ _id, ...c }) => c), actions: this.$newActions.map(({ _id, ...a }) => a) }) })
    if (res?.ok) { const rr = await apiFetch('/rules'); this.$rules = rr?.ok ? await rr.json() : []; window._hermes?.toast('Rule saved.'); this.resetRuleForm() }
    else { const data = await res?.json(); window._hermes?.toast(data?.error || 'Failed to save rule.') }
  }

  /**
   * Delete a rule by ID.
   *
   * Prompts for confirmation before sending the DELETE request.
   *
   * @async
   * @param {string} id - The rule ID to delete
   * @returns {Promise<void>}
   */
  async deleteRule(id) { if (!confirm('Delete this rule?')) return; const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return; const res = await apiFetch(`/rules/${id}`, { method: 'DELETE' }); if (res?.ok) { this.$rules = this.$rules.filter(r => r.id !== id); window._hermes?.toast('Rule deleted.') } }

  /**
   * Toggle a rule's enabled / disabled state.
   *
   * @async
   * @param {string} id - The rule ID
   * @param {boolean} enabled - The current enabled state (will be toggled)
   * @returns {Promise<void>}
   */
  async toggleRule(id, enabled) { const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return; await apiFetch(`/rules/${id}`, { method: 'PUT', body: JSON.stringify({ enabled: !enabled }) }); const rr = await apiFetch('/rules'); this.$rules = rr?.ok ? await rr.json() : [] }

  /**
   * Build a human-readable description of a rule's conditions.
   *
   * @param {{ conditions?: Array<{ field: string, op: string, value: string }>, conditionMatch?: string }} rule - Rule object
   * @returns {string} e.g. `from contains "example.com" all subject contains "invoice"`
   */
  describeConditions(rule) { if (!rule.conditions?.length) return 'Always'; return rule.conditions.map(c => `${c.field} ${c.op} "${c.value}"`).join(` ${rule.conditionMatch} `) }

  /**
   * Build a human-readable description of a rule's actions.
   *
   * @param {{ actions?: Array<{ type: string, folder?: string, to?: string }> }} rule - Rule object
   * @returns {string} e.g. `-> folder "archive", -> forward to user@example.com`
   */
  describeActions(rule) { return (rule.actions || []).map(a => a.type === 'folder' ? `→ folder "${a.folder}"` : a.type === 'forward' ? `→ forward to ${a.to}` : '→ delete').join(', ') }

  /**
   * Start the MFA device setup wizard: request a provisioning token from the
   * server and display the QR code / code entry form.
   *
   * Toggles the wizard closed if it is already open.
   *
   * @async
   * @returns {Promise<void>}
   */
  async startAddDevice() {
    if (this.$showAddDevice) { this.$showAddDevice = false; this.$deviceProvision = null; this.$newDeviceName = this.$newDeviceCode = this.$deviceError = ''; this.clearMfaSetupState(); return }
    this.$showAddDevice = true; this.$deviceProvision = null; this.saveMfaSetupState()
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch('/mfa/provision', { method: 'POST' })
    if (res?.ok) { this.$deviceProvision = await res.json(); this.saveMfaSetupState() }
    else { window._hermes?.toast('Failed to start device setup.'); this.$showAddDevice = false; this.clearMfaSetupState() }
  }

  /**
   * Confirm the MFA device setup by submitting the 6-digit code from the
   * user's authenticator app.
   *
   * On success, closes the wizard, clears cached state, and refreshes the
   * devices list.
   *
   * @async
   * @returns {Promise<void>}
   */
  async confirmDevice() {
    if (!this.$deviceProvision || !this.$newDeviceCode || this.$newDeviceCode.length !== 6) { this.$deviceError = 'Enter the 6-digit code from your authenticator.'; this.saveMfaSetupState(); return }
    this.$deviceLoading = true; this.$deviceError = ''
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    try {
      const res = await apiFetch('/auth/mfa/setup', { method: 'POST', body: JSON.stringify({ setupToken: /** @type {{setupToken: string}} */ (this.$deviceProvision).setupToken, code: this.$newDeviceCode, name: this.$newDeviceName.trim() || 'Authenticator' }) })
      if (res?.ok) { window._hermes?.toast('Device added.'); this.$showAddDevice = false; this.$deviceProvision = null; this.$newDeviceName = this.$newDeviceCode = ''; this.clearMfaSetupState(); const mr = await apiFetch('/mfa/devices'); this.$mfaDevices = mr?.ok ? await mr.json() : [] }
      else { const data = await res?.json(); this.$deviceError = data?.error || 'Invalid code.'; this.saveMfaSetupState() }
    } catch { this.$deviceError = 'Network error.'; this.saveMfaSetupState() } finally { this.$deviceLoading = false }
  }

  /**
   * Remove an MFA device by ID.
   *
   * Prompts for confirmation before deleting.
   *
   * @async
   * @param {string} id - The MFA device ID to remove
   * @returns {Promise<void>}
   */
  async deleteMfaDevice(id) { if (!confirm('Remove this MFA device?')) return; const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return; const res = await apiFetch(`/mfa/devices/${id}`, { method: 'DELETE' }); if (res?.ok) { this.$mfaDevices = this.$mfaDevices.filter(d => d.id !== id); window._hermes?.toast('Device removed.') } }

  /**
   * Save a new email signature for a domain.
   *
   * Validates that domain, name, and text are all provided. On success,
   * appends the new signature to the local list.
   *
   * @async
   * @returns {Promise<void>}
   */
  async saveSignature() {
    if (!this.$newSigDomain || !this.$newSigName || !this.$newSigText) {
      this.$signatureError = 'Domain, name, and text are required.'
      return
    }
    this.$signatureError = ''
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch('/signatures', { method: 'POST', body: JSON.stringify({ domain: this.$newSigDomain.trim(), name: this.$newSigName.trim(), text: this.$newSigText }) })
    if (res?.ok) {
      const sig = await res.json()
      this.$signatures = [...this.$signatures, sig]
      this.$newSigDomain = this.$newSigName = this.$newSigText = ''
      window._hermes?.toast('Signature saved.')
    } else {
      const data = await res?.json()
      this.$signatureError = data?.error || 'Failed to save signature.'
    }
  }

  /**
   * Delete a signature by ID.
   *
   * Prompts for confirmation before deleting.
   *
   * @async
   * @param {string} id - The signature ID to delete
   * @returns {Promise<void>}
   */
  async deleteSignature(id) {
    if (!confirm('Remove this signature?')) return
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch(`/signatures/${id}`, { method: 'DELETE' })
    if (res?.ok) {
      this.$signatures = this.$signatures.filter(s => s.id !== id)
      window._hermes?.toast('Signature removed.')
    }
  }
}
