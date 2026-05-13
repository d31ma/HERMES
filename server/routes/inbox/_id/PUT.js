import { r400, r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findEmailById, updateEmail } from "@/repositories/emails.js";
import { listAttachmentSummaries } from "@/repositories/attachments.js";
const SYSTEM_FOLDERS = new Set(["inbox", "archive", "trash"]);
/**
 * PUT /inbox/_id
 * @param {object} params
 * @param {{ read?: boolean, starred?: boolean, folder?: string }} params.body - Request payload
 * @param {{ id: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  const id = paths?.id;
  if (!id)
    return r404("Email not found");
  const patch = parsePatch(body);
  if (patch instanceof Error)
    return r400(patch.message);
  const fylo = await createDb();
  const [docId, email] = await findEmailById(fylo, id);
  if (!docId || !email)
    return r404("Email not found");
  // @ts-ignore - email is StoredEmail from findEmailById, TS sees string | StoredEmail
  if (!claims.domains.includes(email.domain))
    return r403("Access denied");
  await updateEmail(fylo, docId, patch);
  // @ts-ignore - email is StoredEmail, patch is {} from parsePatch
  const updated = /** @type {Record<string, unknown>} */ ({ ...email, ...patch })
  return {
    ...updated,
    attachments: await listAttachmentSummaries(fylo, id)
  };
}
function parsePatch(body) {
  const input = body;
  const patch = {};
  if (!input || typeof input !== "object")
    return new Error("Update payload required");
  if ("folder" in input) {
    if (typeof input.folder !== "string" || !input.folder.trim()) {
      return new Error("folder must be a non-empty string");
    }
    const folder = input.folder.trim().toLowerCase();
    if (!SYSTEM_FOLDERS.has(folder) && folder.length > 60) {
      return new Error("folder is too long");
    }
    patch.folder = folder;
  }
  if ("read" in input) {
    if (typeof input.read !== "boolean")
      return new Error("read must be a boolean");
    patch.read = input.read;
  }
  if ("starred" in input) {
    if (typeof input.starred !== "boolean")
      return new Error("starred must be a boolean");
    patch.starred = input.starred;
  }
  if (Object.keys(patch).length === 0)
    return new Error("No supported fields to update");
  return patch;
}
