import { r400, r401, r403 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { putDomain } from "@/repositories/domains.js";
import { hasDomainClaim, normalizeDomain } from "@/services/security.js";
import { validateRouteRules } from "@/services/rule-validation.js";
/**
 * POST /domains
 * @param {object} params
 * @param {{ domain: string, routes?: object[], inboundEnabled?: boolean }} params.body - Request payload
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  if (claims.role !== "admin")
    return r403("Admin access required");
  const config = body;
  if (!config?.domain)
    return r400("domain required");
  const domain = normalizeDomain(config.domain);
  if (!domain)
    return r400("domain invalid");
  if (!hasDomainClaim(claims.domains, domain))
    return r403("Domain access denied");
  const routeResult = validateRouteRules(config.routes ?? []);
  if (!routeResult.valid)
    return r400(routeResult.error);
  const fylo = await createDb();
  await putDomain(fylo, {
    domain,
    routes: config.routes ?? [],
    inboundEnabled: config.inboundEnabled ?? false
  });
  return { domain };
}
