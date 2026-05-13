// @ts-check

/**
 * Main application shell page.
 *
 * Serves as the root layout and global state manager for the HERMES email
 * client. On mount it restores the authentication session from session storage,
 * registers the global `window._hermes` API surface, binds keyboard shortcuts
 * and navigation event listeners, and manages toast notifications, theme
 * toggling, sidebar state, drag-and-drop folder moves, and the compose
 * prefill pipeline.
 *
 * When the user is authenticated and visiting the root path `/` they are
 * automatically redirected to `/inbox`.
 */
export default class extends Tac {
  /** @type {?string} */
  $token = null
  /** @type {?string} */
  $email = null
  /** @type {?string} */
  $role = null
  /** @type {string[]} */
  $domains = []
  /** @type {string} */
  $toastMsg = ''
  /** @type {boolean} */
  $toastVisible = false
  /** @type {boolean} */
  $isRoot = false
  /** @type {string} */
  $activeFolder = 'inbox'

  /** @type {?ReturnType<typeof setTimeout>} */
  _toastTimer = null
  /** @type {{ mailboxes: boolean, folders: boolean }} */
  _sidebarState = { mailboxes: true, folders: true }

  /**
   * Whether the user has a valid auth token and is considered authenticated.
   * @description Derived from the presence of a session token. Guards all
   *              authenticated views in the app shell template.
   * @type {boolean}
   */
  get isAuthenticated() { return !!this.$token }

  /**
   * Whether the current URL is the root path `/`.
   * @description Used to decide whether to show the landing/login page.
   * @type {boolean}
   */
  get isRootPath() { return this.$isRoot }

  /**
   * The authenticated user's email address, or empty string.
   * @type {string}
   */
  get email() { return this.$email || '' }

  /**
   * Initialises the application shell on mount.
   *
   * Restores session state, determines the current route, updates the active
   * folder highlight, restores sidebar collapse state, registers the global
   * `window._hermes` API, and binds all event listeners.
   *
   * @async
   * @returns {Promise<void>}
   */
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
    this.initSidebarState()

