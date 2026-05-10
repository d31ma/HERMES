import { getVapidPublicKey } from "@/services/push.js";
import { isAuthError, requireClaims } from "@/services/notifications.js";
/**
 * GET /notifications/vapid-public-key
 * @param {object} params
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ context }) {
  const claims = requireClaims(context);
  if (isAuthError(claims))
    return claims;
  return { publicKey: await getVapidPublicKey() };
}
