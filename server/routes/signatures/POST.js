import { r400, r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb, Collections } from "@/repositories/index.js";

/**
 * POST /signatures
 * @param {object} params
 * @param {{ domain: string, name: string, text: string }} params.body - Request payload
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  if (!body || !body.domain || !body.name || !body.text) {
    return r400("domain, name, and text are required");
  }

  if (!claims.domains.includes(body.domain)) {
    return r400("Domain not allowed");
  }

  const fylo = await createDb();
  const id = `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await fylo.putData(Collections.SIGNATURES, {
    id,
    domain: body.domain,
    name: body.name,
    text: body.text,
    createdAt: new Date().toISOString(),
  });

  return { id, domain: body.domain, name: body.name, text: body.text };
}
