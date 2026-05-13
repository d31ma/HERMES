import { randomUUID } from 'node:crypto'
import { Collections, collect } from './index.js'
import { normalizeEmailAddress, normalizeDomain } from '@/services/security.js'

/** @returns {Promise<Array<import('@/types').User & { docId: string }>>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function listUsers(fylo) {
  const docs = await collect(fylo.findDocs(Collections.USERS, { $ops: [] }).collect())
  return Object.entries(docs).map(([docId, u]) => ({ docId, ...normalizeUser(/** @type {import('@/types').User} */ (u)) }))
}

/**
 * Finds a user by email address (case-insensitive). Returns `[docId, user]`.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} email
 * @returns {Promise<[string | null, import('@/types').User | null]>}
 */
export async function findUserByEmail(fylo, email) {
  const normalizedEmail = normalizeEmailAddress(email)
  if (!normalizedEmail) return [null, null]
  const docs = await collect(fylo.findDocs(Collections.USERS, { $ops: [{ email: { $eq: normalizedEmail } }] }).collect())
  const entry = Object.entries(docs)[0]
  if (entry) return [entry[0], normalizeUser(/** @type {import('@/types').User} */ (entry[1]))]
  const users = await listUsers(fylo)
  const aliased = users.find(user => user.aliases?.includes(normalizedEmail))
  return aliased ? [aliased.docId, stripDocId(aliased)] : [null, null]
}

/**
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} email
 * @param {string} phone
 * @returns {Promise<[string | null, import('@/types').User | null]>}
 */
export async function findUserByEmailAndPhone(fylo, email, phone) {
  const [docId, user] = await findUserByEmail(fylo, email)
  if (!docId || !user || !user.phones.includes(phone)) return [null, null]
  return [docId, user]
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {import('@/types').User} user
 * @returns {Promise<string>}
 */
export async function putUser(fylo, user) {
  return await fylo.putData(Collections.USERS, normalizeUser(user))
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deleteUser(fylo, docId) {
  await fylo.delDoc(Collections.USERS, docId)
}

/** @param {import('@/types').User} user @returns {import('@/types').User} */
export function normalizeUser(user) {
  const email = normalizeEmailAddress(user.email) ?? user.email.trim().toLowerCase()
  const aliases = dedupe((user.aliases ?? []).map(alias => /** @type {string} */ (normalizeEmailAddress(alias))).filter(Boolean).filter(alias => alias !== email))
  const domains = dedupe(user.domains.map(domain => /** @type {string} */ (normalizeDomain(domain))).filter(Boolean))
  return { ...user, id: user.id || randomUUID(), email, aliases, domains }
}

/** @param {import('@/types').User & { docId: string }} user */
function stripDocId(user) { const { docId, ...rest } = user; void docId; return rest }
/** @param {string[]} values @returns {string[]} */
function dedupe(values) { return [...new Set(values)] }
