import { r400, r401, r403 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { putUser } from "@/repositories/users.js";
import { hasControlChars, hasDomainClaim, normalizeDomain, normalizeEmailAddress } from "@/services/security.js";
/**
 * POST /users
 * @param {object} params
 * @param {{ email: string, phones: string[], domains: string[], role: string, aliases?: string[] }} params.body - Request payload
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  if (claims.role !== "admin")
    return r403("Admin access required");
  const user = body;
  if (!user?.email)
    return r400("email required");
  if (!user.phones?.length)
    return r400("phones required");
  if (!user.domains?.length)
    return r400("domains required");
  if (!user.role)
    return r400("role required");
  if (user.role !== "admin" && user.role !== "viewer")
    return r400("role invalid");
  const email = normalizeEmailAddress(user.email);
  if (!email)
    return r400("email invalid");
  const aliases = (user.aliases ?? []).map((alias) => normalizeEmailAddress(alias));
  if (aliases.some((alias) => !alias))
    return r400("aliases invalid");
  const domains = user.domains.map((domain) => normalizeDomain(domain));
  if (domains.some((domain) => !domain))
    return r400("domains invalid");
  if (!domains.every((domain) => hasDomainClaim(claims.domains, /** @type {string} */ (domain)))) {
    return r403("Domain access denied");
  }
  if (user.phones.some((phone) => !phone || hasControlChars(phone)))
    return r400("phones invalid");
  const fylo = await createDb();
  await putUser(fylo, {
    email,
    // @ts-ignore - .filter(Boolean) doesn't narrow (string|null)[] to string[] in TS
    aliases: aliases.filter((alias) => Boolean(alias)),
    phones: user.phones,
    // @ts-ignore - .map(normalizeDomain) doesn't narrow (string|null)[] to string[]
    domains,
    role: user.role
  });
  return { email };
}
