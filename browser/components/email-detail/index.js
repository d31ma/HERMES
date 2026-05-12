// @ts-check
export default class extends Tac {
  $email = null
  $loading = true
  $loadError = ''
  $showReply = false
  $replyText = ''

  @onMount
  async init() {
    const props = this.props || {}
    // Accept emailId from parent (3-panel layout) or from route (standalone page)
    const emailId = props.emailId || props.emailid
      || (location.pathname.startsWith('/email/') ? decodeURIComponent(location.pathname.slice('/email/'.length)) : '')
      || new URLSearchParams(location.search).get('email')
      || new URLSearchParams(location.search).get('id') || ''
    this.$email = props.email || (emailId ? { id: emailId } : null)
    await this.loadEmail()
  }

  async loadEmail() {
    if (!this.$email?.id) return
    this.$loading = true; this.$loadError = ''
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) { this.$loading = false; return }
    try {
      const res = await apiFetch(`/inbox/${this.$email.id}`)
      if (res?.ok) this.$email = await res.json()
      else this.$loadError = 'Could not load this email.'
      if (this.$email && !this.$email.read) {
        this.$email = { ...this.$email, read: true }
        await apiFetch(`/inbox/${this.$email.id}`, { method: 'PUT', body: JSON.stringify({ read: true }) })
        window.dispatchEvent(new Event('hermes:refresh-inbox'))
      }
    } catch (err) {
      this.$loadError = err.message || 'Network error'
    } finally {
      this.$loading = false
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

  goBack() {
    if (this.props?.onBack) return this.emit('back')
    window._hermes?.navigate('inbox')
  }

  reply() {
    if (!this.$email) return
    window._hermes?.compose({ to: this.$email.sender, subject: `Re: ${this.$email.subject}` })
  }

  replyAll() {
    if (!this.$email) return
    const to = [this.$email.sender, this.$email.recipient].filter(Boolean).join(', ')
    window._hermes?.compose({ to, subject: `Re: ${this.$email.subject}` })
  }

  forward() {
    if (!this.$email) return
    window._hermes?.compose({ subject: `Fwd: ${this.$email.subject}`, body: `\n\n---------- Forwarded message ----------\nFrom: ${this.$email.sender}\nDate: ${new Date(this.$email.receivedAt).toLocaleString()}\nSubject: ${this.$email.subject}\n\n${this.$email.body || ''}` })
  }

  async sendReply() {
    if (!this.$email || !this.$replyText) return
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    try {
      const res = await apiFetch('/send', { method: 'POST', body: JSON.stringify({ to: [this.$email.sender], subject: `Re: ${this.$email.subject}`, text: this.$replyText }) })
      if (res?.ok) { window._hermes?.toast('Reply sent.'); this.$showReply = false; this.$replyText = '' }
      else { window._hermes?.toast('Send failed.') }
    } catch { window._hermes?.toast('Network error.') }
  }

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
