import { createDb } from "@/repositories/index.js";
import { recordClick } from "@/repositories/tracking.js";

/**
 * GET /track/click
 *
 * Link-tracking redirect proxy. Records the click event and then issues
 * a 302 redirect to the original URL.
 *
 * No authentication required — this endpoint is called by email clients
 * when recipients click rewritten links in tracked emails.
 *
 * @param {object} params
 * @param {{ url?: string, id?: string }} params.query - Query string parameters
 * @returns {Promise<Response|Record<string, unknown>>}
 */
export async function handler({ query }) {
  const url = query?.url;
  const trackingId = query?.id;

  // Validate we have both parameters
  if (!url || typeof url !== 'string' || !url.trim()) {
    return new Response("Missing url parameter", { status: 400 });
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
  } catch {
    return new Response("Invalid url parameter", { status: 400 });
  }

  // Basic protection against open redirect attacks — only allow http/https URLs
  if (!/^https?:\/\//i.test(targetUrl)) {
    return new Response("Invalid redirect URL", { status: 400 });
  }

  // Record the click event asynchronously — don't block the redirect
  if (trackingId && typeof trackingId === 'string' && trackingId.trim()) {
    const fylo = await createDb();
    recordClick(fylo, trackingId, targetUrl).catch(err => {
      console.error("[track/click] Failed to record click:", err);
    });
  }

  // 302 redirect to the original URL
  return new Response(null, {
    status: 302,
    headers: {
      "Location": targetUrl,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
