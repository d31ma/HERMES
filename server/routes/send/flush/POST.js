import { r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { getSmtpAdapter } from "@/services/smtp.js";
import { createDb } from "@/repositories/index.js";
import { findExpiredOutbox, deleteOutboxEntry } from "@/repositories/outbox.js";
/**
 * POST /send/flush
 * Processes all expired outbox entries — sends any pending messages
 * whose delay window has elapsed. Useful for recovery after restarts.
 * @param {object} params
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  const fylo = await createDb();
  const expired = await findExpiredOutbox(fylo);
  const smtp = getSmtpAdapter();
  let sent = 0;
  for (const [docId, entry] of Object.entries(expired)) {
    try {
      await smtp.sendEmail(entry.sender, entry.email);
      await deleteOutboxEntry(fylo, docId);
      sent++;
    } catch (e) {
      console.error('[send/flush] Failed to process entry:', e);
    }
  }
  return { flushed: sent };
}
