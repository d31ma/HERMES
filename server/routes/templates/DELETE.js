import { r400, r401, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findTemplateByDocId, deleteTemplate } from "@/repositories/templates.js";

/**
 * DELETE /templates
 * Deletes a template by id.
 * @param {object} params
 * @param {{ id: string }} params.body - Request payload with template id
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
  const [docId, entry] = await findTemplateByDocId(fylo, id);
  if (!docId || !entry)
    return r404("Template not found");
  if (entry.owner !== claims.email)
    return r404("Template not found");

  await deleteTemplate(fylo, docId);
  return { deleted: true };
}
