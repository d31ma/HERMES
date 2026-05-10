import { Collections, collect } from './index.js'

/** @returns {Promise<[string | null, import('@/types').OtpSession | null]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function findOtpSession(fylo, id) {
  const docs = await collect(fylo.findDocs(Collections.OTP_SESSIONS, { $ops: [{ id: { $eq: id } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** @returns {Promise<string>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function putOtpSession(fylo, session) { return await fylo.putData(Collections.OTP_SESSIONS, session) }
/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function deleteOtpSession(fylo, docId) { await fylo.delDoc(Collections.OTP_SESSIONS, docId) }

/** @returns {Promise<import('@/types').OtpSession | null>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function findValidOtpSession(fylo, email, phone) {
  const docs = await collect(fylo.findDocs(Collections.OTP_SESSIONS, { $ops: [{ email: { $eq: email } }] }).collect())
  const now = new Date()
  const valid = Object.values(docs).find(s => s.phone === phone && new Date(s.expiresAt) >= now)
  return valid ?? null
}

/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function purgeExpiredOtpSessions(fylo, email) {
  const docs = await collect(fylo.findDocs(Collections.OTP_SESSIONS, { $ops: [{ email: { $eq: email } }] }).collect())
  const now = new Date()
  await Promise.all(Object.entries(docs).filter(([, s]) => new Date(s.expiresAt) < now).map(([docId]) => fylo.delDoc(Collections.OTP_SESSIONS, docId)))
}
