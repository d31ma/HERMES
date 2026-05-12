import { r400, r401, r422, r429 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { getSmtpAdapter } from "@/services/smtp.js";
import { createDb } from "@/repositories/index.js";
import { getSuppressedSet } from "@/repositories/suppressed.js";
import { validateSendRequest } from "@/services/mail-validation.js";
import { checkRateLimit } from "@/services/rate-limit.js";
import { putOutboxEntry, deleteOutboxEntry } from "@/repositories/outbox.js";
/**
 * POST /send
 * @param {object} params
 * @param {{ to: string[], subject: string, cc?: string[], bcc?: string[], text?: string, html?: string, delayMs?: number }} params.body - Request payload
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  const fylo = await createDb();
  const limit = await checkRateLimit(fylo, ["send", claims.email, context.ipAddress], 60, 60 * 60 * 1000);
  if (!limit.allowed)
    return r429("Too many send attempts", limit.retryAfterSeconds);
  const parsed = validateSendRequest(body);
  if (!parsed.ok)
    return r400(parsed.error);
  const req = parsed.value;
  const suppressed = await getSuppressedSet(fylo);
  const blocked = [...req.to, ...req.cc ?? [], ...req.bcc ?? []].filter((addr) => suppressed.has(addr));
  if (blocked.length > 0)
    return r422("Recipients are suppressed", blocked);

  const delayMs = typeof body.delayMs === 'number' && body.delayMs > 0 ? body.delayMs : 0;

  if (delayMs > 0) {
    const undoId = `undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = Date.now() + delayMs;
    const docId = await putOutboxEntry(fylo, {
      id: undoId,
      email: req,
      sender: claims.email,
      expiresAt,
    });

    // Schedule the actual send after the delay
    const senderEmail = claims.email;
    setTimeout(async () => {
      try {
        const fylo2 = await createDb();
        const smtp = getSmtpAdapter();
        await smtp.sendEmail(senderEmail, req);
        await deleteOutboxEntry(fylo2, docId);
      } catch (e) {
        console.error('[send] Delayed send failed:', e);
      }
    }, delayMs);

    return { sent: true, undoId };
  }

  const smtp = getSmtpAdapter();
  const result = await smtp.sendEmail(claims.email, req);
  return { messageId: result.messageId };
}
