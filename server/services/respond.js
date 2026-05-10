/**
 * Error response helpers that produce distinct JSON shapes per status code.
 * Tachyon's matchStatusCode matches stdout JSON against OPTIONS schemas in
 * ascending order — the extra discriminating fields (unauthorized, forbidden,
 * notFound) ensure each status maps to exactly one shape.
 */

/** @param {string} error @returns {{ error: string }} */
export const r400 = (error) => ({ error })

/** @param {string} error @returns {{ error: string, unauthorized: true }} */
export const r401 = (error) => ({ error, unauthorized: true })

/** @param {string} error @returns {{ error: string, forbidden: true }} */
export const r403 = (error) => ({ error, forbidden: true })

/** @param {string} error @returns {{ error: string, notFound: true }} */
export const r404 = (error) => ({ error, notFound: true })

/** @param {string} error @param {number} retryAfterSeconds @returns {{ error: string, retryAfterSeconds: number, rateLimited: true }} */
export const r429 = (error, retryAfterSeconds) => ({ error, retryAfterSeconds, rateLimited: true })

/** @param {string} error @param {string[]} blocked @returns {{ error: string, blocked: string[] }} */
export const r422 = (error, blocked) => ({ error, blocked })
