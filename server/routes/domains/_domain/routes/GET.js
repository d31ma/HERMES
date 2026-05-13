import { r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findDomainEntry } from "@/repositories/domains.js";
/**
 * GET /domains/_domain/routes
 * @param {object} params
 * @param {{ domain: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  const domain = paths?.domain;
  if (!domain)
    return r404("Domain not found");
  if (!claims.domains.includes(domain))
    return r403("Access denied");
  const fylo = await createDb();
  const [, config] = await findDomainEntry(fylo, domain);
  if (!config)
    return r404("Domain not found");
  // @ts-ignore - config is DomainConfig, TS sees string | DomainConfig
  return config.routes;
}
