import { randomBytes } from "node:crypto";
import { r401 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { buildRegistrationOptions } from "@/services/webauthn.js";
import { createDb } from "@/repositories/index.js";
import { listDevices, putSetupSession } from "@/repositories/mfa.js";

/**
 * POST /mfa/provision
 * Initiates WebAuthn passkey registration from the settings page.
 * @param {object} params
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims) return r401("Authentication required");

  const fylo = await createDb();
  const existingDevices = await listDevices(fylo, claims.email);

  const { challenge, options } = buildRegistrationOptions(
    claims.email,
    claims.email.split("@")[0],
    // @ts-ignore - credentialId exists on WebAuthn devices stored in Fylo, not on MfaDevice type
    existingDevices.map(d => ({ credentialId: d.credentialId || d.id }))
  );

  const setupToken = randomBytes(32).toString("hex");
  await putSetupSession(fylo, {
    id: setupToken,
    email: claims.email,
    totpSecret: challenge,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });

  return { setupToken, challenge, options };
}
