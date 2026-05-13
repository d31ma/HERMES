import { Collections, collect } from './index.js'

/** @returns {Promise<import('@/types').SuppressedAddress[]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function listSuppressed(fylo) {
  const docs = await collect(fylo.findDocs(Collections.SUPPRESSED, { $ops: [] }).collect())
  return Object.values(docs)
}

/** @returns {Promise<Set<string>>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function getSuppressedSet(fylo) {
  const docs = await collect(fylo.findDocs(Collections.SUPPRESSED, { $ops: [] }).collect())
  return new Set(Object.values(docs).map(r => r.address))
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} address
 * @param {string} reason
 * @returns {Promise<void>}
 */
export async function suppressAddress(fylo, address, reason) {
  const existing = await collect(fylo.findDocs(Collections.SUPPRESSED, { $ops: [{ address: { $eq: address } }] }).collect())
  if (Object.keys(existing).length > 0) return
  await fylo.putData(Collections.SUPPRESSED, { address, reason, suppressedAt: new Date().toISOString() })
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} address
 * @returns {Promise<void>}
 */
export async function deleteSuppressed(fylo, address) {
  const existing = await collect(fylo.findDocs(Collections.SUPPRESSED, { $ops: [{ address: { $eq: address } }] }).collect())
  await Promise.all(Object.keys(existing).map(docId => fylo.delDoc(Collections.SUPPRESSED, docId)))
}
