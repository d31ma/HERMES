import { Collections, collect } from './index.js'

/** @typedef {{ id: string, name: string, subject: string, text: string, to: string, cc: string, owner: string, createdAt: number }} TemplateEntry */

/**
 * Store a template.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {TemplateEntry} entry
 * @returns {Promise<string>}
 */
export async function putTemplate(fylo, entry) {
  return await fylo.putData(Collections.TEMPLATES, entry)
}

/**
 * List all templates for a user.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} owner
 * @returns {Promise<Record<string, TemplateEntry>>}
 */
export async function listTemplates(fylo, owner) {
  return collect(fylo.findDocs(Collections.TEMPLATES, { $ops: [{ owner: { $eq: owner } }] }).collect())
}

/**
 * Find a template by doc ID.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} docId
 * @returns {Promise<[string | null, TemplateEntry | null]>}
 */
export async function findTemplateByDocId(fylo, docId) {
  const docs = await collect(fylo.findDocs(Collections.TEMPLATES, { $ops: [{ id: { $eq: docId } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], /** @type {TemplateEntry} */ (entry[1])] : [null, null]
}

/**
 * Delete a template.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deleteTemplate(fylo, docId) {
  await fylo.delDoc(Collections.TEMPLATES, docId)
}
