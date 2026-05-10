import { r400, r403 } from "@/services/respond.js";
import { createDb } from "@/repositories/index.js";
import { putUser } from "@/repositories/users.js";
import { isTestRoutesEnabled } from "@/services/security.js";
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
  return { email: user.email.toLowerCase() };
}
