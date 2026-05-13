// @ts-check

/**
 * @typedef {object} InboxViewProps
 * @property {string} [folder] - Initial folder to display (defaults to 'inbox')
 */

/**
 * Inbox / email list component.
 *
 * Displays a filterable, searchable list of emails organised by folder. Supports:
 * - Folder sidebar (inbox, archive, snoozed, trash, plus custom folders)
 * - Search with Gmail-like query syntax (from:, to:, subject:, has:attachment, etc.)
 * - Unread / starred status filters
 * - Threaded mode (fetches `/threads`)
 * - Display density toggle (comfortable / compact / default)
 * - Keyboard shortcuts for navigation, selection, and email actions
 * - Drag-and-drop (initiation)
 * - Quick actions: star, archive, trash on individual rows
 *
 * Emits a `select` event when the user clicks a row, so a parent 3-panel
 * layout can display the email detail alongside.
 *
 * @extends Tac
 *
 * @prop {InboxViewProps} [props] - Optional props for the inbox view
 */
export default class extends Tac {
  /** @type {Array<object>} Full list of emails across all folders */
  $allEmails = []
  /** @type {boolean} */
  $loading = true
  /** @type {string} */
  $error = ''
  /** @type {string} Currently selected folder name */
  $selectedFolder = this.props?.folder || (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('folder') : null) || 'inbox'
  /** @type {string} Current search / filter query text */
  $search = ''
  /** @type {string} Status filter: 'all', 'unread', or 'starred' */
  $statusFilter = 'all'
  /** @type {string} ID of the currently selected email row */
  $selectedId = ''
  /** @type {string} Display density: 'comfortable', 'compact', or 'default' */
  $density = 'comfortable'
  /** @type {boolean} Whether threaded (conversation) mode is enabled */
  $threadedMode = false
  /** @type {Array<object>} Thread objects returned when threaded mode is on */
  $threads = []
  /** @type {Record<string, boolean>} Map of expanded thread subject keys */
  $expandedThreads = {}

  /**
   * @description Capitalised display name for the currently selected folder.
   * @returns {string}
   */
  get folderTitle() {
    const name = this.$selectedFolder || 'inbox'
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  /**
   * @description Deduplicated list of folder names across all emails. Always
   * includes 'inbox', 'archive', 'snoozed', and 'trash' first, followed by any
   * custom folders sorted alphabetically.
   * @returns {string[]}
   */
  get folders() {
    const fs = new Set(this.$allEmails.map(e => e.folder || 'inbox'))
    return ['inbox', 'archive', 'snoozed', 'trash', ...Array.from(fs).filter(f => !['inbox', 'archive', 'snoozed', 'trash'].includes(f)).sort()]
  }

  /**
   * @description Emails filtered to the currently selected folder.
   * @returns {Array<object>}
   */
  get emails() { return this.$allEmails.filter(e => (e.folder || 'inbox') === this.$selectedFolder) }

  /**
   * @description Total count of unread emails across all folders (excluding trash).
   * @returns {number}
   */
  get unreadCount() { return this.$allEmails.filter(e => !e.read && (e.folder || 'inbox') !== 'trash').length }

  /**
   * Count emails in a specific folder.
   *
   * @param {string} name - The folder name
   * @returns {number}
   */
  folderCount(name) { return this.$allEmails.filter(e => (e.folder || 'inbox') === name).length }

  /**
   * @description Capitalised label for the current density setting, used for UI toggle display.
   * @returns {string}
   */
  get $densityLabel() { return this.$density.charAt(0).toUpperCase() + this.$density.slice(1) }

  /**
   * Initialise the inbox: restore the saved density preference from localStorage
   * and load the email list.
   *
   * @async
   * @returns {Promise<void>}
   */
  @onMount
  async init() {
    const saved = localStorage.getItem('hermes-density')
    if (saved && ['comfortable', 'compact', 'default'].includes(saved)) {
      this.$density = saved
    }
    await this.load()
  }

  /**
   * Bind a global `hermes:refresh-inbox` listener that reloads the email list.
   *
   * Any previously bound handler is removed first to prevent duplicate listeners
   * when the component re-mounts.
   *
   * @returns {void}
   */
  @onMount
  bindRefresh() {
    window.removeEventListener('hermes:refresh-inbox', window._hermesInboxRefresh)
    window._hermesInboxRefresh = () => this.load()
    window.addEventListener('hermes:refresh-inbox', window._hermesInboxRefresh)
  }

  /**
   * Load the email list from the API, respecting current filters.
   *
   * - In threaded mode, fetches from `/threads`
   * - When the search term looks like a structured query (contains field:
   *   patterns), delegates to {@link search}
   * - Otherwise fetches from `/inbox` with optional `q`, `read`, and `starred`
   *   query parameters
   *
   * @async
   * @returns {Promise<void>}
   */
  async load() {
    this.$loading = true; this.$error = ''
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) { this.$loading = false; return }
    try {
    // Threaded mode: fetch from /threads
    if (this.$threadedMode) {
      const threadParams = new URLSearchParams()
      if (this.$selectedFolder) threadParams.set('folder', this.$selectedFolder)
      const threadSuffix = threadParams.toString() ? `?${threadParams.toString()}` : ''
      const threadRes = await apiFetch(`/threads${threadSuffix}`)
      this.$threads = threadRes?.ok ? await threadRes.json() : []
      this.$loading = false
      return
    }

    // If the search term contains query syntax or the user typed a search,
    // use the dedicated /search endpoint which supports the full query syntax
    // (from:, to:, subject:, has:attachment, is:unread, before:, after:, etc.)
    if (this.$search.trim() && this._looksLikeSearchQuery(this.$search)) {
      await this.search(this.$search)
      return
    }
    const params = new URLSearchParams()
    if (this.$search.trim()) params.set('q', this.$search.trim())
    if (this.$statusFilter === 'unread') params.set('read', 'false')
    if (this.$statusFilter === 'starred') params.set('starred', 'true')
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const res = await apiFetch(`/inbox${suffix}`)
    this.$allEmails = res?.ok ? await res.json() : []
    } catch (err) {
      this.$error = err.message || 'Failed to load emails'
      this.$allEmails = []
    }
    this.$loading = false
  }

