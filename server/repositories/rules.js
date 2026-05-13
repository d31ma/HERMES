import { Collections, collect } from './index.js'

/**
 * Fylo stores nested arrays as JSON strings.
 * @typedef {Omit<import('@/types').InboxRule, 'conditions' | 'actions'> & { conditions: string | import('@/types').RuleCondition[], actions: string | import('@/types').InboxRuleAction[] }} RawRuleDoc
 */

/** @param {RawRuleDoc} raw @returns {import('@/types').InboxRule} */
function deserialize(raw) { return { ...raw, conditions: typeof raw.conditions === 'string' ? JSON.parse(raw.conditions) : (raw.conditions ?? []), actions: typeof raw.actions === 'string' ? JSON.parse(raw.actions) : (raw.actions ?? []) } }
/** @param {Omit<import('@/types').InboxRule, 'id'> & { id?: string }} rule @returns {RawRuleDoc} */
function serialize(rule) { return /** @type {RawRuleDoc} */ ({ ...rule, conditions: JSON.stringify(rule.conditions ?? []), actions: JSON.stringify(rule.actions ?? []) }) }

/** @returns {Promise<import('@/types').InboxRule[]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function listRules(fylo, allowedDomains) {
  const docs = await collect(fylo.findDocs(Collections.INBOX_RULES, { $ops: [] }).collect())
  return Object.values(docs).filter(r => allowedDomains.includes(r.domain)).map(r => deserialize(/** @type {RawRuleDoc} */ (r)))
}

/** @returns {Promise<import('@/types').InboxRule[]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function listEnabledRulesForDomain(fylo, domain) {
  const docs = await collect(fylo.findDocs(Collections.INBOX_RULES, { $ops: [{ domain: { $eq: domain } }] }).collect())
  return Object.values(docs).filter(r => r.enabled).map(r => deserialize(/** @type {RawRuleDoc} */ (r)))
}

/** @returns {Promise<[string | null, import('@/types').InboxRule | null]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function findRuleById(fylo, ruleId) {
  const docs = await collect(fylo.findDocs(Collections.INBOX_RULES, { $ops: [{ id: { $eq: ruleId } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], deserialize(/** @type {RawRuleDoc} */ (entry[1]))] : [null, null]
}

/** @returns {Promise<string>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function putRule(fylo, rule) { return await fylo.putData(Collections.INBOX_RULES, serialize(rule)) }

/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function updateRule(fylo, docId, patch) {
  const serialized = {}
  if (patch.name !== undefined) serialized.name = patch.name
  if (patch.enabled !== undefined) serialized.enabled = patch.enabled
  if (patch.conditionMatch !== undefined) serialized.conditionMatch = patch.conditionMatch
  if (patch.conditions !== undefined) serialized.conditions = JSON.stringify(patch.conditions)
  if (patch.actions !== undefined) serialized.actions = JSON.stringify(patch.actions)
  await fylo.patchDoc(Collections.INBOX_RULES, { [docId]: serialized })
}

/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function deleteRule(fylo, docId) { await fylo.delDoc(Collections.INBOX_RULES, docId) }
