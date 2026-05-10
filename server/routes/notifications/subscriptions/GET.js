import { createDb } from "@/repositories/index.js";
import { listPushSubscriptions } from "@/repositories/push.js";
import { isAuthError, requireClaims } from "@/services/notifications.js";
/**
 * GET /notifications/subscriptions
 * @param {object} params
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ context }) {
  const claims = requireClaims(context);
  if (isAuthError(claims))
    return claims;
  const fylo = await createDb();
  const subscriptions = await listPushSubscriptions(fylo, claims.email);
  return subscriptions.map(({ docId, keys, ...subscription }) => subscription);
}
