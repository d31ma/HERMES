import { createHmac, timingSafeEqual } from 'node:crypto'
import { requireEnv } from '@/services/security.js'

/** @typedef {{ email: string, domains: string[], role: 'admin' | 'viewer', iat: number, exp: number }} JwtClaims */

/** @param {Buffer} buf */
function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '') }

/** @param {string} s */
function fromB64url(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64') }

/**
 * @param {Omit<JwtClaims, 'iat' | 'exp'>} payload
 * @param {string} secret
 * @param {number} [ttlSeconds]
 * @returns {string}
 */
export function signJwt(payload, secret, ttlSeconds = 3600) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const now = Math.floor(Date.now() / 1000)
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })))
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

/**
 * @param {string} token
 * @param {string} secret
 * @returns {JwtClaims | null}
 */
export function verifyJwt(token, secret) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  try {
    const sigBuf = Buffer.from(sig, 'ascii')
    const expBuf = Buffer.from(expected, 'ascii')
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null
    const payload = JSON.parse(fromB64url(body).toString())
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch (e) {
    if (!(e instanceof SyntaxError)) console.error('[auth] JWT verification error:', e)
    return null
  }
}

/** @returns {string} */
export function getJwtSecret() { return requireEnv('JWT_SECRET') }
