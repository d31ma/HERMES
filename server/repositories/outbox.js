import { Collections, collect } from './index.js'

/** @typedef {{ id: string, email: import('@/services/smtp').SendRequest, sender: string, expiresAt: number }} OutboxEntry */

/**
 * Insert a pending send into the outbox.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {OutboxEntry} entry
 * @returns {Promise<string>}
 */
export async function putOutboxEntry(fylo, entry) {
  return await fylo.putData(Collections.OUTBOX, entry)
}

/**
 * Find an outbox entry by its undo ID.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} undoId
 * @returns {Promise<[string | null, OutboxEntry | null]>}
 */
export async function findOutboxById(fylo, undoId) {
  const docs = await collect(fylo.findDocs(Collections.OUTBOX, { $ops: [{ id: { $eq: undoId } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], /** @type {OutboxEntry} */ (entry[1])] : [null, null]
}

/**
 * Remove an outbox entry by its document ID.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deleteOutboxEntry(fylo, docId) {
  await fylo.delDoc(Collections.OUTBOX, docId)
}

/**
 * Find all expired outbox entries (expiresAt <= now).
 * Returns an async generator keyed by document ID.
 * @param {import('@d31ma/fylo').default} fylo
 * @returns {Promise<Record<string, OutboxEntry>>}
 */
export async function findExpiredOutbox(fylo) {
  return collect(fylo.findDocs(Collections.OUTBOX, { $ops: [{ expiresAt: { $lte: Date.now() } }] }).collect())
}
