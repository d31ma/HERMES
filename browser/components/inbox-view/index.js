// @ts-check
export default class extends Tac {
  $allEmails = []
  $loading = true
  $selectedFolder = this.props?.folder || 'inbox'
  $search = ''
  $statusFilter = 'all'
  $selectedId = ''

  get folderTitle() {
    const name = this.$selectedFolder || 'inbox'
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  get folders() {
    const fs = new Set(this.$allEmails.map(e => e.folder || 'inbox'))
    return ['inbox', 'archive', 'trash', ...Array.from(fs).filter(f => !['inbox', 'archive', 'trash'].includes(f)).sort()]
  }

  get emails() { return this.$allEmails.filter(e => (e.folder || 'inbox') === this.$selectedFolder) }
  get unreadCount() { return this.$allEmails.filter(e => !e.read && (e.folder || 'inbox') !== 'trash').length }

  folderCount(name) { return this.$allEmails.filter(e => (e.folder || 'inbox') === name).length }

  @onMount
  async init() { await this.load() }

  @onMount
  bindRefresh() {
    window.removeEventListener('hermes:refresh-inbox', window._hermesInboxRefresh)
    window._hermesInboxRefresh = () => this.load()
    window.addEventListener('hermes:refresh-inbox', window._hermesInboxRefresh)
  }

  async load() {
    this.$loading = true
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) { this.$loading = false; return }
    const params = new URLSearchParams()
    if (this.$search.trim()) params.set('q', this.$search.trim())
    if (this.$statusFilter === 'unread') params.set('read', 'false')
    if (this.$statusFilter === 'starred') params.set('starred', 'true')
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const res = await apiFetch(`/inbox${suffix}`)
    this.$allEmails = res?.ok ? await res.json() : []
    this.$loading = false
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

  selectEmail(id) {
    this.$selectedId = id
    this.emit('select', id)
  }
}
