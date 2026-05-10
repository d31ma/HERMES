import { r400, r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findUserByEmail, deleteUser } from "@/repositories/users.js";
/**
 * DELETE /users/_id
 * @param {object} params
 * @param {{ id: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  if (claims.role !== "admin")
    return r403("Admin access required");
  const email = paths?.id;
  if (!email)
    return r400("email required");
  const fylo = await createDb();
  const [docId] = await findUserByEmail(fylo, email);
  if (!docId)
    return r404("User not found");
  await deleteUser(fylo, docId);
  return { deleted: email };
}
