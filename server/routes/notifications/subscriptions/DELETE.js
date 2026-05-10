import { r400, r404 } from "@/services/respond.js";
import { createDb } from "@/repositories/index.js";
import { deletePushSubscriptionDoc, findPushSubscriptionById, pushSubscriptionId } from "@/repositories/push.js";
import { isAuthError, requireClaims } from "@/services/notifications.js";
/**
 * DELETE /notifications/subscriptions
 * @param {object} params
 * @param {{ endpoint: string }} params.body - Request payload
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = requireClaims(context);
  if (isAuthError(claims))
    return claims;
  const request = body;
  if (!request?.endpoint)
    return r400("endpoint required");
  const fylo = await createDb();
  const [docId, subscription] = await findPushSubscriptionById(fylo, pushSubscriptionId(request.endpoint));
  if (!docId || !subscription || subscription.userEmail !== claims.email.toLowerCase()) {
    return r404("Subscription not found");
  }
  await deletePushSubscriptionDoc(fylo, docId);
  return { deleted: subscription.id };
}
