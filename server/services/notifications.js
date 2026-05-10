import { getJwtSecret, verifyJwt } from '@/services/auth.js'
import { r401 } from '@/services/respond.js'

/**
 * @typedef {{ error: string, unauthorized: boolean }} AuthErrorResponse
 */

/**
 * @param {{ bearer?: { token: string } }} context
 * @returns {import('@/services/auth.js').JwtClaims | AuthErrorResponse}
 */
export function requireClaims(context) {
  const claims = verifyJwt(context.bearer?.token ?? '', getJwtSecret())
  return claims ?? r401('Authentication required')
}

/** @param {unknown} value @returns {value is AuthErrorResponse} */
export function isAuthError(value) { return Boolean(value && typeof value === 'object' && 'unauthorized' in value) }
