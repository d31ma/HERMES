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

  async send() {
    if (!this.$to || !this.$subject) { this.$error = 'To and Subject are required.'; return }
    this.$loading = true; this.$error = ''
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) { this.$loading = false; return }
    try {
      const split = s => s.split(',').map(x => x.trim()).filter(Boolean)
      const res = await apiFetch('/send', { method: 'POST', body: JSON.stringify({ to: split(this.$to), cc: split(this.$cc), subject: this.$subject, text: this.$text }) })
      if (res?.ok) {
        window._hermes?.toast('Message sent.')
        this.$to = this.$cc = this.$subject = this.$text = ''
        window._hermes?.navigate('inbox')
      } else { const data = await res.json(); this.$error = data.error || 'Send failed.' }
    } catch { this.$error = 'Network error.' }
    finally { this.$loading = false }
  }
}
