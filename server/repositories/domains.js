import { Collections, collect } from './index.js'

/**
 * Fylo stores nested arrays as JSON strings. These helpers convert between
 * the typed DomainConfig interface and the flat shape stored on disk.
 * @typedef {Omit<import('@/types').DomainConfig, 'routes'> & { routes: string | import('@/types').RouteRule[] }} RawDomainDoc
 */

/** @param {RawDomainDoc} raw @returns {import('@/types').DomainConfig} */
function deserialize(raw) { return { ...raw, routes: typeof raw.routes === 'string' ? JSON.parse(raw.routes) : (raw.routes ?? []) } }
/** @param {import('@/types').DomainConfig} config @returns {RawDomainDoc} */
function serialize(config) { return { ...config, routes: JSON.stringify(config.routes) } }

/**
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string[]} allowedDomains
 * @returns {Promise<import('@/types').DomainConfig[]>}
 */
export async function listDomains(fylo, allowedDomains) {
  const docs = await collect(fylo.findDocs(Collections.DOMAINS, { $ops: [] }).collect())
  return Object.values(docs).filter(d => allowedDomains.includes(d.domain)).map(d => deserialize(/** @type {RawDomainDoc} */ (d)))
}

/** @returns {Promise<[string | null, import('@/types').DomainConfig | null]>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function findDomainEntry(fylo, domain) {
  const docs = await collect(fylo.findDocs(Collections.DOMAINS, { $ops: [{ domain: { $eq: domain } }] }).collect())
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], deserialize(/** @type {RawDomainDoc} */ (entry[1]))] : [null, null]
}

/** @returns {Promise<string>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function putDomain(fylo, config) { return await fylo.putData(Collections.DOMAINS, serialize(config)) }
/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function updateDomainRoutes(fylo, docId, routes) { await fylo.patchDoc(Collections.DOMAINS, { [docId]: { routes: JSON.stringify(routes) } }) }
/** @returns {Promise<void>} */
/** @param {import("@d31ma/fylo").default} fylo */
export async function deleteDomain(fylo, docId) { await fylo.delDoc(Collections.DOMAINS, docId) }
