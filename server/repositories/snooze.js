import { Collections, collect } from './index.js'

/** @typedef {{ id: string, emailId: string, until: number, snoozedAt: number }} SnoozeEntry */

/**
 * Store a snooze record.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {SnoozeEntry} entry
 * @returns {Promise<string>}
 */
export async function putSnooze(fylo, entry) {
  return await fylo.putData(Collections.SNOOZED, entry)
}

/**
 * Return all snooze records whose `until` has elapsed.
 * @param {import('@d31ma/fylo').default} fylo
 * @returns {Promise<Record<string, SnoozeEntry>>}
 */
export async function getSnoozed(fylo) {
  return collect(fylo.findDocs(Collections.SNOOZED, { $ops: [{ until: { $lte: Date.now() } }] }).collect())
}

/**
 * Return all snooze records (both pending and elapsed).
 * @param {import('@d31ma/fylo').default} fylo
 * @returns {Promise<Record<string, SnoozeEntry>>}
 */
export async function listAllSnoozed(fylo) {
  return collect(fylo.findDocs(Collections.SNOOZED, { $ops: [] }).collect())
}

/**
 * Find a snooze record by its document ID.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} docId
 * @returns {Promise<[string | null, SnoozeEntry | null]>}
 */
export async function findSnoozeByDocId(fylo, docId) {
  const docs = await collect(fylo.findDocs(Collections.SNOOZED, { $ops: [{ id: { $eq: docId } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], /** @type {SnoozeEntry} */ (entry[1])] : [null, null]
}

/**
 * Remove a snooze record.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} emailId
 * @returns {Promise<void>}
 */
export async function removeSnooze(fylo, emailId) {
  const docs = await collect(fylo.findDocs(Collections.SNOOZED, { $ops: [{ emailId: { $eq: emailId } }] }).collect())
  for (const docId of Object.keys(docs)) {
    await fylo.delDoc(Collections.SNOOZED, docId)
  }
}
