import { Collections, collect } from './index.js'

/**
 * Records that a tracked email was opened.
 *
 * Searches the EMAILS collection for a document with the given trackingId,
 * then patches it with `openedAt` set to the current ISO timestamp.
 *
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} trackingId
 * @returns {Promise<void>}
 */
export async function recordOpen(fylo, trackingId) {
  if (!trackingId) return

  const docs = await collect(
    fylo.findDocs(Collections.EMAILS, {
      $ops: [{ trackingId: { $eq: trackingId } }],
    }).collect()
  )

  const entry = Object.entries(docs)[0]
  if (!entry) {
    // No matching email found — the tracking ID might be for a different
    // domain or the email hasn't been stored yet. Log and move on.
    console.warn("[tracking] recordOpen: no email found for trackingId:", trackingId)
    return
  }

  const [docId, email] = entry
  if (email.openedAt) return // already recorded

  await fylo.patchDoc(Collections.EMAILS, {
    [docId]: { openedAt: new Date().toISOString() },
  })
}

/**
 * Records that a tracked link was clicked.
 *
 * Searches the EMAILS collection for a document with the given trackingId,
 * then appends a click record to the `clicks` array field.
 *
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} trackingId
 * @param {string} url - The original URL that was clicked
 * @returns {Promise<void>}
 */
export async function recordClick(fylo, trackingId, url) {
  if (!trackingId || !url) return

  const docs = await collect(
    fylo.findDocs(Collections.EMAILS, {
      $ops: [{ trackingId: { $eq: trackingId } }],
    }).collect()
  )

  const entry = Object.entries(docs)[0]
  if (!entry) {
    console.warn("[tracking] recordClick: no email found for trackingId:", trackingId)
    return
  }

  const [docId, email] = entry
  const clicks = Array.isArray(email.clicks) ? [...email.clicks] : []
  clicks.push({ url, clickedAt: new Date().toISOString() })

  await fylo.patchDoc(Collections.EMAILS, {
    [docId]: { clicks },
  })
}
