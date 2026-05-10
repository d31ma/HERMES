// @ts-check
export default class extends Tac {
  $domains = []; $users = []; $rules = []; $mfaDevices = []; $pushSubscriptions = []; $loading = true
  $showAddUser = false; $showAddRule = false
  $newEmail = ''; $newPhones = ''; $newDomains = ''; $newRole = 'viewer'
  $newRuleName = ''; $newRuleDomain = ''; $newConditionMatch = 'all'
  $newConditions = []; $newActions = []
  $condField = 'from'; $condOp = 'contains'; $condValue = ''
  $actionType = 'folder'; $actionFolder = ''; $actionTo = ''
  $showAddDevice = false; $deviceProvision = null; $newDeviceName = ''; $newDeviceCode = ''
  $deviceLoading = false; $deviceError = ''
  $notificationSupported = false; $notificationPermission = 'default'
  $notificationLoading = false; $notificationError = ''
  $isAdmin = false

  _condSeq = 0; _actSeq = 0
  _mfaSetupStateKey = '__hermes_mfa_setup_state'

  get canUseNotifications() { return !window.__HERMES_DISABLE_SW && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window }

  get notificationStatusLabel() {
    if (!this.$notificationSupported) return 'Not available on this browser'
    if (this.$notificationPermission === 'granted' && this.$pushSubscriptions.length > 0) return 'On'
    if (this.$notificationPermission === 'denied') return 'Blocked'
    return 'Off'
  }

  get notificationHelpText() {
    if (!this.$notificationSupported) return 'Install Hermes with a browser that supports Web Push to receive new mail alerts.'
    if (this.$notificationPermission === 'denied') return 'Notifications are blocked in this browser. Allow them in site settings to turn alerts on.'
    if (this.$notificationPermission === 'granted' && this.$pushSubscriptions.length > 0) return 'This device will alert you when new mail arrives.'
    return 'Turn this on for an installed desktop or mobile app feel when mail arrives.'
  }

