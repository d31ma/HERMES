import { randomBytes, randomInt, createHash } from "node:crypto";
import { r400, r403 } from "@/services/respond.js";
import { createDb } from "@/repositories/index.js";
import { findUserByEmail } from "@/repositories/users.js";
import { putOtpSession } from "@/repositories/otp.js";
import { isTestRoutesEnabled } from "@/services/security.js";
/**
 * POST /test/seed/otp
 * @param {object} params
 * @param {{ email: string, phone: string }} params.body - Request payload
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body }) {
  if (!isTestRoutesEnabled())
    return r403("Only available in test mode");
  const { email, phone } = body ?? {};
  if (!email || !phone)
    return r400("email and phone required");
  const code = String(randomInt(1e5, 1e6)).padStart(6, "0");
  const sessionId = randomBytes(32).toString("hex");
  const codeHash = createHash("sha256").update(code).digest("hex");
  const fylo = await createDb();
  const [, user] = await findUserByEmail(fylo, email.toLowerCase());
  await putOtpSession(fylo, {
    id: sessionId,
    email: user?.email ?? email.toLowerCase(),
    phone,
    codeHash,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  });
  return { sessionId, code };
}
