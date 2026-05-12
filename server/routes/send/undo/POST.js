import { r400, r401, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findOutboxById, deleteOutboxEntry } from "@/repositories/outbox.js";
/**
 * POST /send/undo
 * @param {object} params
 * @param {{ undoId: string }} params.body - Request payload
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  const undoId = body?.undoId;
  if (!undoId || typeof undoId !== 'string')
    return r400("undoId is required");
  const fylo = await createDb();
  const [docId, entry] = await findOutboxById(fylo, undoId);
  if (!docId || !entry)
    return r404("Undo ID not found or already processed");
  await deleteOutboxEntry(fylo, docId);
  return { undone: true };
}
