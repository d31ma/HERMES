import { createDb } from "@/repositories/index.js";
import { listPushSubscriptions } from "@/repositories/push.js";
import { isAuthError, requireClaims } from "@/services/notifications.js";
/**
 * GET /notifications/subscriptions
 * @param {object} params
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<unknown>}
 */
export async function handler({ context }) {
  const claims = requireClaims(context);
  if (isAuthError(claims))
    return claims;
  const fylo = await createDb();
  const subscriptions = await listPushSubscriptions(fylo, claims.email);
  // @ts-ignore - listPushSubscriptions returns PushSubscriptionRecord & { docId }, TS infers { docId }
  return subscriptions.map(({ docId, keys, ...subscription }) => /** @type {Record<string, unknown>} */ (subscription));
}
