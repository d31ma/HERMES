import Fylo from '@d31ma/fylo'

/** @readonly @enum {string} */
export const Collections = {
  DOMAINS:           'domains',
  DOMAIN_MIGRATIONS: 'domain-migrations',
  EMAILS:            'emails',
  ATTACHMENTS:       'attachments',
  SUPPRESSED:        'suppressed',
  USERS:             'users',
  OTP_SESSIONS:      'otp-sessions',
  INBOX_RULES:       'inbox-rules',
  MFA_DEVICES:       'mfa-devices',
  MFA_SESSIONS:      'mfa-sessions',
  SETUP_SESSIONS:    'setup-sessions',
  PUSH_SUBSCRIPTIONS:'push-subscriptions',
  RATE_LIMITS:       'rate-limits',
}

/**
 * Creates a Fylo instance and ensures all collections exist.
 * Pass a custom `root` for test isolation (e.g. a temp directory).
 * Falls back to the `FYLO_ROOT` env var, then `/mnt/hermes`.
 * @param {string} [root]
 * @returns {Promise<import('@d31ma/fylo').default>}
 */
export async function createDb(root) {
  const fylo = new Fylo({ root: root ?? process.env.FYLO_ROOT ?? '/mnt/hermes' })
  await Promise.all(Object.values(Collections).map(name => fylo.createCollection(name)))
  return fylo
}

/**
 * Collect all documents from a Fylo async generator into a plain record.
 * @template {Record<string, any>} T
 * @param {AsyncIterable<any>} gen
 * @returns {Promise<Record<string, T>>}
 */
export async function collect(gen) {
  const results = {}
  for await (const doc of gen) Object.assign(results, doc)
  return results
}
