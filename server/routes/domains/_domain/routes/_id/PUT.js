import { r400, r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findDomainEntry, updateDomainRoutes } from "@/repositories/domains.js";
import { validateRouteAction } from "@/services/rule-validation.js";
/**
 * PUT /domains/_domain/routes/_id
 * @param {object} params
 * @param {{ id: string, match: string, enabled?: boolean }} params.body - Request payload
 * @param {{ domain: string, id: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, body, context }) {
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
  if (!body)
    return r400("Missing body");
  const fylo = await createDb();
  const [docId, config] = await findDomainEntry(fylo, domain);
  if (!docId || !config)
    return r404("Domain not found");
  const rule = body;
  // @ts-ignore - rule.action exists, body JSDoc doesn't include action type
  const actionResult = validateRouteAction(rule.action);
  if (!actionResult.valid)
    return r400(actionResult.error);
  // @ts-ignore - config is DomainConfig, TS sees string | DomainConfig
  const routes = config.routes
  const updatedRoutes = [
    ...routes.filter((r) => r.id !== ruleId),
    { ...rule, id: ruleId }
  ];
  await updateDomainRoutes(fylo, docId, updatedRoutes);
  return { updated: ruleId };
}