  @onMount
  async loadAll() {
    this.$loading = true; this.syncNotificationState()
    this.$isAdmin = sessionStorage.getItem('hermes_role') === 'admin'
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) { this.$loading = false; return }
    const [dr, rr, mr, nr] = await Promise.all([apiFetch('/domains'), apiFetch('/rules'), apiFetch('/mfa/devices'), apiFetch('/notifications/subscriptions')])
    this.$domains = dr?.ok ? await dr.json() : []; this.$rules = rr?.ok ? await rr.json() : []
    this.$mfaDevices = mr?.ok ? await mr.json() : []; this.$pushSubscriptions = nr?.ok ? await nr.json() : []
    if (this.$isAdmin) { const ur = await apiFetch('/users'); this.$users = ur?.ok ? await ur.json() : [] }
    this.restoreMfaSetupState(); this.$loading = false
  }

  restoreMfaSetupStateForRender() { this.restoreMfaSetupState(); return false }

  syncNotificationState() {
    this.$notificationSupported = this.canUseNotifications
    this.$notificationPermission = this.$notificationSupported ? Notification.permission : 'unsupported'
  }

  saveMfaSetupState() { window[this._mfaSetupStateKey] = { showAddDevice: this.$showAddDevice, deviceProvision: this.$deviceProvision, newDeviceName: this.$newDeviceName, newDeviceCode: this.$newDeviceCode, deviceError: this.$deviceError } }

  restoreMfaSetupState() {
    const state = window[this._mfaSetupStateKey]; if (!state) return
    this.$showAddDevice = state.showAddDevice
    if (state.deviceProvision) this.$deviceProvision = state.deviceProvision
    if (!this.$newDeviceName && state.newDeviceName) this.$newDeviceName = state.newDeviceName
    if (!this.$newDeviceCode && state.newDeviceCode) this.$newDeviceCode = state.newDeviceCode
    if (!this.$deviceError && state.deviceError) this.$deviceError = state.deviceError
  }

  clearMfaSetupState() { delete window[this._mfaSetupStateKey] }

  async refreshPushSubscriptions() {
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch('/notifications/subscriptions'); this.$pushSubscriptions = res?.ok ? await res.json() : []; this.syncNotificationState()
  }

  async enableNotifications() {
    this.$notificationError = ''; this.syncNotificationState()
    if (!this.$notificationSupported) { this.$notificationError = 'This browser cannot receive Web Push notifications.'; return }
    this.$notificationLoading = true
    const apiFetch = window._hermes?.apiFetch
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

  async disableNotifications() {
    this.$notificationError = ''; this.syncNotificationState(); if (!this.$notificationSupported) return
    this.$notificationLoading = true; const apiFetch = window._hermes?.apiFetch
    try {
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription()
      if (sub) { await apiFetch('/notifications/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe() }
      await this.refreshPushSubscriptions(); window._hermes?.toast('Notifications disabled.')
    } catch { this.$notificationError = 'Unable to disable notifications on this device.' }
    finally { this.$notificationLoading = false }
  }

  async addUser() {
    if (!this.$newEmail || !this.$newPhones || !this.$newDomains) return
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch('/users', { method: 'POST', body: JSON.stringify({ email: this.$newEmail, phones: this.$newPhones.split(',').map(p => p.trim()).filter(Boolean), domains: this.$newDomains.split(',').map(d => d.trim()).filter(Boolean), role: this.$newRole }) })
    if (res?.ok) { this.$showAddUser = false; this.$newEmail = this.$newPhones = this.$newDomains = ''; this.$newRole = 'viewer'; const ur = await apiFetch('/users'); this.$users = ur?.ok ? await ur.json() : []; window._hermes?.toast('User added.') }
    else { const data = await res?.json(); window._hermes?.toast(data?.error || 'Failed to add user.') }
  }

  addCondition() { if (!this.$condValue) return; this.$newConditions = [...this.$newConditions, { _id: ++this._condSeq, field: this.$condField, op: this.$condOp, value: this.$condValue }]; this.$condValue = '' }
  removeCondition(id) { this.$newConditions = this.$newConditions.filter(c => c._id !== id) }
  addAction() { if (this.$actionType === 'folder' && !this.$actionFolder) return; if (this.$actionType === 'forward' && !this.$actionTo) return; const a = this.$actionType === 'folder' ? { _id: ++this._actSeq, type: 'folder', folder: this.$actionFolder } : this.$actionType === 'forward' ? { _id: ++this._actSeq, type: 'forward', to: this.$actionTo } : { _id: ++this._actSeq, type: 'delete' }; this.$newActions = [...this.$newActions, a]; this.$actionFolder = this.$actionTo = '' }
  removeAction(id) { this.$newActions = this.$newActions.filter(a => a._id !== id) }
  resetRuleForm() { this.$newRuleName = this.$newRuleDomain = ''; this.$newConditionMatch = 'all'; this.$newConditions = []; this.$newActions = []; this.$condField = 'from'; this.$condOp = 'contains'; this.$condValue = ''; this.$actionType = 'folder'; this.$actionFolder = this.$actionTo = ''; this.$showAddRule = false }

  async saveRule() {
    if (!this.$newRuleName || !this.$newRuleDomain || this.$newActions.length === 0) { window._hermes?.toast('Name, domain, and at least one action are required.'); return }
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch('/rules', { method: 'POST', body: JSON.stringify({ name: this.$newRuleName, domain: this.$newRuleDomain, enabled: true, conditionMatch: this.$newConditionMatch, conditions: this.$newConditions.map(({ _id, ...c }) => c), actions: this.$newActions.map(({ _id, ...a }) => a) }) })
    if (res?.ok) { const rr = await apiFetch('/rules'); this.$rules = rr?.ok ? await rr.json() : []; window._hermes?.toast('Rule saved.'); this.resetRuleForm() }
    else { const data = await res?.json(); window._hermes?.toast(data?.error || 'Failed to save rule.') }
  }

  async deleteRule(id) { if (!confirm('Delete this rule?')) return; const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return; const res = await apiFetch(`/rules/${id}`, { method: 'DELETE' }); if (res?.ok) { this.$rules = this.$rules.filter(r => r.id !== id); window._hermes?.toast('Rule deleted.') } }
  async toggleRule(id, enabled) { const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return; await apiFetch(`/rules/${id}`, { method: 'PUT', body: JSON.stringify({ enabled: !enabled }) }); const rr = await apiFetch('/rules'); this.$rules = rr?.ok ? await rr.json() : [] }
  describeConditions(rule) { if (!rule.conditions?.length) return 'Always'; return rule.conditions.map(c => `${c.field} ${c.op} "${c.value}"`).join(` ${rule.conditionMatch} `) }
  describeActions(rule) { return (rule.actions || []).map(a => a.type === 'folder' ? `→ folder "${a.folder}"` : a.type === 'forward' ? `→ forward to ${a.to}` : '→ delete').join(', ') }

  async startAddDevice() {
    if (this.$showAddDevice) { this.$showAddDevice = false; this.$deviceProvision = null; this.$newDeviceName = this.$newDeviceCode = this.$deviceError = ''; this.clearMfaSetupState(); return }
    this.$showAddDevice = true; this.$deviceProvision = null; this.saveMfaSetupState()
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch('/mfa/provision', { method: 'POST' })
    if (res?.ok) { this.$deviceProvision = await res.json(); this.saveMfaSetupState() }
    else { window._hermes?.toast('Failed to start device setup.'); this.$showAddDevice = false; this.clearMfaSetupState() }
  }

  async confirmDevice() {
    if (!this.$deviceProvision || !this.$newDeviceCode || this.$newDeviceCode.length !== 6) { this.$deviceError = 'Enter the 6-digit code from your authenticator.'; this.saveMfaSetupState(); return }
    this.$deviceLoading = true; this.$deviceError = ''
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    try {
      const res = await apiFetch('/auth/mfa/setup', { method: 'POST', body: JSON.stringify({ setupToken: this.$deviceProvision.setupToken, code: this.$newDeviceCode, name: this.$newDeviceName.trim() || 'Authenticator' }) })
      if (res?.ok) { window._hermes?.toast('Device added.'); this.$showAddDevice = false; this.$deviceProvision = null; this.$newDeviceName = this.$newDeviceCode = ''; this.clearMfaSetupState(); const mr = await apiFetch('/mfa/devices'); this.$mfaDevices = mr?.ok ? await mr.json() : [] }
      else { const data = await res?.json(); this.$deviceError = data?.error || 'Invalid code.'; this.saveMfaSetupState() }
    } catch { this.$deviceError = 'Network error.'; this.saveMfaSetupState() } finally { this.$deviceLoading = false }
  }

  async deleteMfaDevice(id) { if (!confirm('Remove this MFA device?')) return; const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return; const res = await apiFetch(`/mfa/devices/${id}`, { method: 'DELETE' }); if (res?.ok) { this.$mfaDevices = this.$mfaDevices.filter(d => d.id !== id); window._hermes?.toast('Device removed.') } }
}
