// @ts-check

/**
 * @typedef {object} EmailDetailProps
 * @property {string} [emailId] - ID of the email to load (parent prop)
 * @property {string} [emailid] - Alternate casing for email ID
 * @property {object} [email] - Pre-loaded email object (avoids a fetch)
 * @property {() => void} [onBack] - Callback invoked when the user clicks back
 */

/**
 * Email detail / reader component.
 *
 * Displays a single email message with full headers, body, and attachments.
 * Supports the following actions:
 * - Reply, reply-all, forward
 * - Star / unstar
 * - Archive, trash, snooze
 * - Mark read / unread
 * - Attachment download
 * - Inline quick-reply
 *
 * The email to display can come from a parent component (3-panel layout) via
 * props, from the URL path (`/email/<id>`), or from query parameters.
 *
 * Keyboard shortcuts are bound via `caduceus:shortcut:email:*` events.
 *
 * @extends Tac
 *
 * @prop {EmailDetailProps} [props] - Props for the email detail view
 */
export default class extends Tac {
  /** @type {object|null} The loaded email object */
  $email = null
  /** @type {boolean} */
  $loading = true
  /** @type {string} */
  $loadError = ''
  /** @type {boolean} Whether the inline reply form is visible */
  $showReply = false
  /** @type {string} Text content of the inline reply */
  $replyText = ''

  /**
   * Initialise the email detail view by resolving the email ID and loading it.
   *
   * The email ID is resolved from (in priority order):
   * 1. `props.emailId` / `props.emailid`
   * 2. URL path `/email/<id>`
   * 3. `?email=` or `?id=` query parameters
   * 4. `props.email` (pre-loaded object)
   *
   * @async
   * @returns {Promise<void>}
   */
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

  /**
   * Fetch the full email object from the API and mark it as read.
   *
   * If the email was previously unread, this fires a `caduceus:refresh-inbox`
   * event so the inbox list can update its unread count.
   *
   * @async
   * @returns {Promise<void>}
   */
  async loadEmail() {
    if (!this.$email?.id) return
    this.$loading = true; this.$loadError = ''
    const apiFetch = window._caduceus?.apiFetch; if (!apiFetch) { this.$loading = false; return }
    try {
      const res = await apiFetch(`/inbox/${this.$email.id}`)
      if (res?.ok) this.$email = await res.json()
      else this.$loadError = 'Could not load this email.'
      if (this.$email && !this.$email.read) {
        this.$email = { ...this.$email, read: true }
        await apiFetch(`/inbox/${this.$email.id}`, { method: 'PUT', body: JSON.stringify({ read: true }) })
        window.dispatchEvent(new Event('caduceus:refresh-inbox'))
      }
    } catch (err) {
      this.$loadError = err instanceof Error ? err.message : String(err) || 'Network error'
    } finally {
      this.$loading = false
    }
  }

  /**
   * Snooze the current email until a future time.
   *
   * Presents the user with preset durations (later today, tomorrow, weekend,
   * next week) or a custom date/time. On success, refreshes the inbox and
   * navigates back.
   *
   * @async
   * @returns {Promise<void>}
   */
  async snooze() {
    if (!this.$email) return
    const presets = [
      { label: 'Later today', hours: 4 },
      { label: 'Tomorrow', hours: 24 },
      { label: 'This weekend', hours: 48 },
      { label: 'Next week', hours: 168 },
      { label: 'Custom…', hours: null },
    ]
    const options = presets.map((p, i) => `\${i + 1}. \${p.label}`).join('\n')
    const choice = prompt('Snooze until:\n\n' + options)
    if (!choice) return
    const selected = presets.find((p, i) => choice.trim() === String(i + 1) || choice.trim().toLowerCase() === p.label.toLowerCase())
    let untilMs = Date.now()
    if (selected && selected.hours != null) {
      untilMs += selected.hours * 60 * 60 * 1000
    } else {
      const custom = prompt('Enter date/time (e.g. 2026-12-31T14:00):')
      if (!custom) return
      untilMs = Date.parse(custom)
      if (isNaN(untilMs)) { window._caduceus?.toast('Invalid date format.'); return }
    }
    if (untilMs <= Date.now()) { window._caduceus?.toast('Please choose a future time.'); return }
    const apiFetch = window._caduceus?.apiFetch; if (!apiFetch) return
    try {
      const res = await apiFetch('/snooze', { method: 'POST', body: JSON.stringify({ emailId: this.$email.id, until: new Date(untilMs).toISOString() }) })
      if (res?.ok) {
        window._caduceus?.toast('Snoozed until ' + new Date(untilMs).toLocaleString())
        window.dispatchEvent(new Event('caduceus:refresh-inbox'))
        window._caduceus?.navigate('inbox')
      } else {
        window._caduceus?.toast('Snooze failed.')
      }
    } catch {
      window._caduceus?.toast('Network error.')
    }
  }

  /**
   * Permanently delete the current email.
   *
   * Prompts for confirmation before deleting. On success, refreshes the inbox
   * and navigates back.
   *
   * @async
   * @returns {Promise<void>}
   */
  async deleteEmail() {
    if (!this.$email || !confirm('Delete this message forever?')) return
    const apiFetch = window._caduceus?.apiFetch; if (!apiFetch) return
    const res = await apiFetch(`/inbox/${this.$email.id}`, { method: 'DELETE' })
    if (res?.ok) { window._caduceus?.toast('Message deleted.'); window.dispatchEvent(new Event('caduceus:refresh-inbox')); window._caduceus?.navigate('inbox'); this.$email = null }
    else { window._caduceus?.toast('Delete failed.') }
  }

