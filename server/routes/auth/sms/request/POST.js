import { createHash, randomBytes, randomInt } from "node:crypto";
import { r400, r429 } from "@/services/respond.js";
import { getSmsAdapter } from "@/services/sms.js";
import { createDb } from "@/repositories/index.js";
import { findUserByEmailAndPhone } from "@/repositories/users.js";
import { putOtpSession, purgeExpiredOtpSessions, findValidOtpSession } from "@/repositories/otp.js";
import { checkRateLimit } from "@/services/rate-limit.js";
/**
 * POST /auth/sms/request
 * @param {object} params
 * @param {{ email: string, phone: string }} params.body - Request payload
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const { email, phone } = body ?? {};
  if (!email || !phone)
    return r400("email and phone required");
  const fylo = await createDb();
  const normalizedEmail = email.toLowerCase();
  const limit = await checkRateLimit(fylo, ["sms-request", normalizedEmail, context.ipAddress], 8, 15 * 60 * 1000);
  if (!limit.allowed)
    return r429("Too many code requests", limit.retryAfterSeconds);
  const [, user] = await findUserByEmailAndPhone(fylo, email.toLowerCase(), phone);
  if (!user)
    return { sent: true };
  await purgeExpiredOtpSessions(fylo, user.email);
  const existing = await findValidOtpSession(fylo, user.email, phone);
  if (existing) {
    return { sent: true, sessionId: existing.id };
  }
  const code = String(randomInt(1e5, 1e6)).padStart(6, "0");
  const sessionId = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await putOtpSession(fylo, {
    id: sessionId,
    email: user.email,
    phone,
    codeHash: createHash("sha256").update(code).digest("hex"),
    expiresAt
  });
  await getSmsAdapter().send(phone, `Your CADUCEUS code: ${code}. Expires in 5 minutes.`);
  return { sent: true, sessionId };
}
