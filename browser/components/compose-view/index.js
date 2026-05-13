// @ts-check

/**
 * @typedef {object} ComposePrefill
 * @property {string} [to] - Pre-fill the To field
 * @property {string} [cc] - Pre-fill the CC field
 * @property {string} [subject] - Pre-fill the Subject field
 * @property {string} [body] - Pre-fill the message body
 */

/**
 * Email composition component.
 *
 * Renders a rich-text compose form with support for:
 * - Bold, italic, lists, and link formatting via `execCommand`
 * - Message templates (saved and loaded from the API)
 * - Default signatures loaded from the API
 * - Send now, send later (scheduled), and send & archive
 * - Read-receipt tracking pixels and click-tracking link rewriting
 * - Keyboard shortcut bindings for send and discard
 *
 * Accepts an optional `prefill` prop to seed the To, Subject, and body fields
 * (e.g. when replying or forwarding). It also checks `window._hermes` for a
 * route-based prefill payload.
 *
 * @extends Tac
 *
 * @prop {ComposePrefill} [props.prefill] - Optional prefill data for the compose form
 */
export default class extends Tac {
  /** @type {string} */
  $to = ''
  /** @type {string} */
  $cc = ''
  /** @type {string} */
  $subject = ''
  /** @type {string} */
  $text = ''
  /** @type {boolean} */
  $loading = false
  /** @type {string} */
  $error = ''
  /** @type {Array<{ id: string, name: string, subject?: string, text?: string, to?: string, cc?: string }>} */
  $templates = []
  /** @type {boolean} Whether to append a read-receipt tracking pixel */
  $requestReadReceipt = false
  /** @type {boolean} Whether to rewrite outbound links through the click-tracking proxy */
  $trackLinks = false

  /**
   * Initialise the compose form from route prefill data or component props.
   *
   * Checks `window._hermes.consumeComposePrefill()` first (route-level prefill),
   * then falls back to `this.props.prefill`. After seeding fields it loads
   * templates and the default signature, then syncs the rich-text editor.
   *
   * @async
   * @returns {Promise<void>}
   */
  @onMount
  async initFromPrefill() {
    const routePrefill = window._hermes?.consumeComposePrefill?.() || {}
    const prefill = /** @type {{to?: string, subject?: string}} */ ((this.props || {}).prefill || routePrefill)
    this.$to = prefill.to || ''
    this.$subject = prefill.subject || ''
    await this.loadTemplates()
    await this._loadDefaultSignature()
    this._syncEditorContent()
  }

  /**
   * Load the user's default signature from the `/signatures` API and insert
   * it into the editor body when no text is already present.
   *
   * @async
   * @returns {Promise<void>}
   */
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

  /**
   * Push the current `$text` value into the rich-text editor's `innerHTML`.
   *
   * Scheduled on the next animation frame so the DOM element exists by the
   * time it is queried.
   *
   * @returns {void}
   */
  _syncEditorContent() {
    requestAnimationFrame(() => {
      const editor = document.querySelector('[data-compose-editor]')
      if (editor) editor.innerHTML = this.$text || ''
    })
  }

  /**
   * Read the current HTML content from the rich-text editor.
   *
   * Falls back to the reactive `$text` field if the editor element is not in
   * the DOM.
   *
   * @returns {string} The editor's innerHTML or the `$text` fallback
   */
  _getEditorHTML() {
    const editor = document.querySelector('[data-compose-editor]')
    return editor ? editor.innerHTML : (this.$text || '')
  }

  /**
   * Read the current plain-text content from the rich-text editor.
   *
   * Uses `innerText` (preferred) or `textContent` for cross-browser support.
   *
   * @returns {string} The editor's plain-text content or the `$text` fallback
   */
  _getEditorText() {
    const editor = document.querySelector('[data-compose-editor]')
    return editor ? (/** @type {HTMLElement} */ (editor).innerText || editor.textContent || '') : (this.$text || '')
  }

