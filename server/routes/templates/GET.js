import { r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { listTemplates } from "@/repositories/templates.js";

/**
 * GET /templates
 * Returns all templates for the authenticated user.
 * @param {object} params
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<unknown>}
 */
export async function handler({ context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  const fylo = await createDb();
  const records = await listTemplates(fylo, claims.email);
  const results = [];

  for (const entry of Object.values(records)) {
    results.push({
      id: entry.id,
      name: entry.name,
      subject: entry.subject,
      text: entry.text,
      to: entry.to,
      cc: entry.cc,
      createdAt: new Date(entry.createdAt).toISOString(),
    });
  }

  return results;
}
