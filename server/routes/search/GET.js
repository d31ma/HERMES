import { r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { listEmails } from "@/repositories/emails.js";
import { parseSearchQuery } from "@/services/search-parser.js";
import { presentEmailsForDomainMigrations } from "@/services/domain-migration.js";

/**
 * GET /search
 *
 * Full-text search with Gmail-like query syntax.
 * Accepts ?q=<query> with support for:
 *   from:, to:, subject:, body:, attachment:, filename:
 *   has:attachment, is:unread, is:read, is:starred
 *   before:, after: (ISO date strings)
 *
 * @param {object} params
 * @param {{ q?: string }} params.query - Query string parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ query, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  const raw = (query?.q ?? "").trim();
  const parsed = parseSearchQuery(raw);

  // Build a combined query string from field-filtered terms for the existing
  // listEmails full-text matcher (which already understands from:, to:, etc.)
  const queryParts = [];
  if (parsed.from) queryParts.push(`from:${parsed.from}`);
  if (parsed.to) queryParts.push(`to:${parsed.to}`);
  if (parsed.subject) queryParts.push(`subject:${parsed.subject}`);
  if (parsed.body) queryParts.push(`body:${parsed.body}`);
  if (parsed.attachment) queryParts.push(`attachment:${parsed.attachment}`);
  if (parsed.text) queryParts.push(parsed.text);
  const queryStr = queryParts.join(' ');

  // Translate parsed boolean flags to listEmails filter fields
  const filters = /** @type {import('@/repositories/emails').EmailListFilters} */ ({});
  if (queryStr) filters.query = queryStr;
  if (parsed.read === true) filters.read = true;
  if (parsed.unread === true) filters.read = false;
  if (parsed.starred === true) filters.starred = true;
  if (parsed.hasAttachment === true) filters.hasAttachment = true;

  const fylo = await createDb();
  let results = await listEmails(fylo, claims.domains, filters);

  // Apply date filters (before:/after:) which listEmails doesn't natively support
  if (parsed.before) {
    const beforeMs = Date.parse(parsed.before);
    if (!isNaN(beforeMs)) {
      results = results.filter(e => new Date(e.receivedAt).getTime() < beforeMs);
    }
  }
  if (parsed.after) {
    const afterMs = Date.parse(parsed.after);
    if (!isNaN(afterMs)) {
      results = results.filter(e => new Date(e.receivedAt).getTime() > afterMs);
    }
  }

  return await presentEmailsForDomainMigrations(fylo, results);
}