  /**
   * Clear the rich-text editor content and reset the reactive text field.
   *
   * @returns {void}
   */
  _clearEditor() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) editor.innerHTML = ''
    this.$text = ''
  }

  /**
   * Execute the "bold" command on the rich-text editor selection.
   *
   * @returns {void}
   */
  execBold() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) { /** @type {HTMLElement} */ (editor).focus(); document.execCommand('bold') }
  }

  /**
   * Execute the "italic" command on the rich-text editor selection.
   *
   * @returns {void}
   */
  execItalic() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) { /** @type {HTMLElement} */ (editor).focus(); document.execCommand('italic') }
  }

  /**
   * Insert an unordered (bullet) list at the current cursor position.
   *
   * @returns {void}
   */
  execBulletList() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) { /** @type {HTMLElement} */ (editor).focus(); document.execCommand('insertUnorderedList') }
  }

  /**
   * Insert an ordered (numbered) list at the current cursor position.
   *
   * @returns {void}
   */
  execNumberedList() {
    const editor = document.querySelector('[data-compose-editor]')
    if (editor) { /** @type {HTMLElement} */ (editor).focus(); document.execCommand('insertOrderedList') }
  }

  /**
   * Prompt the user for a URL and create a hyperlink on the current selection.
   *
   * @returns {void}
   */
  execLink() {
    const editor = document.querySelector('[data-compose-editor]')
    if (!editor) return
    /** @type {HTMLElement} */ (editor).focus()
    const url = prompt('Enter URL:')
    if (url) document.execCommand('createLink', false, url)
  }

  /**
   * Fetch saved message templates from the `/templates` API.
   *
   * @async
   * @returns {Promise<void>}
   */
  async loadTemplates() {
    const apiFetch = window._hermes?.apiFetch
    if (!apiFetch) return
    try {
      const res = await apiFetch('/templates')
      if (res?.ok) this.$templates = await res.json()
    } catch { /* templates unavailable */ }
  }

  /**
   * Save the current compose form as a reusable template.
   *
   * Prompts the user for a template name, then persists the current To, CC,
   * Subject, and editor HTML to the `/templates` API.
   *
   * @async
   * @returns {Promise<void>}
   */
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

  /**
   * Load a selected template's values into the compose form.
   *
   * When the form already has content, the user is prompted to confirm before
   * the existing fields are overwritten.
   *
   * @param {Event} event - The change event from the template `<select>` element
   * @returns {void}
   */
  loadTemplate(event) {
    const id = /** @type {HTMLInputElement} */ (event?.target)?.value
    if (!id) return
    const tpl = this.$templates.find(t => t.id === id)
    if (!tpl) return
    if (this.$to || this.$subject || this.$text) {
      if (!confirm('Loading a template will replace current fields. Continue?')) {
        const targetEl2 = /** @type {HTMLInputElement} */ (event.target);
        targetEl2.value = '';
        return
      }
    }
    this.$to = tpl.to || this.$to
    this.$cc = tpl.cc || this.$cc
    this.$subject = tpl.subject || this.$subject
    this.$text = tpl.text || this.$text
    const targetEl = /** @type {HTMLInputElement} */ (event.target);
    targetEl.value = '';
    this._syncEditorContent()
  }

  /**
   * Schedule the email to be sent at a future time.
   *
   * Presents the user with preset times (tomorrow morning/afternoon, next
   * Monday) or a custom date/time input. The chosen time is sent as the
   * `sendAt` field in the payload.
   *
   * @async
   * @returns {Promise<void>}
   */
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
        const data = await res?.json(); this.$error = data?.error || 'Schedule failed.'
      }
    } catch { this.$error = 'Network error.' }
    finally { this.$loading = false }
  }

  /**
   * Bind global keyboard-shortcut listeners for the composer.
   *
   * - `hermes:shortcut:composer:send` triggers {@link send}
   * - `hermes:shortcut:composer:discard` navigates back to the inbox
   *
   * @returns {void}
   */
  @onMount
  bindShortcuts() {
    window.addEventListener('hermes:shortcut:composer:send', () => this.send())
    window.addEventListener('hermes:shortcut:composer:discard', () => {
      window._hermes?.navigate('inbox')
    })
  }

  /**
   * Prepares the HTML body with tracking features if enabled:
   * - Read receipt: appends a 1x1 tracking pixel `<img>` tag
   * - Link tracking: rewrites `<a href="...">` links to go through the
   *   `/track/click` redirect proxy
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
   *
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

  /**
   * Send the email immediately.
   *
   * Validates that To and Subject are filled, builds the payload (with a 10 s
   * delay for undo support), posts to `/send`, and clears the form on success.
   * Displays an undo toast so the user can recall the message within the delay
   * window.
   *
   * @async
   * @returns {Promise<void>}
   */
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
      } else { const data = await res?.json(); this.$error = data?.error || 'Send failed.' }
    } catch { this.$error = 'Network error.' }
    finally { this.$loading = false }
  }

  /**
   * Send the email immediately AND archive the thread in one action.
   *
   * Same as {@link send} but includes `archive: true` in the payload.
   *
   * @async
   * @returns {Promise<void>}
   */
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
      } else { const data = await res?.json(); this.$error = data?.error || 'Send failed.' }
    } catch { this.$error = 'Network error.' }
    finally { this.$loading = false }
  }

  /**
   * Display an undo toast that lets the user recall a sent message.
   *
   * If no `undoId` is provided, fall back to a plain toast. The toast is
   * automatically dismissed after 10 seconds.
   *
   * @param {string} undoId - The server-side undo identifier for the sent message
   * @param {string} label - Label text for the toast button
   * @returns {void}
   */
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
