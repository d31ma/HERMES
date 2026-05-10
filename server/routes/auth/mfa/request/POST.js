import { randomBytes } from "node:crypto";
import { r400, r404, r429 } from "@/services/respond.js";
import { createDb } from "@/repositories/index.js";
import { findUserByEmail } from "@/repositories/users.js";
import { listDevices, putMfaSession, purgeExpiredMfaSessions } from "@/repositories/mfa.js";
import { checkRateLimit } from "@/services/rate-limit.js";
/**
 * POST /auth/mfa/request
 * @param {object} params
 * @param {{ email: string }} params.body - Request payload
 * @param {{ bearer?: { token: string }, ipAddress: string, requestId: string }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ body, context }) {
  const { email } = body ?? {};
  if (!email)
    return r400("email required");
  const fylo = await createDb();
  const limit = await checkRateLimit(fylo, ["mfa-request", email.toLowerCase(), context.ipAddress], 20, 15 * 60 * 1000);
  if (!limit.allowed)
    return r429("Too many sign-in attempts", limit.retryAfterSeconds);
  const [, user] = await findUserByEmail(fylo, email.toLowerCase());
  if (!user)
    return r404("No account found");
  const devices = await listDevices(fylo, user.email);
  if (devices.length === 0)
    return { requiresSetup: true };
  await purgeExpiredMfaSessions(fylo, user.email);
  const mfaSessionId = randomBytes(32).toString("hex");
  await putMfaSession(fylo, {
    id: mfaSessionId,
    email: user.email,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    failedAttempts: 0
  });
  return { mfaSessionId };
}
