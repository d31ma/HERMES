import { r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb, Collections, collect } from "@/repositories/index.js";

/**
 * DELETE /signatures/_id
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
    return r404("Signature not found");

  const fylo = await createDb();
  const docs = await collect(fylo.findDocs(Collections.SIGNATURES, { $ops: [{ id: { $eq: id } }] }).collect());
  const entry = Object.entries(docs)[0];
  if (!entry)
    return r404("Signature not found");

  const [docId, sig] = entry;
  if (!claims.domains.includes(sig.domain))
    return r403("Access denied");

  await fylo.delDoc(Collections.SIGNATURES, docId);
  return { deleted: id };
}
