import { r400, r401, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findScheduledByDocId, deleteScheduled } from "@/repositories/scheduled.js";

/**
 * DELETE /send/scheduled
 * Cancels a scheduled send.
 * @param {object} params
 * @param {{ id: string }} params.body - Request payload with scheduled entry id
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  const id = body?.id;
  if (!id || typeof id !== 'string')
    return r400("id is required");

  const fylo = await createDb();
  const [docId, entry] = await findScheduledByDocId(fylo, id);
  if (!docId || !entry)
    return r404("Scheduled email not found");
  if (entry.sender !== claims.email)
    return r404("Scheduled email not found");

  await deleteScheduled(fylo, docId);
  return { cancelled: true };
}
