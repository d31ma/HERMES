// @ts-check
export default class extends Tac {
  $to = ''
  $cc = ''
  $subject = ''
  $text = ''
  $loading = false
  $error = ''
  $templates = []
  $requestReadReceipt = false
  $trackLinks = false

  @onMount
  async initFromPrefill() {
    const routePrefill = window._hermes?.consumeComposePrefill?.() || {}
    const prefill = (this.props || {}).prefill || routePrefill
    this.$to = prefill.to || ''
    this.$subject = prefill.subject || ''
    await this.loadTemplates()
    await this._loadDefaultSignature()
    this._syncEditorContent()
  }

  async _loadDefaultSignature() {
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) return
    try {
      const res = await apiFetch('/signatures')
      if (res?.ok) {
        const signatures = await res.json()
        if (signatures.length > 0 && !this.$text) {
          this.$text = signatures[0].text
        }
      }
    } catch { /* signatures unavailable */ }
  }

  _syncEditorContent() {
    requestAnimationFrame(() => {
      const editor = document.querySelector('[data-compose-editor]')
      if (editor) editor.innerHTML = this.$text || ''
    })
  }

  _getEditorHTML() {
    const editor = document.querySelector('[data-compose-editor]')
    return editor ? editor.innerHTML : (this.$text || '')
  }

  _getEditorText() {
    const editor = document.querySelector('[data-compose-editor]')
    return editor ? (editor.innerText || editor.textContent || '') : (this.$text || '')
  }

  _clearEditor() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) editor.innerHTML = ''
    this.$text = ''
  }

  execBold() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) { editor.focus(); document.execCommand('bold') }
  }

  execItalic() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) { editor.focus(); document.execCommand('italic') }
  }

  execBulletList() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) { editor.focus(); document.execCommand('insertUnorderedList') }
  }

  execNumberedList() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) { editor.focus(); document.execCommand('insertOrderedList') }
  }

  execLink() {
    const editor = document.querySelector('[data-compose-editor]')
    if (!editor) return
    editor.focus()
    const url = prompt('Enter URL:')
    if (url) document.execCommand('createLink', false, url)
  }

  async loadTemplates() {
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) return
    try {
      const res = await apiFetch('/templates')
      if (res?.ok) this.$templates = await res.json()
    } catch { /* templates unavailable */ }
  }

  async saveTemplate() {
    const name = prompt('Template name:')
    if (!name || !name.trim()) return
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) return
    try {
      const res = await apiFetch('/templates', { method: 'POST', body: JSON.stringify({ name: name.trim(), subject: this.$subject, text: this._getEditorHTML(), to: this.$to, cc: this.$cc }) })
      if (res?.ok) {
        window._hermes?.toast('Template saved.')
        await this.loadTemplates()
      } else {
        window._hermes?.toast('Failed to save template.')
      }
    } catch { window._hermes?.toast('Network error.') }
  }

  loadTemplate(event) {
    const id = event?.target?.value
    if (!id) return
    const tpl = this.$templates.find(t => t.id === id)
    if (!tpl) return
    if (this.$to || this.$subject || this.$text) {
      if (!confirm('Loading a template will replace current fields. Continue?')) {
        event.target.value = ''
        return
      }
    }
    this.$to = tpl.to || this.$to
    this.$cc = tpl.cc || this.$cc
    this.$subject = tpl.subject || this.$subject
    this.$text = tpl.text || this.$text
    event.target.value = ''
    this._syncEditorContent()
  }

  async sendLater() {
    if (!this.$to || !this.$subject) { this.$error = 'To and Subject are required.'; return }
    const presets = [
      { label: 'Tomorrow morning (8 AM)', hours: null, time: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.toISOString() } },
      { label: 'Tomorrow afternoon (2 PM)', hours: null, time: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(14, 0, 0, 0); return d.toISOString() } },
      { label: 'Next Monday (8 AM)', hours: null, time: () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(8, 0, 0, 0); return d.toISOString() } },
      { label: 'Custom…', hours: null, time: null },
    ]
    const options = presets.map((p, i) => `${i + 1}. ${p.label}`).join('\n')
    const choice = prompt('Schedule send for:\n\n' + options)
    if (!choice) return
    const selected = presets.find((p, i) => choice.trim() === String(i + 1) || choice.trim().toLowerCase() === p.label.toLowerCase())
    let sendAt
    if (selected && selected.time) {
      sendAt = selected.time()
    } else {
      const custom = prompt('Enter date/time (e.g. 2026-12-31T14:00):')
      if (!custom) return
      sendAt = new Date(Date.parse(custom)).toISOString()
      if (Date.parse(sendAt) <= Date.now()) { window._hermes?.toast('Please choose a future time.'); return }
    }
    this.$loading = true; this.$error = ''
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) { this.$loading = false; return }
    try {
      const payload = this._buildPayload({ sendAt })
      const res = await apiFetch('/send', { method: 'POST', body: JSON.stringify(payload) })
      if (res?.ok) {
        this.$to = this.$cc = this.$subject = ''; this._clearEditor()
        window._hermes?.toast('Scheduled for ' + new Date(sendAt).toLocaleString())
        window._hermes?.navigate('inbox')
      } else {
        const data = await res.json(); this.$error = data.error || 'Schedule failed.'
      }
    } catch { this.$error = 'Network error.' }
    finally { this.$loading = false }
  }

  @onMount
  bindShortcuts() {
    window.addEventListener('hermes:shortcut:composer:send', () => this.send())
    window.addEventListener('hermes:shortcut:composer:discard', () => {
      window._hermes?.navigate('inbox')
    })
  }

  /**
   * Prepares the HTML body with tracking features if enabled:
   * - Read receipt: appends a 1x1 tracking pixel <img> tag
   * - Link tracking: rewrites <a href="..."> links to go through the
   *   /track/click redirect proxy
   *
   * @returns {{ html: string, trackingId: string }}
   */
  _prepareTrackingBody() {
    const apiUrl = (window.HERMES_CONFIG?.apiUrl || '').replace(/\/+$/, '')
    let html = this._getEditorHTML()
    let trackingId = ''

    if (this.$requestReadReceipt) {
      trackingId = crypto.randomUUID()
      // Append a tracking pixel — a 1x1 invisible image that will
      // trigger the /track/open endpoint when the recipient opens the email.
      html += `<img src="${apiUrl}/track/open?id=${encodeURIComponent(trackingId)}" width="1" height="1" alt="">`
    }

    if (this.$trackLinks) {
      if (!trackingId) trackingId = crypto.randomUUID()
      // Rewrite each <a href="..."> link to point to the tracking redirect
      // proxy so we can record clicks before forwarding the recipient.
      html = html.replace(/<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi, (match, url) => {
        // Only rewrite http/https links (skip mailto:, #, etc.)
        if (!/^https?:\/\//i.test(url)) return match
        const redirectUrl = `${apiUrl}/track/click?url=${encodeURIComponent(url)}&id=${encodeURIComponent(trackingId)}`
        return match.replace(url, redirectUrl)
      })
    }

    return { html, trackingId }
  }

  /**
   * Builds the send request payload, incorporating tracking info.
   * @param {Record<string, any>} extra - Extra fields to merge into the payload
   * @returns {Record<string, any>}
   */
  _buildPayload(extra = {}) {
    const split = s => s.split(',').map(x => x.trim()).filter(Boolean)
    const { html, trackingId } = this._prepareTrackingBody()
    return {
      to: split(this.$to),
      cc: split(this.$cc),
      subject: this.$subject,
      html,
      text: this._getEditorText(),
      ...(trackingId ? { trackingId } : {}),
      ...extra,
    }
  }

  async send() {
    if (!this.$to || !this.$subject) { this.$error = 'To and Subject are required.'; return }
    this.$loading = true; this.$error = ''
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) { this.$loading = false; return }
    try {
      const payload = this._buildPayload({ delayMs: 10000 })
      const res = await apiFetch('/send', { method: 'POST', body: JSON.stringify(payload) })
      if (res?.ok) {
        const data = await res.json()
        this.$to = this.$cc = this.$subject = ''; this._clearEditor()
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
      const payload = this._buildPayload({ archive: true, delayMs: 10000 })
      const res = await apiFetch('/send', { method: 'POST', body: JSON.stringify(payload) })
      if (res?.ok) {
        const data = await res.json()
        this.$to = this.$cc = this.$subject = ''; this._clearEditor()
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
