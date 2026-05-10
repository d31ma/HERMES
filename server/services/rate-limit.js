import { Collections, collect } from '@/repositories/index.js'
import { sha256Hex } from './security.js'

/**
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string | string[]} key
 * @param {number} maxRequests
 * @param {number} windowSeconds
 * @returns {Promise<{ allowed: boolean, limit: number, remaining: number, resetAt: number, retryAfterSeconds: number }>}
 */
/** @param {import("@d31ma/fylo").default} fylo */
async function takeRateLimit(fylo, key, maxRequests, windowSeconds) {
  const keyStr = Array.isArray(key) ? key.join(':') : String(key)
  const hash = sha256Hex(keyStr)
  const now = Math.floor(Date.now() / 1000)
  const docs = await collect(fylo.findDocs(Collections.RATE_LIMITS, { $ops: [{ key: { $eq: hash } }] }).collect())
  const entry = Object.entries(docs)[0]
  let count = 1, resetAt = now + windowSeconds
  if (entry) {
    const [docId, record] = entry
    const r = /** @type {{ key: string, count: number, resetAt: number }} */ (record)
    if (r.resetAt <= now) { count = 1; resetAt = now + windowSeconds; await fylo.patchDoc(Collections.RATE_LIMITS, { [docId]: { count: 1, resetAt } }) }
    else { count = r.count + 1; await fylo.patchDoc(Collections.RATE_LIMITS, { [docId]: { count } }); resetAt = r.resetAt }
  } else {
    await fylo.putData(Collections.RATE_LIMITS, { key: hash, count: 1, resetAt })
  }
  const remaining = Math.max(0, maxRequests - count)
  return { allowed: count <= maxRequests, limit: maxRequests, remaining, resetAt, retryAfterSeconds: resetAt - now }
}

/**
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string | string[]} key
 * @param {number} maxRequests
 * @param {number} windowMs
 * @returns {Promise<{ allowed: boolean, limit: number, remaining: number, resetAt: number, retryAfterSeconds: number }>}
 */
/** @param {import("@d31ma/fylo").default} fylo */
export async function checkRateLimit(fylo, key, maxRequests, windowMs) {
  return takeRateLimit(fylo, key, maxRequests, Math.ceil(windowMs / 1000))
}
