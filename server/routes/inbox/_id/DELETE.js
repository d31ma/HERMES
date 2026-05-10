import { r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findEmailById, deleteEmail } from "@/repositories/emails.js";
/**
 * DELETE /inbox/_id
 * @param {object} params
 * @param {{ id: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  const id = paths?.id;
  if (!id)
    return r404("Email not found");
  const fylo = await createDb();
  const [docId, email] = await findEmailById(fylo, id);
  if (!docId || !email)
    return r404("Email not found");
  if (!claims.domains.includes(email.domain))
    return r403("Access denied");
  await deleteEmail(fylo, docId, id);
  return { deleted: id };
}
