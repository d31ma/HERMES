import { r400, r401, r403 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { deleteSuppressed } from "@/repositories/suppressed.js";
/**
 * DELETE /suppressed/_address
 * @param {object} params
 * @param {{ address: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  if (claims.role !== "admin")
    return r403("Admin access required");
  const address = paths?.address;
  if (!address)
    return r400("address required");
  const fylo = await createDb();
  await deleteSuppressed(fylo, address);
  return { removed: address };
}
