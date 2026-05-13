import { r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findEmailById } from "@/repositories/emails.js";
import { findAttachmentById, readAttachmentContent } from "@/repositories/attachments.js";
/**
 * GET /inbox/_id/attachments/_attachmentId
 * @param {object} params
 * @param {{ id: string, attachmentId: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  const emailId = paths?.id;
  const attachmentId = paths?.attachmentId;
  if (!emailId || !attachmentId)
    return r404("Attachment not found");
  const fylo = await createDb();
  const [, email] = await findEmailById(fylo, emailId);
  if (!email)
    return r404("Email not found");
  // @ts-ignore - email is StoredEmail from findEmailById, TS sees string | StoredEmail
  if (!claims.domains.includes(email.domain))
    return r403("Access denied");
  const [, attachment] = await findAttachmentById(fylo, attachmentId);
  // @ts-ignore - attachment is EmailAttachmentRecord from Fylo, TS infers string | Record<string, any>
  if (!attachment || attachment.emailId !== emailId)
    return r404("Attachment not found");
  const bytes = await readAttachmentContent(attachment);
  return {
    // @ts-ignore - attachment from Fylo inferred as string | Record<string, any>
    id: attachment.id,
    // @ts-ignore - attachment from Fylo
    filename: attachment.filename,
    // @ts-ignore - attachment from Fylo
    contentType: attachment.contentType,
    // @ts-ignore - attachment from Fylo
    size: attachment.size,
    contentBase64: Buffer.from(bytes).toString("base64")
  };
}