  /**
   * Performs a full-text search using the /search endpoint with Gmail-like
   * query syntax support (from:, to:, subject:, has:attachment, is:unread,
   * before:, after:, etc.).
   *
   * @async
   * @param {string} q - The search query
   * @returns {Promise<void>}
   */
  async search(q) {
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) { this.$loading = false; return }
    const res = await apiFetch(`/search?q=${encodeURIComponent(q)}`)
    this.$allEmails = res?.ok ? await res.json() : []
    this.$loading = false
  }

  /**
   * Returns true if the search string looks like a structured search query
   * (contains field:value patterns or boolean flags like is:unread).
   *
   * @param {string} s - The raw search input
   * @returns {boolean}
   */
  _looksLikeSearchQuery(s) {
    return /(?:from|to|subject|body|before|after|has|is|filename|attachment):/i.test(s)
  }

  /**
   * Update a specific email via the API and refresh the local list.
   *
   * @async
   * @param {object} email - The email object to update
   * @param {Record<string, any>} patch - Key/value pairs to update
   * @returns {Promise<object>} The updated email object, or the original on failure
   */
  async updateEmail(email, patch) {
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return email
    const res = await apiFetch(`/inbox/${email.id}`, { method: 'PUT', body: JSON.stringify(patch) })
    if (!res?.ok) return email
    const updated = await res.json()
    this.$allEmails = this.$allEmails.map(item => item.id === updated.id ? updated : item)
    return updated
  }

  /**
   * Clear the search input and status filter, then reload the inbox.
   *
   * @async
   * @returns {Promise<void>}
   */
  async clearSearch() { this.$search = ''; this.$statusFilter = 'all'; await this.load() }

  /**
   * Cycle through the three density presets: comfortable -> compact -> default.
   *
   * Persists the selection to localStorage.
   *
   * @returns {void}
   */
  toggleDensity() {
    const cycle = { comfortable: 'compact', compact: 'default', default: 'comfortable' }
    this.$density = cycle[this.$density] || 'comfortable'
    localStorage.setItem('hermes-density', this.$density)
  }

  /**
   * Toggle threaded (conversation) mode on or off and reload the list.
   *
   * Resets expanded thread state and selected email when switching modes.
   *
   * @async
   * @returns {Promise<void>}
   */
  async toggleThreadMode() {
    this.$threadedMode = !this.$threadedMode
    this.$expandedThreads = {}
    this.$selectedId = ''
    await this.load()
  }

  /**
   * Expand or collapse a thread by its subject line.
   *
   * @param {string} subject - The thread subject identifying the conversation group
   * @returns {void}
   */
  toggleThread(subject) {
    const expanded = { ...this.$expandedThreads }
    if (expanded[subject]) {
      delete expanded[subject]
    } else {
      expanded[subject] = true
    }
    this.$expandedThreads = expanded
  }

  /**
   * Select an email row by ID and emit a `select` event to parent components.
   *
   * @param {string} id - The email ID to select
   * @returns {void}
   */
  selectEmail(id) {
    this.$selectedId = id
    this.emit('select', id)
  }

  /**
   * Initialise a drag operation for an email row.
   *
   * @param {string} id - The email ID being dragged
   * @param {DragEvent} event - The native dragstart event
   * @returns {void}
   */
  dragStart(id, event) {
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
  }

  /**
   * Toggle the starred state of an email via a quick inline action.
   *
   * @async
   * @param {string} id - The email ID to star / unstar
   * @param {Event} e - The click event (propagation is stopped)
   * @returns {Promise<void>}
   */
  async quickStar(id, e) { e.stopPropagation(); const row = this.$allEmails.find(m => m.id === id); if (!row) return; await window._hermes?.apiFetch(`/inbox/${id}`, { method: 'PUT', body: JSON.stringify({ starred: !row.starred }) }); row.starred = !row.starred; this.$allEmails = [...this.$allEmails]; window._hermes?.toast(row.starred ? 'Starred' : 'Unstarred') }

  /**
   * Archive an email via a quick inline action.
   *
   * @async
   * @param {string} id - The email ID to archive
   * @param {Event} e - The click event (propagation is stopped)
   * @returns {Promise<void>}
   */
  async quickArchive(id, e) { e.stopPropagation(); await window._hermes?.apiFetch(`/inbox/${id}`, { method: 'PUT', body: JSON.stringify({ folder: 'archive' }) }); this.$allEmails = this.$allEmails.filter(m => m.id !== id); window._hermes?.toast('Archived') }

  /**
   * Move an email to trash via a quick inline action.
   *
   * @async
   * @param {string} id - The email ID to trash
   * @param {Event} e - The click event (propagation is stopped)
   * @returns {Promise<void>}
   */
  async quickTrash(id, e) { e.stopPropagation(); await window._hermes?.apiFetch(`/inbox/${id}`, { method: 'PUT', body: JSON.stringify({ folder: 'trash' }) }); this.$allEmails = this.$allEmails.filter(m => m.id !== id); window._hermes?.toast('Moved to trash') }

  // ── Keyboard shortcuts ────────────────────────────────────────────

  /**
   * Bind global keyboard-shortcut listeners for inbox navigation and actions.
   *
   * Shortcuts:
   * - `navigation:next-email` / `navigation:prev-email` — move selection
   * - `navigation:scroll-down` / `navigation:scroll-up` — scroll the list
   * - `email:star`, `email:archive`, `email:trash` — quick actions on selected
   * - `email:mark-read`, `email:mark-unread` — toggle read status
   * - `email:open` — open the selected email
   * - `core:select-all` / `core:deselect-all` — bulk selection helpers
   *
   * @returns {void}
   */
  @onMount
  bindShortcuts() {
    this._shortcuts = {
      'navigation:next-email': () => this._moveSelection(1),
      'navigation:prev-email': () => this._moveSelection(-1),
      'navigation:scroll-down': () => this._scrollList(200),
      'navigation:scroll-up': () => this._scrollList(-200),
      'email:star': () => this._shortcutAction('star'),
      'email:archive': () => this._shortcutAction('archive'),
      'email:trash': () => this._shortcutAction('trash'),
      'email:mark-read': () => this._shortcutAction('mark-read'),
      'email:mark-unread': () => this._shortcutAction('mark-unread'),
      'email:open': () => { if (this.$selectedId) window._hermes?.openEmailId(this.$selectedId) },
      'core:select-all': () => this._selectAll(),
      'core:deselect-all': () => { this.$selectedId = '' },
    }

    for (const [name, handler] of Object.entries(this._shortcuts)) {
      window.addEventListener('hermes:shortcut:' + name, handler)
    }
  }

  /**
   * Move the selection highlight up or down in the email list.
   *
   * Automatically scrolls the newly selected row into view.
   *
   * @param {number} direction - +1 for next, -1 for previous
   * @returns {void}
   */
  _moveSelection(direction) {
    const list = this.emails
    if (list.length === 0) return
    const idx = list.findIndex(e => e.id === this.$selectedId)
    if (idx < 0) {
      this.selectEmail(list[0].id)
    } else {
      const next = Math.min(Math.max(0, idx + direction), list.length - 1)
      this.selectEmail(list[next].id)
    }
    // Scroll the selected row into view
    const row = document.querySelector('.email-row.selected')
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  /**
   * Scroll the email list container by a given pixel amount.
   *
   * Falls back to `window.scrollBy` if the `.inbox-list` element is not found.
   *
   * @param {number} amount - Pixels to scroll (positive = down, negative = up)
   * @returns {void}
   */
  _scrollList(amount) {
    const list = document.querySelector('.inbox-list')
    if (list) list.scrollBy({ top: amount, behavior: 'smooth' })
    else window.scrollBy({ top: amount, behavior: 'smooth' })
  }

  /**
   * Perform a shortcut-triggered action on the currently selected email.
   *
   * @async
   * @param {'star'|'archive'|'trash'|'mark-read'|'mark-unread'} type - The action to perform
   * @returns {Promise<void>}
   */
  async _shortcutAction(type) {
    const id = this.$selectedId
    if (!id) return
    const email = this.$allEmails.find(e => e.id === id)
    if (!email) return

    switch (type) {
      case 'star':
        await this.quickStar(id, { stopPropagation: () => {} })
        break
      case 'archive':
        await this.quickArchive(id, { stopPropagation: () => {} })
        this.$selectedId = ''
        break
      case 'trash':
        await this.quickTrash(id, { stopPropagation: () => {} })
        this.$selectedId = ''
        break
      case 'mark-read':
        await this.updateEmail(email, { read: true })
        break
      case 'mark-unread':
        await this.updateEmail(email, { read: false })
        break
    }
  }

  /**
   * Select all visible emails (sets selection to the last email in the list).
   *
   * @returns {void}
   */
  _selectAll() {
    const list = this.emails
    if (list.length > 0) {
      this.$selectedId = list[list.length - 1].id
    }
  }
}
