import { createHash } from 'node:crypto'
import { Collections, collect } from './index.js'

/** @param {string} endpoint @returns {string} */
export function pushSubscriptionId(endpoint) { return createHash('sha256').update(endpoint).digest('hex') }

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} userEmail
 * @returns {Promise<Record<string, any>[]>}
 */
export async function listPushSubscriptions(fylo, userEmail) {
  const docs = await collect(fylo.findDocs(Collections.PUSH_SUBSCRIPTIONS, { $ops: [{ userEmail: { $eq: userEmail.toLowerCase() } }] }).collect())
  return Object.entries(docs).map(([docId, sub]) => ({ docId, ...sub }))
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} address
 * @returns {Promise<Record<string, any>[]>}
 */
export async function listPushSubscriptionsForAddress(fylo, address) { return await listPushSubscriptions(fylo, address.toLowerCase()) }

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} id
 * @returns {Promise<[string | null, Record<string, any> | null]>}
 */
export async function findPushSubscriptionById(fylo, id) {
  const docs = await collect(fylo.findDocs(Collections.PUSH_SUBSCRIPTIONS, { $ops: [{ id: { $eq: id } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {import('@/types').PushSubscriptionRecord} subscription
 * @returns {Promise<import('@/types').PushSubscriptionRecord>}
 */
export async function upsertPushSubscription(fylo, subscription) {
  const now = new Date().toISOString()
  const id = pushSubscriptionId(subscription.endpoint)
  const [docId, existing] = await findPushSubscriptionById(fylo, id)
  const record = { ...subscription, userEmail: subscription.userEmail.toLowerCase(), id, createdAt: /** @type {any} */ (existing)?.createdAt ?? now, updatedAt: now }
  if (docId) { await fylo.patchDoc(Collections.PUSH_SUBSCRIPTIONS, { [/** @type {string} */ (docId)]: record }) } else { await fylo.putData(Collections.PUSH_SUBSCRIPTIONS, record) }
  return record
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} endpoint
 * @returns {Promise<boolean>}
 */
export async function deletePushSubscriptionByEndpoint(fylo, endpoint) {
  const [docId] = await findPushSubscriptionById(fylo, pushSubscriptionId(endpoint))
  if (!docId) return false
  await fylo.delDoc(Collections.PUSH_SUBSCRIPTIONS, /** @type {string} */ (docId))
  return true
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deletePushSubscriptionDoc(fylo, docId) { await fylo.delDoc(Collections.PUSH_SUBSCRIPTIONS, docId) }
