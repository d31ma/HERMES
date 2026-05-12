import { r400, r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { putTemplate } from "@/repositories/templates.js";

/**
 * POST /templates
 * Save a new email template.
 * @param {object} params
 * @param {{ name: string, subject: string, text?: string, to?: string, cc?: string }} params.body - Request payload
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");

  const name = body?.name;
  const subject = body?.subject;
  if (!name || typeof name !== 'string' || !name.trim())
    return r400("name is required");
  if (!subject || typeof subject !== 'string' || !subject.trim())
    return r400("subject is required");

  const id = `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const fylo = await createDb();

  await putTemplate(fylo, {
    id,
    name: name.trim(),
    subject: subject.trim(),
    text: typeof body.text === 'string' ? body.text : '',
    to: typeof body.to === 'string' ? body.to : '',
    cc: typeof body.cc === 'string' ? body.cc : '',
    owner: claims.email,
    createdAt: Date.now(),
  });

  return { saved: true, id };
}
