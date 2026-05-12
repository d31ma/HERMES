import { r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { listAllSnoozed } from "@/repositories/snooze.js";
import { findEmailById } from "@/repositories/emails.js";

/**
 * GET /snooze
 * Returns list of snoozed emails that are ready to wake.
 * @param {object} params
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function handler({ context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  const fylo = await createDb();
  const records = await listAllSnoozed(fylo);
  const results = [];

  for (const entry of Object.values(records)) {
    const [, email] = await findEmailById(fylo, entry.emailId);
    if (email && claims.domains.includes(email.domain)) {
      results.push({
        ...email,
        snoozedUntil: new Date(entry.until).toISOString(),
        snoozeDocId: entry.id,
      });
    }
  }

  return results;
}
