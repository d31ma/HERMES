// @ts-check
export default class extends Tac {
  $email = null

  @onMount
  async init() {
    const routeEmailId = location.pathname.startsWith('/email/')
      ? decodeURIComponent(location.pathname.slice('/email/'.length))
      : new URLSearchParams(location.search).get('email') || new URLSearchParams(location.search).get('id') || ''
    const incomingProps = this.props || {}
    const propEmailId = incomingProps.emailId || incomingProps.emailid || routeEmailId
    this.$email = incomingProps.email || (propEmailId ? { id: propEmailId } : null)
    await this.loadEmail()
  }

  async loadEmail() {
    if (!this.$email?.id) return
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch(`/inbox/${this.$email.id}`)
    if (res?.ok) this.$email = await res.json()
    if (this.$email && !this.$email.read) {
      this.$email = { ...this.$email, read: true }
      await apiFetch(`/inbox/${this.$email.id}`, { method: 'PUT', body: JSON.stringify({ read: true }) })
      window.dispatchEvent(new Event('hermes:refresh-inbox'))
    }
  }

  async deleteEmail() {
    if (!this.$email || !confirm('Delete this message forever?')) return
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch(`/inbox/${this.$email.id}`, { method: 'DELETE' })
    if (res?.ok) { window._hermes?.toast('Message deleted.'); window.dispatchEvent(new Event('hermes:refresh-inbox')); window._hermes?.navigate('inbox'); this.$email = null }
    else { window._hermes?.toast('Delete failed.') }
  }

  async updateEmail(patch, message) {
    if (!this.$email) return
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    const res = await apiFetch(`/inbox/${this.$email.id}`, { method: 'PUT', body: JSON.stringify(patch) })
    if (res?.ok) { this.$email = await res.json(); window.dispatchEvent(new Event('hermes:refresh-inbox')); if (message) window._hermes?.toast(message) }
    else { window._hermes?.toast('Update failed.') }
  }

  reply() { if (!this.$email) return; this.emit('compose', { to: this.$email.sender, subject: `Re: ${this.$email.subject}` }) }

  async downloadAttachment(attachment) {
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch || !this.$email?.id) return
    const res = await apiFetch(`/inbox/${this.$email.id}/attachments/${attachment.id}`)
    if (!res?.ok) { window._hermes?.toast('Attachment download failed.'); return }
    const data = await res.json()
    const bytes = Uint8Array.from(atob(data.contentBase64), char => char.charCodeAt(0))
    const blob = new Blob([bytes], { type: data.contentType || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = data.filename || attachment.filename || 'attachment'
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
  }
}
