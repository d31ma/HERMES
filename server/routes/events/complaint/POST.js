import { r400, r401 } from "@/services/respond.js";
import { createDb } from "@/repositories/index.js";
import { suppressAddress } from "@/repositories/suppressed.js";
/**
 * POST /events/complaint
 * @param {object} params
 * @param {{ address?: string, addresses?: string[] }} params.body - Request payload
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ headers, body }) {
  const secret = process.env.EVENTS_WEBHOOK_SECRET;
  if (secret) {
    const provided = headers?.["x-webhook-secret"] ?? headers?.["X-Webhook-Secret"];
    if (provided !== secret)
      return r401("Invalid webhook secret");
  }
  const { address, addresses } = body ?? {};
  const targets = addresses ?? (address ? [address] : []);
  if (targets.length === 0)
    return r400("address or addresses required");
  const fylo = await createDb();
  for (const addr of targets) {
    await suppressAddress(fylo, addr, "complaint");
  }
  return { suppressed: targets };
}
