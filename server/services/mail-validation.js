import { hasControlChars, normalizeEmailAddress } from './security.js'

/**
 * @param {unknown} to
 * @returns {{ valid: string[], errors: string[] }}
 */
export function validateRecipients(to) {
  if (!Array.isArray(to) || to.length === 0) return { valid: [], errors: ['Missing to field'] }
  if (to.length > 100) return { valid: [], errors: ['Too many recipients (max 100)'] }
  const valid = []; const errors = []
  for (const addr of to) {
    if (typeof addr !== 'string' || !addr.trim()) { errors.push('Invalid recipient'); continue }
    const normalized = normalizeEmailAddress(addr)
    if (!normalized) { errors.push(`Invalid email: ${addr}`); continue }
    if (hasControlChars(normalized)) { errors.push(`Invalid email: ${addr}`); continue }
    valid.push(normalized)
  }
  return { valid, errors }
}

/** @param {string} subject @returns {string | null} */
export function validateSubject(subject) {
  if (typeof subject !== 'string' || !subject.trim()) return 'Subject is required'
  if (hasControlChars(subject)) return 'Subject contains invalid characters'
  if (/[\r\n]/.test(subject)) return 'Subject must not contain newlines'
  return null
}

/** @param {string} subject @returns {boolean} */
export function hasHeaderInjection(subject) {
  return /^(?:bcc|cc|to|from|reply-to|sender|return-path|message-id|mime-version|content-type|content-transfer-encoding):/im.test(subject.trim())
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: { to: string[], cc?: string[], bcc?: string[], subject: string, text?: string, html?: string, replyTo?: string[] } } | { ok: false, error: string }}
 */
export function validateSendRequest(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Request body required' }
  const b = /** @type {{ subject?: string, to?: string[], cc?: string[], bcc?: string[], text?: string, html?: string }} */ (body)
  if (!b.subject || typeof b.subject !== 'string' || !b.subject.trim()) return { ok: false, error: 'Subject is required' }
  if (hasHeaderInjection(b.subject)) return { ok: false, error: 'Subject contains invalid characters' }
  const { valid, errors } = validateRecipients(b.to)
  if (errors.length) return { ok: false, error: errors[0] }
  if (valid.length > 50) return { ok: false, error: 'Too many recipients (max 50)' }
  if (!b.text && !b.html) return { ok: false, error: 'text or html required' }
  if (b.cc && !Array.isArray(b.cc)) return { ok: false, error: 'cc must be an array' }
  if (b.bcc && !Array.isArray(b.bcc)) return { ok: false, error: 'bcc must be an array' }
  return { ok: true, value: { ...b, to: valid, subject: b.subject.trim() } }
}