  /**
   * Apply a partial update to the current email via the API.
   *
   * On success, the local `$email` is replaced with the server response, the
   * inbox is refreshed, and an optional toast message is shown.
   *
   * @async
   * @param {Record<string, any>} patch - Key/value pairs to update on the email
   * @param {string} [message] - Optional toast message shown on success
   * @returns {Promise<void>}
   */
  async updateEmail(patch, message) {
    if (!this.$email) return
    const apiFetch = window._caduceus?.apiFetch; if (!apiFetch) return
    const res = await apiFetch(`/inbox/${this.$email.id}`, { method: 'PUT', body: JSON.stringify(patch) })
    if (res?.ok) { this.$email = await res.json(); window.dispatchEvent(new Event('caduceus:refresh-inbox')); if (message) window._caduceus?.toast(message) }
    else { window._caduceus?.toast('Update failed.') }
  }

  /**
   * Bind global keyboard-shortcut listeners for email actions.
   *
   * Registered shortcuts:
   * - `email:reply`, `email:reply-all`, `email:forward`
   * - `email:star`, `email:archive`, `email:trash`
   * - `email:mark-read`, `email:mark-unread`, `email:open`
   *
   * @returns {void}
   */
  @onMount
  bindShortcuts() {
    const on = (name, fn) => window.addEventListener('caduceus:shortcut:' + name, fn)

    on('email:reply', () => this.reply())
    on('email:reply-all', () => this.replyAll())
    on('email:forward', () => this.forward())
    on('email:star', () => { if (this.$email) this.updateEmail({ starred: !this.$email.starred }, this.$email.starred ? 'Star removed.' : 'Starred.') })
    on('email:archive', () => { if (this.$email) this.updateEmail({ folder: 'archive' }, 'Archived.') })
    on('email:trash', () => { if (this.$email) this.updateEmail({ folder: 'trash' }, 'Moved to trash.') })
    on('email:mark-read', () => { if (this.$email) this.updateEmail({ read: true }, 'Marked read.') })
    on('email:mark-unread', () => { if (this.$email) this.updateEmail({ read: false }, 'Marked unread.') })
    on('email:open', () => { if (this.$email) window._caduceus?.openEmailId(this.$email.id) })
  }

  /**
   * Navigate back from the email detail view.
   *
   * Emits a `back` event to the parent when `props.onBack` is provided (3-panel
   * layout); otherwise navigates to the inbox route.
   *
   * @returns {void}
   */
  goBack() {
    // @ts-ignore
    if (this.props?.onBack) return this.emit('back')
    window._caduceus?.navigate('inbox')
  }

  /**
   * Open the compose view pre-filled as a reply to the sender.
   *
   * @returns {void}
   */
  reply() {
    if (!this.$email) return
    window._caduceus?.compose({ to: this.$email.sender, subject: `Re: ${this.$email.subject}` })
  }

  /**
   * Open the compose view pre-filled as a reply-all.
   *
   * @returns {void}
   */
  replyAll() {
    if (!this.$email) return
    const to = [this.$email.sender, this.$email.recipient].filter(Boolean).join(', ')
    window._caduceus?.compose({ to, subject: `Re: ${this.$email.subject}` })
  }

  /**
   * Open the compose view pre-filled as a forward of the current email.
   *
   * Includes the original sender, date, subject, and body as a quoted block.
   *
   * @returns {void}
   */
  forward() {
    if (!this.$email) return
    window._caduceus?.compose({ subject: `Fwd: ${this.$email.subject}`, body: `\n\n---------- Forwarded message ----------\nFrom: ${this.$email.sender}\nDate: ${new Date(this.$email.receivedAt).toLocaleString()}\nSubject: ${this.$email.subject}\n\n${this.$email.body || ''}` })
  }

  /**
   * Send a plain-text inline reply to the current email.
   *
   * Uses the `$replyText` field as the message body. This is the quick-reply
   * form rendered directly inside the email detail view (not the full composer).
   *
   * @async
   * @returns {Promise<void>}
   */
  async sendReply() {
    if (!this.$email || !this.$replyText) return
    const apiFetch = window._caduceus?.apiFetch; if (!apiFetch) return
    try {
      const res = await apiFetch('/send', { method: 'POST', body: JSON.stringify({ to: [this.$email.sender], subject: `Re: ${this.$email.subject}`, text: this.$replyText }) })
      if (res?.ok) { window._caduceus?.toast('Reply sent.'); this.$showReply = false; this.$replyText = '' }
      else { window._caduceus?.toast('Send failed.') }
    } catch { window._caduceus?.toast('Network error.') }
  }

  /**
   * Download an email attachment to the user's device.
   *
   * Fetches the attachment content (base64-encoded), decodes it, creates a
   * Blob, and triggers a download via a temporary anchor element.
   *
   * @async
   * @param {{ id: string, filename?: string }} attachment - The attachment metadata object
   * @returns {Promise<void>}
   */
  async downloadAttachment(attachment) {
    const apiFetch = window._caduceus?.apiFetch; if (!apiFetch || !this.$email?.id) return
    const res = await apiFetch(`/inbox/${this.$email.id}/attachments/${attachment.id}`)
    if (!res?.ok) { window._caduceus?.toast('Attachment download failed.'); return }
    const data = await res.json()
    const bytes = Uint8Array.from(atob(data.contentBase64), char => char.charCodeAt(0))
    const blob = new Blob([bytes], { type: data.contentType || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = data.filename || attachment.filename || 'attachment'
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
  }
}
