// @ts-check
export default class extends Tac {
  $token = null
  $email = null
  $role = null
  $domains = []
  $toastMsg = ''
  $toastVisible = false
  $isRoot = false
  $activeFolder = 'inbox'

  _toastTimer = null

  get isAuthenticated() { return !!this.$token }
  get isRootPath() { return this.$isRoot }

  get email() { return this.$email || '' }

  @onMount
  init() {
    const ss = sessionStorage
    this.$token   = ss.getItem('hermes_token') ?? null
    this.$email   = ss.getItem('hermes_email') ?? null
    this.$role    = ss.getItem('hermes_role') ?? null
    try { this.$domains = JSON.parse(ss.getItem('hermes_domains') || '[]') } catch { this.$domains = [] }

    this.$isRoot = location.pathname === '/'
    if (this.$isRoot && this.isAuthenticated) {
      location.replace('/inbox')
    }
    this.updateActiveFolder()

    this.registerGlobals()
    this.bindEvents()
  }

  registerGlobals() {
    if (window._hermesInitialised) return
    window._hermesInitialised = true

    const self = this
    window._hermes = {
      get auth() { return { get token() { return self.$token }, get email() { return self.$email }, get role() { return self.$role }, get domains() { return self.$domains }, get isLoggedIn() { return !!self.$token } } },
      apiFetch: (p, o) => this.apiFetch(p, o),
      toast: (m, d) => this.toast(m, d),
      navigate: (t) => this.navigate(t),
      openEmail: (e) => this.openEmail(e),
      openEmailId: (id) => this.openEmailId(id),
      compose: (p) => this.compose(p),
      consumeComposePrefill: () => this.consumeComposePrefill(),
      handleLogin: (d, r) => this.handleLogin(d, r),
      initials: (a) => this.initials(a),
      bytesLabel: (s) => this.bytesLabel(s),
      formatDate: (i) => this.formatDate(i),
    }
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light'
    const cycle = { light: 'dark', dark: 'auto', auto: 'light' }
    const next = cycle[current] || 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('hermes-theme', next)
  }

  updateActiveFolder() {
    const p = location.pathname
    if (p.startsWith('/inbox') || p === '/') this.$activeFolder = 'inbox'
    else if (p.startsWith('/drafts')) this.$activeFolder = 'drafts'
    else if (p.startsWith('/sent')) this.$activeFolder = 'sent'
    else if (p.startsWith('/archive')) this.$activeFolder = 'archive'
    else if (p.startsWith('/spam')) this.$activeFolder = 'spam'
    else if (p.startsWith('/trash')) this.$activeFolder = 'trash'
    else if (p.startsWith('/settings')) this.$activeFolder = 'settings'
    else if (p.startsWith('/compose')) this.$activeFolder = 'compose'
    else if (p.startsWith('/email')) this.$activeFolder = 'inbox'
  }

  bindEvents() {
    window.addEventListener('hermes:logout', () => this.signOut())
    window.addEventListener('hermes:open-email', (e) => { this.openEmail(e.detail) })
    window.addEventListener('tachyon:navigate', () => { this.updateActiveFolder() })
    window.addEventListener('hashchange', () => {
      if (!location.hash.startsWith('#email=')) return
      this.openEmailId(decodeURIComponent(location.hash.slice('#email='.length)))
    })
    document.addEventListener('click', (e) => {
      if (!e.target?.closest?.('[data-sign-out]')) return
      e.preventDefault()
      this.signOut()
    }, true)

    // ── Keyboard shortcut event listeners ──
    this._bindShortcut('core:compose', () => this.compose({}))
    this._bindShortcut('core:go-inbox', () => this.navigate('/inbox'))
    this._bindShortcut('core:go-drafts', () => this.navigate('/drafts'))
    this._bindShortcut('core:go-sent', () => this.navigate('/sent'))
    this._bindShortcut('core:go-archive', () => this.navigate('/archive'))
    this._bindShortcut('core:go-spam', () => this.navigate('/spam'))
    this._bindShortcut('core:go-trash', () => this.navigate('/trash'))
    this._bindShortcut('core:go-settings', () => this.navigate('/settings'))
    this._bindShortcut('core:refresh', () => {
      window.dispatchEvent(new Event('hermes:refresh-inbox'))
    })
    this._bindShortcut('core:search', () => {
      const field = document.querySelector('.inbox-search md-outlined-text-field')
      if (field) field.focus()
    })
    this._bindShortcut('show-help', () => {
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        console.log('[keyboard] Shortcut help panel — press ? to see all shortcuts')
      }
      // TODO: render shortcut-help modal or navigate to settings#shortcuts
    })
  }

  _bindShortcut(name, handler) {
    window.addEventListener('hermes:shortcut:' + name, handler)
  }

  toast(msg, duration = 2500) {
    clearTimeout(this._toastTimer)
    this.$toastMsg = msg
    this.$toastVisible = true
    this._toastTimer = setTimeout(() => { this.$toastVisible = false }, duration)
  }

  navigate(target = '/inbox') {
    const link = document.createElement('a')
    link.href = target.startsWith('/') ? target : `/${target}`
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  openEmail(email) {
    const id = typeof email === 'string' ? email : email?.id
    if (id) this.navigate(`/email/${encodeURIComponent(id)}`)
  }

  openEmailId(id) { this.openEmail(id) }
  initials(addr) { return (addr.split('@')[0] || '?').slice(0, 2).toUpperCase() }

  bytesLabel(size) {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }

  formatDate(iso) {
    const d = new Date(iso), now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  compose(prefill = {}) {
    if (Object.keys(prefill || {}).length > 0) {
      sessionStorage.setItem('hermes_compose_prefill', JSON.stringify(prefill))
    } else {
      sessionStorage.removeItem('hermes_compose_prefill')
    }
    this.navigate('/compose')
  }

  consumeComposePrefill() {
    try {
      const value = JSON.parse(sessionStorage.getItem('hermes_compose_prefill') || '{}')
      sessionStorage.removeItem('hermes_compose_prefill')
      return value
    } catch {
      sessionStorage.removeItem('hermes_compose_prefill')
      return {}
    }
  }

  async apiFetch(path, options = {}) {
    if (!this.$token) return null
    const headers = { 'Content-Type': 'application/json', ...options.headers }
    headers['Authorization'] = `Bearer ${this.$token}`
    const apiUrl = window.HERMES_CONFIG?.apiUrl || ''
    const res = await fetch(apiUrl + path, { ...options, headers })
    if (res.status === 401) { this.signOut(); this.navigate('/'); return null }
    return res
  }

  signOut() {
    this.$token = null; this.$email = null; this.$role = null; this.$domains = []
    sessionStorage.removeItem('hermes_token'); sessionStorage.removeItem('hermes_email')
    sessionStorage.removeItem('hermes_role'); sessionStorage.removeItem('hermes_domains')
    this.navigate('/')
  }

  handleLogin(data, returnTo = '/inbox') {
    if (!data?.token || !data?.email) { this.toast('Login failed: invalid response'); return }
    this.$token = data.token; this.$email = data.email; this.$role = data.role || ''; this.$domains = data.domains || []
    sessionStorage.setItem('hermes_token', data.token); sessionStorage.setItem('hermes_email', data.email)
    sessionStorage.setItem('hermes_role', data.role || ''); sessionStorage.setItem('hermes_domains', JSON.stringify(data.domains || []))
    location.replace(returnTo)
  }
}
