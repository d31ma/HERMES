import { r400, r403 } from "@/services/respond.js";
import { createDb } from "@/repositories/index.js";
import { putUser } from "@/repositories/users.js";
import { isTestRoutesEnabled } from "@/services/security.js";
import { signJwt } from "@/services/auth.js";
/**
 * POST /test/seed/user
 * @param {object} params
 * @param {{ email: string, phones: string[], domains: string[], role: string }} params.body - Request payload
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body }) {
  if (!isTestRoutesEnabled())
    return r403("Only available in test mode");
  const user = body;
  if (!user?.email || !user.phones?.length || !user.domains?.length || !user.role) {
    return r400("email, phones, domains, and role required");
  }
  const fylo = await createDb();
  await putUser(fylo, user);
  const token = signJwt({ email: user.email.toLowerCase(), role: /** @type {'admin' | 'viewer'} */ (user.role), domains: user.domains }, /** @type {string} */ (process.env.JWT_SECRET));
  return { email: user.email.toLowerCase(), token };
}
