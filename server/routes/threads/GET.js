import { r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findThreads } from "@/repositories/threads.js";

/**
 * GET /threads
 * @param {object} params
 * @param {{ folder?: string }} params.query - Query string parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<unknown>}
 */
export async function handler({ context, query }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  const fylo = await createDb();
  const folder = query?.folder || 'inbox';
  return await findThreads(fylo, claims.domains, folder);
}
