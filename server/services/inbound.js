import { Collections, collect } from '@/repositories/index.js'
import { deleteEmail, findEmailById } from '@/repositories/emails.js'
import { listEnabledRulesForDomain } from '@/repositories/rules.js'
import { getSuppressedSet } from '@/repositories/suppressed.js'
import { getSmtpAdapter } from './smtp.js'
import { assertSafeWebhookUrl, hmacSha256Hex, normalizeEmailAddress } from './security.js'

/** @typedef {import('@/types').RouteRule} RouteRule */
/** @typedef {import('@/types').InboxRule} InboxRule */
/** @typedef {import('@/types').RuleCondition} RuleCondition */
/** @typedef {import('../repositories/attachments.js').ParsedAttachment} ParsedAttachment */

/**
 * @param {import('@d31ma/fylo').default} fylo
 * @param {{ recipient: string, sender: string, subject: string, body: string, messageId?: string, attachments?: ParsedAttachment[] }} payload
 * @returns {Promise<{ ok: boolean, emailId?: string, error?: string }>}
 */
/** @param {import("@d31ma/fylo").default} fylo */
export async function processInboundEmail(fylo, payload) {
  const recipient = normalizeEmailAddress(payload.recipient)
  if (!recipient) return { ok: false, error: 'Invalid recipient' }

  const domain = recipient.split('@')[1]
  const rules = await listEnabledRulesForDomain(fylo, domain)

  const matchedRule = findMatchingRule(recipient, rules)
  if (!matchedRule) return { ok: false, error: 'No matching route' }

  // Check suppression
  const suppressed = await getSuppressedSet(fylo)
  if (suppressed.has(payload.sender)) return { ok: false, error: 'Sender is suppressed' }

  return await applyRuleAction(fylo, matchedRule, { ...payload, recipient })
}

/**
 * @param {string} recipient
 * @param {InboxRule[]} rules
 * @returns {InboxRule | null}
 */
function findMatchingRule(recipient, rules) {
  for (const rule of rules) {
    if (ruleMatches(recipient, rule)) return rule
  }
  return null
}

/** @param {string} recipient @param {InboxRule} rule */
function ruleMatches(recipient, rule) {
  if (!rule.conditions || rule.conditions.length === 0) return true
  const domain = recipient.split('@')[1]
  const parts = { recipient, domain }
  const results = rule.conditions.map(c => conditionMatches(c, parts))
  return rule.conditionMatch === 'all' ? results.every(Boolean) : results.some(Boolean)
}

/**
 * @param {RuleCondition} condition
 * @param {{ recipient: string, domain: string }} parts
 */
function conditionMatches(condition, parts) {
  const value = condition.value.toLowerCase()
  switch (condition.field) {
    case 'to': return matchOp(parts.recipient.toLowerCase(), condition.op, value)
    case 'from': return false // evaluated at rule level
    case 'subject': return false
    default: return false
  }
}

/** @param {string} haystack @param {string} op @param {string} needle */
function matchOp(haystack, op, needle) {
  switch (op) {
    case 'contains': return haystack.includes(needle)
    case 'equals': return haystack === needle
    case 'startsWith': return haystack.startsWith(needle)
    default: return false
  }
}

/**
 * @param {import('@d31ma/fylo').default} fylo
 * @param {InboxRule} rule
 * @param {{ recipient: string, sender: string, subject: string, body: string, messageId?: string, attachments?: ParsedAttachment[] }} payload
 */
async function applyRuleAction(fylo, rule, payload) {
  for (const action of rule.actions) {
    switch (action.type) {
      case 'store': return await storeEmail(fylo, payload)
      case 'forward': return await forwardEmail(fylo, action.to, payload)
      case 'webhook': return await triggerWebhook(action.url, action.secret, payload)
      case 'drop': return { ok: true }
    }
  }
  return await storeEmail(fylo, payload) // default: store
}

/**
 * @param {import('@d31ma/fylo').default} fylo
 * @param {{ recipient: string, sender: string, subject: string, body: string, messageId?: string, attachments?: ParsedAttachment[] }} payload
 */
