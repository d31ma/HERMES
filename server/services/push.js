import Fylo from '@d31ma/fylo'
import { upsertPushSubscription, listPushSubscriptionsForAddress } from '@/repositories/push.js'
import { findUserByEmail } from '@/repositories/users.js'

/** @returns {Promise<string>} */
export async function getVapidPublicKey() {
  if (process.env.VAPID_PUBLIC_KEY) return process.env.VAPID_PUBLIC_KEY
  try {
    const wp = await import('web-push')
    const keys = wp.default.generateVAPIDKeys?.() || wp.generateVAPIDKeys?.()
    if (keys?.publicKey) return keys.publicKey
  } catch (e) { console.error('[push] web-push import/generation failed, using fallback:', e) }
  // Fallback ephemeral key for local dev
  const { generateKeyPairSync } = await import('node:crypto')
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
}

/**
 * Send push notifications to all subscribed devices for a user.
 * @param {Fylo} fylo
 * @param {StoredEmail} email
 * @returns {Promise<void>}
 */
async function sendPushNotifications(fylo, email) {
  if (process.env.WEB_PUSH_DISABLED === 'true') return
  // Skip if no VAPID keys are configured (push is opt-in)
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return
  try {
    const webPush = await import('web-push')
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@hermes.local'

    const [, user] = await findUserByEmail(fylo, email.recipient)
    const userEmail = user?.email || email.recipient
    const subscriptions = await listPushSubscriptionsForAddress(fylo, userEmail)
    if (subscriptions.length === 0) return

    const payload = JSON.stringify({
      title: `New mail from ${email.sender}`,
      body: email.subject,
      data: { url: `/email/${email.id}` },
      tag: email.id,
    })

    await Promise.allSettled(subscriptions.map(sub =>
      webPush.default.sendNotification(sub, payload, {
        vapidDetails: { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey },
      })
    ))
  } catch (e) { console.error('[push] sendPushNotifications failed:', e) }
}

/**
 * @param {import('@d31ma/fylo').default} fylo
 * @param {object} email
 * @returns {Promise<void>}
 */
export async function sendEmailNotification(fylo, email) { return sendPushNotifications(fylo, email) }
