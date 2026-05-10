import { Collections, collect } from './index.js'
import { deleteAttachmentsForEmail, listAttachmentSummariesByEmail } from './attachments.js'

/** @typedef {{ query?: string, folder?: string, read?: boolean, starred?: boolean, hasAttachment?: boolean, limit?: number, offset?: number }} EmailListFilters */

/**
 * Returns all emails whose domain appears in the allowed list, sorted newest-first by `receivedAt`.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string[]} allowedDomains
 * @param {EmailListFilters} [filters]
 * @returns {Promise<import('@/types').StoredEmail[]>}
 */
export async function listEmails(fylo, allowedDomains, filters = {}) {
  const docs = await collect(fylo.findDocs(Collections.EMAILS, { $ops: [] }).collect())
  const needsAttachmentData = !!filters.query || filters.hasAttachment != null
  const attachmentsByEmail = needsAttachmentData ? await listAttachmentSummariesByEmail(fylo, allowedDomains) : new Map()
  const offset = Math.max(0, filters.offset ?? 0)
  const limit = filters.limit == null ? undefined : Math.max(0, filters.limit)
  const emails = Object.values(docs).map(normalizeEmail)
    .filter(e => allowedDomains.includes(e.domain))
    .filter(e => !filters.folder || filters.folder === 'all' || (e.folder || 'inbox') === filters.folder)
    .filter(e => filters.read == null || e.read === filters.read)
    .filter(e => filters.starred == null || e.starred === filters.starred)
    .filter(e => filters.hasAttachment == null || (attachmentsByEmail.get(e.id)?.length ?? 0) > 0 === filters.hasAttachment)
    .filter(e => matchesEmailQuery(e, filters.query, attachmentsByEmail.get(e.id) ?? []))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  return limit == null ? emails.slice(offset) : emails.slice(offset, offset + limit)
}

/** @returns {Promise<[string | null, import('@/types').StoredEmail | null]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function findEmailById(fylo, id) {
  const docs = await collect(fylo.findDocs(Collections.EMAILS, { $ops: [{ id: { $eq: id } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], normalizeEmail(entry[1])] : [null, null]
}

/** @returns {Promise<string>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function putEmail(fylo, email) {
  return await fylo.putData(Collections.EMAILS, email)
}

/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function updateEmail(fylo, docId, patch) {
  await fylo.patchDoc(Collections.EMAILS, { [docId]: patch })
}

/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function deleteEmail(fylo, docId, emailId) {
  if (emailId) await deleteAttachmentsForEmail(fylo, emailId)
  await fylo.delDoc(Collections.EMAILS, docId)
}

/** @param {import('@/types').StoredEmail} email @returns {import('@/types').StoredEmail} */
export function normalizeEmail(email) {
  return { ...email, folder: email.folder || 'inbox', read: email.read ?? false, starred: email.starred ?? false }
}

/** @param {import('@/types').StoredEmail} email @param {string} query @param {import('@/types').EmailAttachmentSummary[]} attachments */
function matchesEmailQuery(email, query = '', attachments = []) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  return terms.every(term => matchesEmailTerm(email, term, attachments))
}

/** @param {import('@/types').StoredEmail} email @param {string} term @param {import('@/types').EmailAttachmentSummary[]} attachments */
function matchesEmailTerm(email, term, attachments) {
  if (term === 'has:attachment') return attachments.length > 0
  if (term === 'is:read') return email.read
  if (term === 'is:unread') return !email.read
  if (term === 'is:starred') return email.starred
  const [rawField, ...rest] = term.split(':')
  const value = rest.join(':')
  if (value) {
    switch (rawField) {
      case 'from': return includes(email.sender, value)
      case 'to': return includes(email.recipient, value)
      case 'subject': return includes(email.subject, value)
      case 'body': return includes(email.body, value)
      case 'filename':
      case 'attachment': return attachments.some(a => includes(a.filename, value))
    }
  }
  return [email.sender, email.recipient, email.subject, email.body, ...attachments.map(a => a.filename)].some(field => includes(field, term))
}

/** @param {string | undefined} value @param {string} term */
function includes(value, term) { return (value ?? '').toLowerCase().includes(term) }
