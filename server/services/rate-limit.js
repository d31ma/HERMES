import { Collections, collect } from '@/repositories/index.js'
import { sha256Hex } from './security.js'

// ── In-memory rate limit store (Lambda-optimized) ────────────────────────────
// On Lambda with reservedConcurrentExecutions=1 there is only one execution
// environment, so an in-memory Map avoids EFS I/O latency (5-30ms per request)
// that would compete with real Fylo data operations.
const memoryStore = new Map()
let cleanupTimer = null

function ensureCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Math.floor(Date.now() / 1000)
    for (const [k, v] of memoryStore) {
      if (v.resetAt <= now) memoryStore.delete(k)
    }
  }, 60_000)
  if (cleanupTimer.unref) cleanupTimer.unref()
}

/**
 * In-memory rate limiter — no EFS I/O, no async Fylo calls.
 * Same return shape as takeRateLimit() for drop-in compatibility.
 * @param {string | string[]} key
 * @param {number} maxRequests
 * @param {number} windowSeconds
 * @returns {{ allowed: boolean, limit: number, remaining: number, resetAt: number, retryAfterSeconds: number }}
 */
function memoryRateLimit(key, maxRequests, windowSeconds) {
  ensureCleanup()
  const now = Math.floor(Date.now() / 1000)
  const keyStr = Array.isArray(key) ? key.join(':') : String(key)
  const hash = sha256Hex(keyStr)
  const entry = memoryStore.get(hash)
  let count, resetAt
  if (entry) {
    if (entry.resetAt <= now) {
      count = 1
      resetAt = now + windowSeconds
    } else {
      count = entry.count + 1
      resetAt = entry.resetAt
    }
  } else {
    count = 1
    resetAt = now + windowSeconds
  }
  memoryStore.set(hash, { count, resetAt })
  const remaining = Math.max(0, maxRequests - count)
  return { allowed: count <= maxRequests, limit: maxRequests, remaining, resetAt, retryAfterSeconds: resetAt - now }
}

// ── Fylo-backed rate limit (non-Lambda) ──────────────────────────────────────

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
  const windowSeconds = Math.ceil(windowMs / 1000)
  // In Lambda, use in-memory rate limiting to avoid EFS I/O latency (5-30ms
  // per request) that competes with real Fylo data operations. Since
  // reservedConcurrentExecutions=1, there is no cross-instance coordination
  // needed.
  if (process.env.AWS_LAMBDA_RUNTIME_API) {
    return memoryRateLimit(key, maxRequests, windowSeconds)
  }
  return takeRateLimit(fylo, key, maxRequests, windowSeconds)
}
