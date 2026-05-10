import { Collections, collect } from './index.js'

/** @returns {Promise<Array<import('@/types').DomainMigration & { docId: string }>>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function listDomainMigrations(fylo) {
  const docs = await collect(fylo.findDocs(Collections.DOMAIN_MIGRATIONS, { $ops: [] }).collect())
  return Object.entries(docs).map(([docId, migration]) => ({ docId, ...migration }))
}

/** @returns {Promise<[string | null, import('@/types').DomainMigration | null]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function findDomainMigration(fylo, fromDomain, toDomain) {
  const docs = await collect(fylo.findDocs(Collections.DOMAIN_MIGRATIONS, { $ops: [{ fromDomain: { $eq: fromDomain } }, { toDomain: { $eq: toDomain } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** @returns {Promise<string>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function putDomainMigration(fylo, migration) {
  const [docId] = await findDomainMigration(fylo, migration.fromDomain, migration.toDomain)
  if (docId) { await fylo.patchDoc(Collections.DOMAIN_MIGRATIONS, { [docId]: migration }); return docId }
  return await fylo.putData(Collections.DOMAIN_MIGRATIONS, migration)
}
