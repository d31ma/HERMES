import { r400, r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findDomainEntry, updateDomainRoutes } from "@/repositories/domains.js";
/**
 * DELETE /domains/_domain/routes/_id
 * @param {object} params
 * @param {{ domain: string, id: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  if (claims.role !== "admin")
    return r403("Admin access required");
  const { domain, id: ruleId } = paths ?? {};
  if (!domain || !ruleId)
    return r400("domain and route id required");
  if (!claims.domains.includes(domain))
    return r403("Access denied");
  const fylo = await createDb();
  const [docId, config] = await findDomainEntry(fylo, domain);
  if (!docId || !config)
    return r404("Domain not found");
  // @ts-ignore - config is DomainConfig, but TS sees string | DomainConfig from findDomainEntry
  const updatedRoutes = config.routes.filter((r) => r.id !== ruleId);
  await updateDomainRoutes(fylo, docId, updatedRoutes);
  return { deleted: ruleId };
}
