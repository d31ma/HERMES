import { r400, r401, r403, r404 } from "@/services/respond.js";
import { verifyJwt, getJwtSecret } from "@/services/auth.js";
import { createDb } from "@/repositories/index.js";
import { findDeviceById, deleteDevice } from "@/repositories/mfa.js";
/**
 * DELETE /mfa/devices/_id
 * @param {object} params
 * @param {{ id: string }} params.paths - URL path parameters
 * @param {{ bearer?: { token: string } }} params.context - Request context
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ paths, context }) {
  const claims = verifyJwt(context.bearer?.token ?? "", getJwtSecret());
  if (!claims)
    return r401("Authentication required");
  const deviceId = paths?.id;
  if (!deviceId)
    return r400("device id required");
  const fylo = await createDb();
  const [docId, device] = await findDeviceById(fylo, deviceId);
  if (!docId || !device)
    return r404("Device not found");
  if (device.userEmail !== claims.email)
    return r403("Access denied");
  await deleteDevice(fylo, docId);
  return { deleted: deviceId };
}
