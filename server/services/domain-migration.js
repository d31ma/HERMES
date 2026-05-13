import Fylo from '@d31ma/fylo'
import { listDomainMigrations } from '@/repositories/domain-migrations.js'

/**
 * @typedef {import('@/types').StoredEmail} StoredEmail
 * @typedef {import('@/types').DomainMigration} DomainMigration
 */

/**
 * @param {Fylo} fylo
 * @param {StoredEmail[]} emails
 * @returns {Promise<StoredEmail[]>}
 */
export async function presentEmailsForDomainMigrations(fylo, emails) {
  const migrations = /** @type {DomainMigration[]} */ (/** @type {unknown} */ (await listDomainMigrations(fylo)))
  if (migrations.length === 0) return emails
  return emails.map(email => rewriteEmailForMigration(email, migrations))
}

/**
 * @param {Fylo} fylo
 * @param {StoredEmail} email
 * @returns {Promise<StoredEmail>}
 */
export async function presentEmailForDomainMigrations(fylo, email) {
  const migrations = /** @type {DomainMigration[]} */ (/** @type {unknown} */ (await listDomainMigrations(fylo)))
  return rewriteEmailForMigration(email, migrations)
}

/**
 * @param {StoredEmail} email
 * @param {DomainMigration[]} migrations
 * @returns {StoredEmail}
 */
function rewriteEmailForMigration(email, migrations) {
  for (const migration of migrations) {
    const fromSuffix = `@${migration.fromDomain}`
    const toSuffix = `@${migration.toDomain}`
    if (email.recipient.endsWith(fromSuffix)) {
      return {
        ...email,
        recipient: email.recipient.replace(new RegExp(`${fromSuffix}$`), toSuffix),
        originalRecipient: email.originalRecipient || email.recipient,
      }
    }
  }
  return email
}
