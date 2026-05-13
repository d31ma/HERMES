import { r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { listScheduled } from "@/repositories/scheduled.js";

/**
 * GET /send/scheduled
 * Returns list of scheduled emails for the authenticated user.
 * @param {object} params
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<unknown>}
 */
export async function handler({ context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  const fylo = await createDb();
  const records = await listScheduled(fylo, claims.email);
  const results = [];

  for (const entry of Object.values(records)) {
    results.push({
      id: entry.id,
      to: entry.email.to,
      cc: entry.email.cc ?? [],
      subject: entry.email.subject,
      text: entry.email.text ?? '',
      sendAt: new Date(entry.sendAt).toISOString(),
      createdAt: new Date(entry.createdAt).toISOString(),
    });
  }

  return results;
}
