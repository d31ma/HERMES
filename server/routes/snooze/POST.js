import { r400, r401, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findEmailById, updateEmail } from "@/repositories/emails.js";
import { putSnooze } from "@/repositories/snooze.js";

/**
 * POST /snooze
 * Snooze an email until a future time.
 * @param {object} params
 * @param {{ emailId: string, until: string }} params.body - Request payload
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  const emailId = body?.emailId;
  const until = body?.until;
  if (!emailId || typeof emailId !== 'string')
    return r400("emailId is required");
  if (!until || typeof until !== 'string')
    return r400("until (ISO datetime) is required");

  const untilMs = Date.parse(until);
  if (isNaN(untilMs))
    return r400("until must be a valid ISO datetime");
  if (untilMs <= Date.now())
    return r400("until must be in the future");

  const fylo = await createDb();
  const [docId, email] = await findEmailById(fylo, emailId);
  if (!docId || !email)
    return r404("Email not found");
  if (!claims.domains.includes(email.domain))
    return r404("Email not found");

  // Move email to snoozed folder
  await updateEmail(fylo, docId, { folder: 'snoozed' });

  // Store snooze record
  await putSnooze(fylo, {
    id: `snooze-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    emailId,
    until: untilMs,
    snoozedAt: Date.now(),
  });

  return { snoozed: true };
}
