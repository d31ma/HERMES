// @ts-check
export default class extends Tac {
  $allEmails = []
  $loading = true
  $error = ''
  $selectedFolder = this.props?.folder || (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('folder') : null) || 'inbox'
  $search = ''
  $statusFilter = 'all'
  $selectedId = ''
  $density = 'comfortable'
  $threadedMode = false
  $threads = []
  $expandedThreads = {}

  get folderTitle() {
    const name = this.$selectedFolder || 'inbox'
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  get folders() {
    const fs = new Set(this.$allEmails.map(e => e.folder || 'inbox'))
    return ['inbox', 'archive', 'snoozed', 'trash', ...Array.from(fs).filter(f => !['inbox', 'archive', 'snoozed', 'trash'].includes(f)).sort()]
  }

  get emails() { return this.$allEmails.filter(e => (e.folder || 'inbox') === this.$selectedFolder) }
  get unreadCount() { return this.$allEmails.filter(e => !e.read && (e.folder || 'inbox') !== 'trash').length }

  folderCount(name) { return this.$allEmails.filter(e => (e.folder || 'inbox') === name).length }

  get $densityLabel() { return this.$density.charAt(0).toUpperCase() + this.$density.slice(1) }

  @onMount
  async init() {
    const saved = localStorage.getItem('hermes-density')
    if (saved && ['comfortable', 'compact', 'default'].includes(saved)) {
      this.$density = saved
    }
    await this.load()
  }

  @onMount
  bindRefresh() {
    window.removeEventListener('hermes:refresh-inbox', window._hermesInboxRefresh)
    window._hermesInboxRefresh = () => this.load()
    window.addEventListener('hermes:refresh-inbox', window._hermesInboxRefresh)
  }

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
   * @param {string} q - The search query
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
   * @param {string} s
   * @returns {boolean}
   */
  _looksLikeSearchQuery(s) {
    return /(?:from|to|subject|body|before|after|has|is|filename|attachment):/i.test(s)
  }

  async updateEmail(email, patch) {
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return email
    const res = await apiFetch(`/inbox/${email.id}`, { method: 'PUT', body: JSON.stringify(patch) })
    if (!res?.ok) return email
    const updated = await res.json()
    this.$allEmails = this.$allEmails.map(item => item.id === updated.id ? updated : item)
    return updated
  }

  async clearSearch() { this.$search = ''; this.$statusFilter = 'all'; await this.load() }

  toggleDensity() {
    const cycle = { comfortable: 'compact', compact: 'default', default: 'comfortable' }
    this.$density = cycle[this.$density] || 'comfortable'
    localStorage.setItem('hermes-density', this.$density)
  }

  async toggleThreadMode() {
    this.$threadedMode = !this.$threadedMode
    this.$expandedThreads = {}
    this.$selectedId = ''
    await this.load()
  }

  toggleThread(subject) {
    const expanded = { ...this.$expandedThreads }
    if (expanded[subject]) {
      delete expanded[subject]
    } else {
      expanded[subject] = true
    }
    this.$expandedThreads = expanded
  }

  selectEmail(id) {
    this.$selectedId = id
    this.emit('select', id)
  }

  dragStart(id, event) {
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
  }

  async quickStar(id, e) { e.stopPropagation(); const row = this.$allEmails.find(m => m.id === id); if (!row) return; await window._hermes?.apiFetch(`/inbox/${id}`, { method: 'PUT', body: JSON.stringify({ starred: !row.starred }) }); row.starred = !row.starred; this.$allEmails = [...this.$allEmails]; window._hermes?.toast(row.starred ? 'Starred' : 'Unstarred') }
  async quickArchive(id, e) { e.stopPropagation(); await window._hermes?.apiFetch(`/inbox/${id}`, { method: 'PUT', body: JSON.stringify({ folder: 'archive' }) }); this.$allEmails = this.$allEmails.filter(m => m.id !== id); window._hermes?.toast('Archived') }
  async quickTrash(id, e) { e.stopPropagation(); await window._hermes?.apiFetch(`/inbox/${id}`, { method: 'PUT', body: JSON.stringify({ folder: 'trash' }) }); this.$allEmails = this.$allEmails.filter(m => m.id !== id); window._hermes?.toast('Moved to trash') }

  // ── Keyboard shortcuts ────────────────────────────────────────────

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

  _scrollList(amount) {
    const list = document.querySelector('.inbox-list')
    if (list) list.scrollBy({ top: amount, behavior: 'smooth' })
    else window.scrollBy({ top: amount, behavior: 'smooth' })
  }

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

  _selectAll() {
    const list = this.emails
    if (list.length > 0) {
      this.$selectedId = list[list.length - 1].id
    }
  }
}
