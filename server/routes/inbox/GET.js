import { r400, r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { listEmails } from "@/repositories/emails.js";
import { presentEmailsForDomainMigrations } from "@/services/domain-migration.js";
/**
 * GET /inbox
 * @param {object} params
 * @param {{ q?: string, search?: string, folder?: string, read?: boolean, starred?: boolean, hasAttachment?: boolean, limit?: number, offset?: number }} params.query - Query string parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<unknown>}
 */
export async function handler({ context, query }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  const filters = parseFilters(query ?? {});
  if (filters instanceof Error)
    return r400(filters.message);
  const fylo = await createDb();
  return await presentEmailsForDomainMigrations(fylo, await listEmails(fylo, claims.domains, filters));
}
function parseFilters(query) {
  const filters = {};
  const q = readString(query.q ?? query.search);
  if (q)
    filters.query = q;
  const folder = readString(query.folder);
  if (folder)
    filters.folder = folder;
  const read = readBoolean(query.read);
  if (read instanceof Error)
    return read;
  if (read != null)
    filters.read = read;
  const starred = readBoolean(query.starred);
  if (starred instanceof Error)
    return starred;
  if (starred != null)
    filters.starred = starred;
  const hasAttachment = readBoolean(query.hasAttachment ?? query.attachments);
  if (hasAttachment instanceof Error)
    return hasAttachment;
  if (hasAttachment != null)
    filters.hasAttachment = hasAttachment;
  const limit = readNumber(query.limit, "limit");
  if (limit instanceof Error)
    return limit;
  if (limit != null)
    filters.limit = limit;
  const offset = readNumber(query.offset, "offset");
  if (offset instanceof Error)
    return offset;
  if (offset != null)
    filters.offset = offset;
  return filters;
}
function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function readBoolean(value) {
  if (value == null || value === "")
    return;
  if (value === true || value === "true" || value === "1")
    return true;
  if (value === false || value === "false" || value === "0")
    return false;
  return new Error("Invalid boolean query parameter");
}
function readNumber(value, name) {
  if (value == null || value === "")
    return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    return new Error(`Invalid ${name} query parameter`);
  return parsed;
}
