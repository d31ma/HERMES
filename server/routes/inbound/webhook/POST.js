import { randomBytes } from "node:crypto";
import { r400, r401 } from "@/services/respond.js";
import { createDb } from "@/repositories/index.js";
import { Collections } from "@/repositories/index.js";
import { findDomainEntry } from "@/repositories/domains.js";
import { findEmailById } from "@/repositories/emails.js";
import { saveEmailAttachments } from "@/repositories/attachments.js";
import { matchRoute, applyRouteAction, applyInboxRules, parseInboundMessage } from "@/services/inbound.js";
import { sendEmailNotification } from "@/services/push.js";
import { createHmac } from "node:crypto";
import { requireEnv } from "@/services/security.js";
/**
 * POST /inbound/webhook
 * @param {object} params
 * @param {{ recipient: string, sender: string, subject?: string, body?: string, messageId?: string }} params.body - Request payload
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler({ headers, body }) {
  const webhookSecret = requireEnv("INBOUND_WEBHOOK_SECRET");
  const signature = (headers ?? {})["x-hermes-signature"] ?? (headers ?? {})["X-Hermes-Signature"] ?? "";
  const jsonBody = JSON.stringify(body ?? {});
  const expected = createHmac("sha256", webhookSecret).update(jsonBody).digest("hex");
  if (!signature || signature !== expected) {
    return r401("Invalid webhook signature");
  }
  const msg = body;
  if (!msg?.recipient || !msg.sender)
    return r400("recipient and sender required");
  const recipient = msg.recipient.toLowerCase();
  const sender = msg.sender.toLowerCase();
  const subject = msg.subject ?? "(no subject)";
  const messageId = msg.messageId ?? randomBytes(16).toString("hex");
  const parsedMessage = await parseInboundMessage(msg.body ?? "");
  const domain = recipient.split("@")[1];
  if (!domain)
    return r400("Invalid recipient address");
  const fylo = await createDb();
  const [, domainConfig] = await findDomainEntry(fylo, domain);
  if (!domainConfig || !domainConfig.inboundEnabled) {
    return { accepted: false, reason: "domain not configured" };
  }
  const rule = matchRoute(domainConfig.routes, recipient);
  if (!rule || rule.action.type === "drop") {
    return { accepted: false, reason: "dropped by route rule" };
  }
  await saveEmailAttachments(fylo, messageId, domain, parsedMessage.attachments);
  await fylo.putData(Collections.EMAILS, {
    id: messageId,
    domain,
    recipient,
    sender,
    subject,
    body: parsedMessage.text,
    folder: "inbox",
    read: false,
    starred: false,
    receivedAt: new Date().toISOString(),
    processed: false
  });
  await applyRouteAction(fylo, rule, messageId, sender, recipient, subject);
  await applyInboxRules(fylo, messageId, domain, { sender, recipient, subject });
  const [, deliveredEmail] = await findEmailById(fylo, messageId);
  if (deliveredEmail) {
    await sendEmailNotification(fylo, deliveredEmail);
  }
  return { accepted: true, emailId: messageId };
}