    this.registerGlobals()
    this.bindEvents()
  }

  /**
   * Registers the global `window._hermes` API surface once.
   *
   * Exposes reactive auth state, API fetch helpers, toast notifications,
   * navigation, email composition, and formatting utilities so that child
   * components and pages can interact with the app shell without importing it
   * directly.
   */
  registerGlobals() {
    if (window._hermesInitialised) return
    window._hermesInitialised = true

    const self = this
    window._hermes = {
      get auth() { return { get token() { return self.$token }, get email() { return self.$email }, get role() { return self.$role }, get domains() { return self.$domains }, get isLoggedIn() { return !!self.$token } } },
      apiFetch: (p, o) => this.apiFetch(p, o),
      toast: (m, d) => this.toast(m, d),
      toastAction: (msg, action, duration) => this.toastAction(msg, action, duration),
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

  /**
   * Cycles the colour theme between light, dark, and auto.
   *
   * Updates the `data-theme` attribute on `<html>` and persists the choice
   * to localStorage so it survives page reloads.
   */
  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light'
    const cycle = { light: 'dark', dark: 'auto', auto: 'light' }
    const next = cycle[current] || 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('hermes-theme', next)
  }

  /**
   * Restores sidebar section collapse state from localStorage and applies the
   * `collapsed` CSS class to sections that were previously collapsed.
   */
  initSidebarState() {
    try {
      const saved = JSON.parse(localStorage.getItem('hermes-sidebar-state') || '{}')
      this._sidebarState = { mailboxes: true, folders: true, ...saved }
    } catch { this._sidebarState = { mailboxes: true, folders: true } }
    for (const [name, expanded] of Object.entries(this._sidebarState)) {
      if (expanded) continue
      const body = document.querySelector(`.sidebar-section-body[data-section="${name}"]`)
      const section = body?.closest('.sidebar-section')
      if (section) section.classList.add('collapsed')
    }
  }

  /**
   * Toggles the collapsed state of a named sidebar section.
   *
   * @param {string} name - The `data-section` identifier of the sidebar body.
   */
  toggleSection(name) {
    const body = document.querySelector(`.sidebar-section-body[data-section="${name}"]`)
    const section = body?.closest('.sidebar-section')
    if (!section) return
    section.classList.toggle('collapsed')
    this._sidebarState[name] = !section.classList.contains('collapsed')
    localStorage.setItem('hermes-sidebar-state', JSON.stringify(this._sidebarState))
  }

  /**
   * Determines the currently active folder from the URL path and sets
   * `$activeFolder` so the sidebar can highlight the matching nav item.
   */
  updateActiveFolder() {
    const parts = location.pathname.split('/')
    const segment = parts[1]
    // /folder/<name> → active folder is <name>
    if (segment === 'folder') { this.$activeFolder = parts[2] || 'inbox' }
    else if (segment === 'email' || location.pathname === '/') { this.$activeFolder = 'inbox' }
    else {
      const FOLDERS = new Set(['inbox', 'settings', 'compose', 'scheduled', 'snoozed'])
      if (FOLDERS.has(segment)) this.$activeFolder = segment
    }
  }

  /**
   * Binds global event listeners for logout, email opening, navigation, hash
   * changes, sign-out clicks, and keyboard shortcuts.
   */
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

  /**
   * Registers a handler for a keyboard-shortcut event.
   *
   * @param {string} name - The shortcut event name (e.g. 'core:compose').
   * @param {() => void} handler - The callback to invoke when the shortcut fires.
   */
  _bindShortcut(name, handler) {
    window.addEventListener('hermes:shortcut:' + name, handler)
  }

  /**
   * Shows a toast notification for a limited duration.
   *
   * @param {string} msg - The message text to display.
   * @param {number} [duration=2500] - How long the toast stays visible (ms).
   */
  toast(msg, duration = 2500) {
    clearTimeout(this._toastTimer)
    this.$toastMsg = msg
    this.$toastVisible = true
    this._toastTimer = setTimeout(() => { this.$toastVisible = false }, duration)
    window._hermesShowToast?.(msg, duration)
  }

  /**
   * Shows a toast notification with an action button.
   *
   * @param {string} msg - The message text to display.
   * @param {*} action - The action descriptor (callback or config).
   * @param {number} [duration=10000] - How long the toast stays visible (ms).
   */
  toastAction(msg, action, duration = 10000) {
    clearTimeout(this._toastTimer)
    this.$toastMsg = msg
    this.$toastVisible = true
    this._toastTimer = setTimeout(() => { this.$toastVisible = false }, duration)
    window._hermesShowToast?.({ msg, duration, action })
  }

  /**
   * Programmatically navigates to another client-side route.
   *
   * @param {string} [target='/inbox'] - The destination path (with or without
   *   leading slash).
   */
  navigate(target = '/inbox') {
    const link = document.createElement('a')
    link.href = target.startsWith('/') ? target : `/${target}`
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  /**
   * Adds a visual drag-over indicator when a draggable item enters a folder.
   *
   * @param {DragEvent} event - The native drag-over event.
   */
  onFolderDragOver(event) {
    event.preventDefault()
    event.currentTarget.classList.add('drag-over')
  }

  /**
   * Removes the visual drag-over indicator when a draggable item leaves a folder.
   *
   * @param {DragEvent} event - The native drag-leave event.
   */
  onFolderDragLeave(event) {
    event.currentTarget.classList.remove('drag-over')
  }

  /**
   * Handles dropping an email onto a sidebar folder to move it.
   *
   * Reads the email ID from the drag data, sends a PUT request to the API to
   * update the folder, and triggers an inbox refresh on success.
   *
   * @async
   * @param {string} folder - The target folder name.
   * @param {DragEvent} event - The native drop event.
   * @returns {Promise<void>}
   */
  async onFolderDrop(folder, event) {
    event.preventDefault()
    event.currentTarget.classList.remove('drag-over')
    const emailId = event.dataTransfer.getData('text/plain')
    if (!emailId || !folder) return
    try {
      const res = await this.apiFetch(`/inbox/${emailId}`, { method: 'PUT', body: JSON.stringify({ folder }) })
      if (res?.ok) {
        this.toast(`Moved to ${folder}`)
        window.dispatchEvent(new Event('hermes:refresh-inbox'))
      } else {
        this.toast('Failed to move email')
      }
    } catch {
      this.toast('Failed to move email')
    }
  }

  /**
   * Navigates to the email detail page for a given email.
   *
   * @param {string|{ id: string }} email - The email ID string or an object
   *   with an `id` property.
   */
  openEmail(email) {
    const id = typeof email === 'string' ? email : email?.id
    if (id) this.navigate(`/email/${encodeURIComponent(id)}`)
  }

  /**
   * Navigates to the email detail page by raw ID.
   *
   * @param {string} id - The email ID.
   */
  openEmailId(id) { this.openEmail(id) }

  /**
   * Extracts initials from an email address (up to 2 characters, uppercase).
   *
   * @param {string} addr - An email address string.
   * @returns {string} The uppercase initials derived from the local part.
   */
  initials(addr) { return (addr.split('@')[0] || '?').slice(0, 2).toUpperCase() }

  /**
   * Formats a byte count into a human-readable label (B / KB / MB).
   *
   * @param {number} size - The size in bytes.
   * @returns {string} A human-readable size string.
   */
  bytesLabel(size) {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }

  /**
   * Formats an ISO date string for display.
   *
   * Returns a time (e.g. "2:30 PM") for today's dates and a short date
   * (e.g. "Jan 5") for older dates.
   *
   * @param {string} iso - An ISO 8601 date string.
   * @returns {string} A formatted date/time string.
   */
  formatDate(iso) {
    const d = new Date(iso), now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  /**
   * Navigates to the compose page, optionally storing prefill data in session
   * storage so the compose component can populate fields.
   *
   * @param {object} [prefill={}] - Key-value pairs to prefill (to, subject, body, etc.).
   */
  compose(prefill = {}) {
    if (Object.keys(prefill || {}).length > 0) {
      sessionStorage.setItem('hermes_compose_prefill', JSON.stringify(prefill))
    } else {
      sessionStorage.removeItem('hermes_compose_prefill')
    }
    this.navigate('/compose')
  }

  /**
   * Reads and clears the compose prefill data from session storage.
   *
   * @returns {object} The prefill object (empty object if nothing was stored).
   */
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

  /**
   * Makes an authenticated API request to the HERMES backend.
   *
   * Automatically attaches the Bearer token and handles 401 responses by
   * signing the user out and redirecting to the landing page.
   *
   * @async
   * @param {string} path - The API path (appended to the configured API URL).
   * @param {RequestInit} [options={}] - Fetch options (method, body, headers, etc.).
   * @returns {Promise<Response|null>} The fetch Response, or null if not
   *   authenticated or on auth failure.
   */
  async apiFetch(path, options = {}) {
    if (!this.$token) return null
    const headers = { 'Content-Type': 'application/json', ...options.headers }
    headers['Authorization'] = `Bearer ${this.$token}`
    const apiUrl = window.HERMES_CONFIG?.apiUrl || ''
    const res = await fetch(apiUrl + path, { ...options, headers })
    if (res.status === 401) { this.signOut(); this.navigate('/'); return null }
    return res
  }

  /**
   * Signs the user out by clearing all auth state and navigating to the root.
   */
  signOut() {
    this.$token = null; this.$email = null; this.$role = null; this.$domains = []
    sessionStorage.removeItem('hermes_token'); sessionStorage.removeItem('hermes_email')
    sessionStorage.removeItem('hermes_role'); sessionStorage.removeItem('hermes_domains')
    this.navigate('/')
  }

  /**
   * Persists login data to reactive state and session storage, then redirects.
   *
   * Called by the OAuth callback page and the login form.
   *
   * @param {object} data - The login response payload.
   * @param {string} data.token - The JWT session token.
   * @param {string} data.email - The authenticated user's email address.
   * @param {string} [data.role] - The user's role.
   * @param {string[]} [data.domains] - Allowed domains for the user.
   * @param {string} [returnTo='/inbox'] - The path to redirect to after login.
   */
  handleLogin(data, returnTo = '/inbox') {
    if (!data?.token || !data?.email) { this.toast('Login failed: invalid response'); return }
    this.$token = data.token; this.$email = data.email; this.$role = data.role || ''; this.$domains = data.domains || []
    sessionStorage.setItem('hermes_token', data.token); sessionStorage.setItem('hermes_email', data.email)
    sessionStorage.setItem('hermes_role', data.role || ''); sessionStorage.setItem('hermes_domains', JSON.stringify(data.domains || []))
    location.replace(returnTo)
  }
}
