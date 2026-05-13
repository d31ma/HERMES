import { r400, r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findRuleById, deleteRule } from "@/repositories/rules.js";
/**
 * DELETE /rules/_id
 * @param {object} params
 * @param {{ id: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  if (claims.role !== "admin")
    return r403("Admin access required");
  const ruleId = paths?.id;
  if (!ruleId)
    return r400("rule id required");
  const fylo = await createDb();
  const [docId, existing] = await findRuleById(fylo, ruleId);
  if (!docId || !existing)
    return r404("Rule not found");
  // @ts-ignore - existing is InboxRule from findRuleById, TS sees string | InboxRule
  if (!claims.domains.includes(existing.domain))
    return r403("Domain access denied");
  await deleteRule(fylo, docId);
  return { deleted: ruleId };
}