async function storeEmail(fylo, payload) {
  const domain = payload.recipient.split('@')[1]
  const email = {
    id: payload.messageId || `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    domain,
    recipient: payload.recipient,
    sender: payload.sender,
    subject: payload.subject,
    body: payload.body,
    folder: 'inbox',
    read: false,
    starred: false,
    receivedAt: new Date().toISOString(),
    processed: true,
  }
  const docId = await fylo.putData(Collections.EMAILS, email)
  // Save attachments if any
  if (payload.attachments && payload.attachments.length > 0) {
    const { saveEmailAttachments } = await import('../repositories/attachments.js')
    await saveEmailAttachments(fylo, email.id, domain, payload.attachments)
  }
  return { ok: true, emailId: email.id }
}

/**
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} to
 * @param {{ recipient: string, sender: string, subject: string, body: string }} payload
 */
async function forwardEmail(fylo, to, payload) {
  const smtp = await getSmtpAdapter()
  await smtp.send({ to: [to], subject: `Fwd: ${payload.subject}`, text: payload.body })
  return await storeEmail(fylo, { ...payload, recipient: to })
}

/**
 * @param {string} url
 * @param {string | undefined} secret
 * @param {object} payload
 */
async function triggerWebhook(url, secret, payload) {
  const body = JSON.stringify(payload)
  const headers = { 'Content-Type': 'application/json' }
  if (secret) { headers['X-Hermes-Signature'] = hmacSha256Hex(body, secret) }
  await fetch(url, { method: 'POST', headers, body })
  return { ok: true }
}

/**
 * Parse a raw message body (plain text or MIME).
 * @param {string} rawBody
 * @returns {Promise<{ text: string, attachments: import('../repositories/attachments.js').ParsedAttachment[] }>}
 */
export async function parseInboundMessage(rawBody) {
  if (!rawBody) return { text: '', attachments: [] }
  try {
    const { simpleParser } = await import('mailparser')
    const parsed = await simpleParser(rawBody)
    const attachments = (parsed.attachments || []).map(a => ({
      filename: a.filename || 'attachment',
      contentType: a.contentType || 'application/octet-stream',
      content: a.content instanceof Uint8Array ? a.content : new TextEncoder().encode(String(a.content || '')),
      disposition: a.contentDisposition || 'attachment',
      contentId: a.contentId || undefined,
    }))
    return { text: parsed.text || rawBody, attachments }
  } catch {
    return { text: rawBody, attachments: [] }
  }
}

/**
 * Match a recipient against a domain's route rules.
 * @param {import('@/types').RouteRule[]} routes
 * @param {string} recipient
 * @returns {import('@/types').RouteRule | null}
 */
export function matchRoute(routes, recipient) {
  for (const route of routes) {
    if (!route.enabled) continue
    if (route.match === '*') return route
    if (route.match === `*@${recipient.split('@')[1]}`) return route
    if (route.match === recipient) return route
  }
  return null
}

/**
 * Apply a route rule action to a message.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {import('@/types').RouteRule} rule
 * @param {string} messageId
 * @param {string} sender
 * @param {string} recipient
 * @param {string} subject
 * @returns {Promise<void>}
 */
export async function applyRouteAction(fylo, rule, messageId, sender, recipient, subject) {
  switch (rule.action.type) {
    case 'webhook': try {
      const body = JSON.stringify({ messageId, sender, recipient, subject })
      const headers = { 'Content-Type': 'application/json' }
      await fetch(rule.action.url, { method: 'POST', headers, body })
    } catch {} break
    case 'forward': if (rule.action.to && rule.action.to !== recipient) {
      const smtp = await getSmtpAdapter()
      await smtp.send({ to: [rule.action.to], subject: `Fwd: ${subject}`, text: `Forwarded from ${sender} to ${recipient}` })
    } break
    case 'store': break
    case 'drop': break
  }
}

/**
 * Apply inbox rules to a newly delivered message.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string} messageId
 * @param {string} domain
 * @param {{ sender: string, recipient: string, subject: string }} meta
 * @returns {Promise<void>}
 */
export async function applyInboxRules(fylo, messageId, domain, meta) {
  try {
    const rules = await listEnabledRulesForDomain(fylo, domain)
    for (const rule of rules) {
      let matched = false
      for (const condition of rule.conditions) {
        let condMatch = false
        const value = condition.value.toLowerCase()
        switch (condition.field) {
          case 'from': condMatch = matchString(meta.sender, condition.op, value); break
          case 'to': condMatch = matchString(meta.recipient, condition.op, value); break
          case 'subject': condMatch = matchString(meta.subject, condition.op, value); break
        }
        if (rule.conditionMatch === 'all') { if (!condMatch) { matched = false; break } matched = true }
        else { if (condMatch) { matched = true; break } }
      }
      if (matched || !rule.conditions?.length) {
        for (const action of rule.actions) {
          if (action.type === 'folder') { await fylo.patchDoc('emails', { [messageId]: { folder: action.folder } }) }
          else if (action.type === 'forward') { try { const smtp = await getSmtpAdapter(); await smtp.send({ to: [action.to], subject: `Fwd: ${meta.subject}`, text: `Forwarded` }) } catch {} }
        }
      }
    }
  } catch {}
}

/** @param {string} a @param {string} op @param {string} b */
function matchString(a, op, b) {
  const ha = a.toLowerCase(), hb = b.toLowerCase()
  if (op === 'contains') return ha.includes(hb)
  if (op === 'equals') return ha === hb
  if (op === 'startsWith') return ha.startsWith(hb)
  return false
}
