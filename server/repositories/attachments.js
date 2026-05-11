import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Collections, collect } from './index.js'

/**
 * @typedef {{ filename?: string, contentType?: string, content: Uint8Array, disposition?: string, contentId?: string }} ParsedAttachment
 * @typedef {import('@/types').EmailAttachmentRecord} EmailAttachmentRecord
 * @typedef {import('@/types').EmailAttachmentSummary} EmailAttachmentSummary
 */

/** @returns {string} */
export function attachmentRoot() {
  if (process.env.ATTACHMENT_ROOT) return process.env.ATTACHMENT_ROOT
  if (process.env.NODE_ENV === 'production') throw new Error('ATTACHMENT_ROOT is required in production')
  if (!process.env.FYLO_ROOT) {
    console.error('[attachments] FYLO_ROOT is not set - falling back to /mnt/hermes. Set FYLO_ROOT to avoid data loss.')
    return '/mnt/hermes/attachments'
  }
  return join(process.env.FYLO_ROOT, 'attachments')
}

/** @param {EmailAttachmentRecord} attachment @returns {EmailAttachmentSummary} */
export function toAttachmentSummary(attachment) {
  const { id, filename, contentType, size, disposition, contentId } = attachment
  return { id, filename, contentType, size, disposition, contentId }
}

/** @returns {Promise<Array<EmailAttachmentRecord & { docId: string }>>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function listAttachments(fylo, emailId) {
  const docs = await collect(fylo.findDocs(Collections.ATTACHMENTS, { $ops: [{ emailId: { $eq: emailId } }] }).collect())
  return Object.entries(docs).map(([docId, attachment]) => ({ docId, ...attachment }))
}

/** @returns {Promise<EmailAttachmentSummary[]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function listAttachmentSummaries(fylo, emailId) {
  return (await listAttachments(fylo, emailId)).map(toAttachmentSummary)
}

/** @returns {Promise<Map<string, EmailAttachmentSummary[]>>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function listAttachmentSummariesByEmail(fylo, allowedDomains) {
  const docs = await collect(fylo.findDocs(Collections.ATTACHMENTS, { $ops: [] }).collect())
  const grouped = new Map()
  for (const attachment of Object.values(docs)) {
    if (!allowedDomains.includes(attachment.domain)) continue
    const summaries = grouped.get(attachment.emailId) ?? []
    summaries.push(toAttachmentSummary(attachment))
    grouped.set(attachment.emailId, summaries)
  }
  return grouped
}

/** @returns {Promise<[string | null, EmailAttachmentRecord | null]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function findAttachmentById(fylo, id) {
  const docs = await collect(fylo.findDocs(Collections.ATTACHMENTS, { $ops: [{ id: { $eq: id } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** @returns {Promise<EmailAttachmentSummary[]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function saveEmailAttachments(fylo, emailId, domain, attachments) {
  const saved = []
  if (attachments.length === 0) return saved
  const root = attachmentRoot()
  await mkdir(root, { recursive: true })
  for (const attachment of attachments) {
    const id = randomBytes(16).toString('hex')
    const filename = safeFilename(attachment.filename || `attachment-${id}`)
    const storagePath = resolve(root, emailId, `${id}-${filename}`)
    ensureInsideRoot(root, storagePath)
    await mkdir(dirname(storagePath), { recursive: true })
    await writeFile(storagePath, attachment.content)
    /** @type {EmailAttachmentRecord} */
    const record = { id, emailId, domain, filename, contentType: attachment.contentType || 'application/octet-stream', size: attachment.content.byteLength, disposition: attachment.disposition, contentId: attachment.contentId, storagePath, createdAt: new Date().toISOString() }
    await fylo.putData(Collections.ATTACHMENTS, record)
    saved.push(toAttachmentSummary(record))
  }
  return saved
}

/** @returns {Promise<Uint8Array>} */
export async function readAttachmentContent(attachment) {
  ensureInsideRoot(attachmentRoot(), attachment.storagePath)
  return await Bun.file(attachment.storagePath).bytes()
}

/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function deleteAttachmentsForEmail(fylo, emailId) {
  const attachments = await listAttachments(fylo, emailId)
  await Promise.all(attachments.map(async ({ docId, storagePath }) => {
    await fylo.delDoc(Collections.ATTACHMENTS, docId)
    try { ensureInsideRoot(attachmentRoot(), storagePath); await rm(storagePath, { force: true }) } catch (e) { console.error('[attachments] delete attachment file failed:', e) }
  }))
  await rm(resolve(attachmentRoot(), emailId), { recursive: true, force: true })
}

/** @param {string} name */
function safeFilename(name) { const cleaned = name.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim(); return cleaned.slice(0, 160) || 'attachment' }
/** @param {string} root @param {string} target */
function ensureInsideRoot(root, target) { const resRoot = resolve(root), resTarget = resolve(target), rel = relative(resRoot, resTarget); if (rel.startsWith('..') || rel === '..' || rel.startsWith('/')) throw new Error('Attachment path escapes storage root') }
