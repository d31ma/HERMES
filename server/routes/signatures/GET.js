import { r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb, Collections, collect } from "@/repositories/index.js";

/**
 * GET /signatures
 * @param {object} params
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<unknown>}
 */
export async function handler({ context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  const fylo = await createDb();
  const docs = await collect(fylo.findDocs(Collections.SIGNATURES, { $ops: [] }).collect());
  return Object.values(docs)
    .filter(s => claims.domains.includes(s.domain))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
