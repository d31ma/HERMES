import { Collections, collect } from './index.js'

/** @typedef {{ id: string, email: import('@/services/smtp').SendRequest, sender: string, sendAt: number, createdAt: number }} ScheduledEntry */

/**
 * Store a scheduled email.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {ScheduledEntry} entry
 * @returns {Promise<string>}
 */
export async function putScheduled(fylo, entry) {
  return await fylo.putData(Collections.SCHEDULED, entry)
}

/**
 * Return all scheduled entries for a user.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} sender
 * @returns {Promise<Record<string, ScheduledEntry>>}
 */
export async function listScheduled(fylo, sender) {
  return collect(fylo.findDocs(Collections.SCHEDULED, { $ops: [{ sender: { $eq: sender } }] }).collect())
}

/**
 * Find a scheduled entry by doc ID.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} docId
 * @returns {Promise<[string | null, ScheduledEntry | null]>}
 */
export async function findScheduledByDocId(fylo, docId) {
  const docs = await collect(fylo.findDocs(Collections.SCHEDULED, { $ops: [{ id: { $eq: docId } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], /** @type {ScheduledEntry} */ (entry[1])] : [null, null]
}

/**
 * Delete a scheduled entry.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deleteScheduled(fylo, docId) {
  await fylo.delDoc(Collections.SCHEDULED, docId)
}
