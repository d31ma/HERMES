import { randomBytes } from "node:crypto";
import { r400, r401, r403 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { putRule } from "@/repositories/rules.js";
import { validateInboxRuleActions } from "@/services/rule-validation.js";
/**
 * POST /rules
 * @param {object} params
 * @param {{ name: string, domain: string, enabled?: boolean, conditionMatch?: string, conditions?: object[], actions?: object[] }} params.body - Request payload
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  if (claims.role !== "admin")
    return r403("Admin access required");
  const input = body;
  if (!input?.name)
    return r400("name required");
  if (!input.domain || !claims.domains.includes(input.domain))
    return r403("Domain access denied");
  const actionError = validateInboxRuleActions(input.actions ?? []);
  if (actionError)
    // @ts-ignore - discriminated union, error only on valid:false variant
    return r400(actionError.error);
  const ruleId = randomBytes(16).toString("hex");
  const fylo = await createDb();
  await putRule(fylo, {
    id: ruleId,
    domain: input.domain,
    name: input.name,
    enabled: input.enabled ?? true,
    // @ts-ignore - "all" is a valid runtime value, TS narrows string literal union
    conditionMatch: input.conditionMatch ?? "all",
    conditions: input.conditions ?? [],
    actions: input.actions ?? []
  });
  return { id: ruleId };
}
