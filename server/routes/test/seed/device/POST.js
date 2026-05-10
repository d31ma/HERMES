import { r400, r403 } from "@/services/respond.js";
import { createDb } from "@/repositories/index.js";
import { findUserByEmail } from "@/repositories/users.js";
import { putDevice } from "@/repositories/mfa.js";
import { isTestRoutesEnabled } from "@/services/security.js";

/**
 * POST /test/seed/device — creates a passkey device directly (bypasses WebAuthn).
 * Only available in test mode. Required for E2E tests in headless CI where
 * the browser has no real platform authenticator.
 */
export async function handler({ body }) {
  if (!isTestRoutesEnabled())
    return r403("Only available in test mode");

  const { email, name = "E2E Test Device" } = body ?? {};
  if (!email) return r400("email required");

  const fylo = await createDb();
  const [, user] = await findUserByEmail(fylo, email.toLowerCase());
  if (!user) return r400("user not found");

  const id = await putDevice(fylo, {
    email: user.email,
    deviceName: name,
    credentialId: `e2e-credential-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    publicKey: "e2e-test-key", // not a real key — only used to pass has-device checks in tests
    signCount: 0,
    createdAt: new Date().toISOString(),
  });

  return { id, email: user.email, name };
}
