import { assertSafeWebhookUrl } from './security.js'

/**
 * @typedef {{ type: 'webhook', url: string, secret?: string } | { type: 'forward', to: string } | { type: 'store' } | { type: 'drop' }} RouteAction
 */

/** @param {RouteAction} action @returns {{ valid: true } | { valid: false, error: string }} */
export function validateRouteAction(action) {
  if (!action || typeof action !== 'object') return { valid: false, error: 'Action is required' }
  switch (action.type) {
    case 'webhook': {
      if (!action.url || typeof action.url !== 'string') return { valid: false, error: 'Webhook URL is required' }
      const result = assertSafeWebhookUrl(action.url)
      if (!result.ok) return { valid: false, error: result.error }
      return { valid: true }
    }
    case 'forward': {
      if (!action.to || typeof action.to !== 'string') return { valid: false, error: 'Forward target is required' }
      return { valid: true }
    }
    case 'store':
    case 'drop': return { valid: true }
    default: return { valid: false, error: 'Unknown action type' }
  }
}

/**
 * @param {Array<{ id: string, match: string, action: RouteAction, enabled: boolean }>} rules
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateRouteRules(rules) {
  if (!Array.isArray(rules)) return { valid: false, error: 'Routes must be an array' }
  const ids = new Set()
  for (const rule of rules) {
    if (!rule.id || typeof rule.id !== 'string') return { valid: false, error: 'Each route must have an id' }
    if (ids.has(rule.id)) return { valid: false, error: `Duplicate route id: ${rule.id}` }
    ids.add(rule.id)
    if (typeof rule.match !== 'string' || !rule.match.trim()) return { valid: false, error: `Route ${rule.id}: match is required` }
    const actionResult = validateRouteAction(rule.action)
    if (!actionResult.valid) return { valid: false, error: `Route ${rule.id}: ${actionResult.error}` }
  }
  return { valid: true }
}

/**
 * @param {Array<{ type: string, folder?: string, to?: string }>} actions
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateInboxRuleActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return { valid: false, error: 'At least one action is required' }
  for (const action of actions) {
    if (!action.type) return { valid: false, error: 'Action type is required' }
    if (action.type === 'folder' && (!action.folder || typeof action.folder !== 'string')) return { valid: false, error: 'Folder action requires a folder name' }
    if (action.type === 'forward' && (!action.to || typeof action.to !== 'string')) return { valid: false, error: 'Forward action requires a to address' }
    if (!['folder', 'forward', 'delete'].includes(action.type)) return { valid: false, error: `Unknown action type: ${action.type}` }
  }
  return { valid: true }
}
