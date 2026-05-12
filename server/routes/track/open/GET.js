import { createDb } from "@/repositories/index.js";
import { recordOpen } from "@/repositories/tracking.js";

/**
 * 1x1 transparent GIF pixel (43 bytes).
 * Used as a tracking pixel for email open detection.
 */
const PIXEL = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
  0x01, 0x00, 0x80, 0x00, 0x00, 0xFF, 0xFF, 0xFF,
  0x00, 0x00, 0x00, 0x21, 0xF9, 0x04, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3B,
]);

/**
 * GET /track/open
 *
 * Serves a 1x1 transparent GIF pixel. When accessed by an email client
 * (loading an embedded tracking image), records the open event.
 *
 * No authentication required — this endpoint is called by email clients
 * loading images. Uses random UUIDs as tracking IDs to prevent guessing.
 *
 * @param {object} params
 * @param {{ id?: string }} params.query - Query string parameters
 * @returns {Promise<Response|Record<string, unknown>>}
 */
export async function handler({ query }) {
  const trackingId = query?.id;
  if (!trackingId || typeof trackingId !== 'string' || !trackingId.trim()) {
    // Even for invalid requests, serve the pixel (don't leak info)
    return new Response(PIXEL, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  }

  // Record the open event asynchronously — don't block the pixel response
  const fylo = await createDb();
  recordOpen(fylo, trackingId).catch(err => {
    console.error("[track/open] Failed to record open:", err);
  });

  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}
