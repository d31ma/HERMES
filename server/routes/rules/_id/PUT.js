import { r400, r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findRuleById, updateRule } from "@/repositories/rules.js";
import { validateInboxRuleActions } from "@/services/rule-validation.js";
/**
 * PUT /rules/_id
 * @param {object} params
 * @param {{ name?: string, enabled?: boolean, conditionMatch?: string, conditions?: object[], actions?: object[] }} params.body - Request payload
 * @param {{ id: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  if (claims.role !== "admin")
    return r403("Admin access required");
  const ruleId = paths?.id;
  if (!ruleId || !body)
    return r400("rule id and body required");
  const fylo = await createDb();
  const [docId, existing] = await findRuleById(fylo, ruleId);
  if (!docId || !existing)
    return r404("Rule not found");
  // @ts-ignore - existing is InboxRule from findRuleById, TS sees string | InboxRule
  if (!claims.domains.includes(existing.domain))
    return r403("Domain access denied");
  const input = body;
  if (input.actions !== undefined) {
    const actionError = validateInboxRuleActions(input.actions);
    if (actionError)
      // @ts-ignore - discriminated union, error only on valid:false variant
      return r400(actionError.error);
  }
  // @ts-ignore - input is Partial<InboxRule> from body, valid runtime call
  await updateRule(fylo, docId, input);
  return { updated: ruleId };
}
