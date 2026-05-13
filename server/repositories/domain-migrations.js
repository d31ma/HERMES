import { Collections, collect } from './index.js'

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @returns {Promise<Array<import('@/types').DomainMigration & { docId: string }>>}
 */
export async function listDomainMigrations(fylo) {
  const docs = await collect(fylo.findDocs(Collections.DOMAIN_MIGRATIONS, { $ops: [] }).collect())
  return Object.entries(docs).map(([docId, migration]) => ({ docId, ...migration }))
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {string} fromDomain
 * @param {string} toDomain
 * @returns {Promise<[string | null, import('@/types').DomainMigration | null]>}
 */
export async function findDomainMigration(fylo, fromDomain, toDomain) {
  const docs = await collect(fylo.findDocs(Collections.DOMAIN_MIGRATIONS, { $ops: [{ fromDomain: { $eq: fromDomain } }, { toDomain: { $eq: toDomain } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/**
 * @param {import("@d31ma/fylo").default} fylo
 * @param {import('@/types').DomainMigration} migration
 * @returns {Promise<string>}
 */
export async function putDomainMigration(fylo, migration) {
  const [docId] = await findDomainMigration(fylo, migration.fromDomain, migration.toDomain)
  if (docId) { await fylo.patchDoc(Collections.DOMAIN_MIGRATIONS, { [/** @type {string} */ (docId)]: migration }); return docId }
  return await fylo.putData(Collections.DOMAIN_MIGRATIONS, migration)
}
