// @ts-check
export default class extends Tac {
  $to = ''
  $cc = ''
  $subject = ''
  $text = ''
  $loading = false
  $error = ''

  @onMount
  initFromPrefill() {
    const routePrefill = window._hermes?.consumeComposePrefill?.() || {}
    const prefill = (this.props || {}).prefill || routePrefill
    this.$to = prefill.to || ''
    this.$subject = prefill.subject || ''
  }

  @onMount
  bindShortcuts() {
    window.addEventListener('hermes:shortcut:composer:send', () => this.send())
    window.addEventListener('hermes:shortcut:composer:discard', () => {
      window._hermes?.navigate('inbox')
    })
  }

  async send() {
    if (!this.$to || !this.$subject) { this.$error = 'To and Subject are required.'; return }
    this.$loading = true; this.$error = ''
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) { this.$loading = false; return }
    try {
      const split = s => s.split(',').map(x => x.trim()).filter(Boolean)
      const res = await apiFetch('/send', { method: 'POST', body: JSON.stringify({ to: split(this.$to), cc: split(this.$cc), subject: this.$subject, text: this.$text, delayMs: 10000 }) })
      if (res?.ok) {
        const data = await res.json()
        this.$to = this.$cc = this.$subject = this.$text = ''
        window._hermes?.navigate('inbox')
        this._showUndoToast(data.undoId, 'Message sent. Undo')
      } else { const data = await res.json(); this.$error = data.error || 'Send failed.' }
    } catch { this.$error = 'Network error.' }
    finally { this.$loading = false }
  }

  async sendAndArchive() {
    if (!this.$to || !this.$subject) { this.$error = 'To and Subject are required.'; return }
    this.$loading = true; this.$error = ''
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) { this.$loading = false; return }
    try {
      const split = s => s.split(',').map(x => x.trim()).filter(Boolean)
      const res = await apiFetch('/send', { method: 'POST', body: JSON.stringify({ to: split(this.$to), cc: split(this.$cc), subject: this.$subject, text: this.$text, archive: true, delayMs: 10000 }) })
      if (res?.ok) {
        const data = await res.json()
        this.$to = this.$cc = this.$subject = this.$text = ''
        window._hermes?.navigate('inbox')
        this._showUndoToast(data.undoId, 'Sent & archived. Undo')
      } else { const data = await res.json(); this.$error = data.error || 'Send failed.' }
    } catch { this.$error = 'Network error.' }
    finally { this.$loading = false }
  }

  _showUndoToast(undoId, label) {
    if (!undoId) {
      window._hermes?.toast(label.replace('Undo', '').trim())
      return
    }
    window._hermes?.toastAction(label, {
      label: 'Undo',
      onClick: async () => {
        const apiFetch = window._hermes?.apiFetch
        if (!apiFetch) return
        try {
          const res = await apiFetch('/send/undo', { method: 'POST', body: JSON.stringify({ undoId }) })
          if (res?.ok) {
            window._hermes?.toast('Send undone.')
          } else {
            window._hermes?.toast('Could not undo send.')
          }
        } catch {
          window._hermes?.toast('Could not undo send.')
        }
      }
    }, 10000)
  }
}
