import { Collections, collect } from './index.js'

// ── MFA Devices ───────────────────────────────────────────────────────────────

/** @returns {Promise<Array<import('@/types').MfaDevice & { docId: string }>>} */
export async function listDevices(fylo, userEmail) {
  const docs = await collect(fylo.findDocs(Collections.MFA_DEVICES, { $ops: [{ userEmail: { $eq: userEmail } }] }).collect())
  return /** @type {Array<import('@/types').MfaDevice & { docId: string }>} */ (Object.entries(docs).map(([docId, d]) => ({ docId, ...d })))
}

/** @returns {Promise<[string | null, import('@/types').MfaDevice | null]>} */
export async function findDeviceById(fylo, id) {
  const docs = await collect(fylo.findDocs(Collections.MFA_DEVICES, { $ops: [{ id: { $eq: id } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], /** @type {import('@/types').MfaDevice} */ (entry[1])] : [null, null]
}

/**
 * Find a WebAuthn device by its credential ID.
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} credentialId
 * @returns {Promise<[string | null, (import('@/types').MfaDevice & { docId: string, publicKey?: string, signCount?: number }) | null]>}
 */
export async function findDeviceByCredentialId(fylo, credentialId) {
  const docs = await collect(fylo.findDocs(Collections.MFA_DEVICES, { $ops: [{ credentialId: { $eq: credentialId } }] }).collect())
  const entry = Object.entries(docs)[0]
  if (!entry) return [null, null]
  return [entry[0], /** @type {any} */ (entry[1])]
}

/** @returns {Promise<string>} */
export async function putDevice(fylo, device) { return await fylo.putData(Collections.MFA_DEVICES, device) }

/**
 * Store a WebAuthn passkey credential.
 * @param {import("@d31ma/fylo").default} fylo
 * @param {{ id: string, userEmail: string, name: string, credentialId: string, publicKey: string, signCount: number }} device
 * @returns {Promise<string>}
 */
export async function putWebAuthnDevice(fylo, device) {
  return await fylo.putData(Collections.MFA_DEVICES, {
    ...device,
    type: 'webauthn',
    createdAt: new Date().toISOString(),
  })
}

/**
 * Update the signature counter for a WebAuthn device.
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} docId
 * @param {number} signCount
 * @returns {Promise<void>}
 */
export async function updateDeviceSignCount(fylo, docId, signCount) {
  await fylo.patchDoc(Collections.MFA_DEVICES, { [docId]: { signCount } })
}

/** @returns {Promise<void>} */
export async function deleteDevice(fylo, docId) { await fylo.delDoc(Collections.MFA_DEVICES, docId) }

// ── MFA Sessions ──────────────────────────────────────────────────────────────

/** @returns {Promise<[string | null, import('@/types').MfaSession | null]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function findMfaSession(fylo, id) {
  const docs = await collect(fylo.findDocs(Collections.MFA_SESSIONS, { $ops: [{ id: { $eq: id } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** @returns {Promise<string>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function putMfaSession(fylo, session) { return await fylo.putData(Collections.MFA_SESSIONS, session) }
/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function deleteMfaSession(fylo, docId) { await fylo.delDoc(Collections.MFA_SESSIONS, docId) }

/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function purgeExpiredMfaSessions(fylo, email) {
  const docs = await collect(fylo.findDocs(Collections.MFA_SESSIONS, { $ops: [{ email: { $eq: email } }] }).collect())
  const now = new Date()
  await Promise.all(Object.entries(docs).filter(([, s]) => new Date(s.expiresAt) < now).map(([docId]) => fylo.delDoc(Collections.MFA_SESSIONS, docId)))
}

// ── Setup Sessions ────────────────────────────────────────────────────────────

/** @returns {Promise<[string | null, import('@/types').SetupSession | null]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function findSetupSession(fylo, id) {
  const docs = await collect(fylo.findDocs(Collections.SETUP_SESSIONS, { $ops: [{ id: { $eq: id } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** @returns {Promise<string>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function putSetupSession(fylo, session) { return await fylo.putData(Collections.SETUP_SESSIONS, session) }
/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function deleteSetupSession(fylo, docId) { await fylo.delDoc(Collections.SETUP_SESSIONS, docId) }
