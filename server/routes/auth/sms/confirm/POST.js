import { randomBytes } from "node:crypto";
import { r400, r401, r429 } from "@/services/respond.js";
import { signJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findUserByEmail } from "@/repositories/users.js";
import { findOtpSession, deleteOtpSession } from "@/repositories/otp.js";
import { listDevices, putSetupSession } from "@/repositories/mfa.js";
import { checkRateLimit } from "@/services/rate-limit.js";
import { sha256Hex, timingSafeStringEqual } from "@/services/security.js";

/**
 * POST /auth/sms/confirm
 * @param {object} params
 * @param {{ sessionId: string, code: string }} params.body - Request payload
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const { sessionId, code } = body ?? {};
  if (!sessionId || !code) return r400("sessionId and code required");

  const fylo = await createDb();
  const limit = await checkRateLimit(fylo, ["sms-confirm", sessionId, context.ipAddress], 12, 5 * 60 * 1000);
  if (!limit.allowed) return r429("Too many code attempts", limit.retryAfterSeconds);

  const [docId, session] = await findOtpSession(fylo, sessionId);
  if (!session || !docId) return r401("Invalid or expired session");
  // @ts-ignore - session is OtpSession from Fylo, TS infers string | Record<string, any>
  if (new Date(session.expiresAt) < new Date()) {
    await deleteOtpSession(fylo, docId);
    return r401("Code has expired");
  }
  // @ts-ignore - session is OtpSession from Fylo
  if (!/^\d{6}$/.test(code) || !timingSafeStringEqual(sha256Hex(code), session.codeHash)) {
    return r401("Invalid code");
  }
  await deleteOtpSession(fylo, docId);

  // @ts-ignore - session is OtpSession from Fylo
  const [, user] = await findUserByEmail(fylo, session.email);
  if (!user) return r401("Account not found");

  // @ts-ignore - session is OtpSession from Fylo
  const devices = await listDevices(fylo, session.email);
  if (devices.length === 0) {
    const setupToken = randomBytes(32).toString("hex");
    await putSetupSession(fylo, {
      id: setupToken,
      // @ts-ignore - session is OtpSession from Fylo
      email: session.email,
      totpSecret: "", // placeholder — was TOTP, now unused
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    return { requiresSetup: true, setupToken };
  }

  const token = signJwt({ email: user.email, domains: user.domains, role: user.role }, getJwtSecret());
  return { token, email: user.email, domains: user.domains, role: user.role };
}
