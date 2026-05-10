import { r400 } from "@/services/respond.js";
import { createDb } from "@/repositories/index.js";
import { upsertPushSubscription } from "@/repositories/push.js";
import { isAuthError, requireClaims } from "@/services/notifications.js";
/**
 * POST /notifications/subscriptions
 * @param {object} params
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} params.body - Request payload
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context, headers }) {
  const claims = requireClaims(context);
  if (isAuthError(claims))
    return claims;
  const subscription = body;
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys.auth) {
    return r400("endpoint, p256dh, and auth are required");
  }
  const fylo = await createDb();
  const record = await upsertPushSubscription(fylo, {
    userEmail: claims.email,
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    },
    userAgent: headers?.["user-agent"] ?? headers?.["User-Agent"]
  });
  const { keys, ...safeRecord } = record;
  return safeRecord;
}
