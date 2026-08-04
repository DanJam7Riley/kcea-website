import { logger } from "./logger";

// Outbound transactional email via Resend (https://resend.com).
// Credentials come from RESEND_API_KEY. Sender address is fixed
// per product spec.

const FROM = "KCEA <noreply@kcea.co.za>";

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export interface EmailAttachment {
  filename: string;
  // Base64-encoded file content — Resend's REST API takes this directly,
  // no data: URI prefix needed.
  content: string;
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  attachments?: EmailAttachment[],
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };

  try {
    const body: Record<string, unknown> = { from: FROM, to, subject, text };
    if (attachments && attachments.length > 0) {
      body.attachments = attachments;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      logger.warn({ status: res.status, resend: data }, "Resend send failed");
      return { ok: false, reason: data.message ?? data.name ?? `http_${res.status}` };
    }
    return { ok: true, id: data.id ?? "" };
  } catch (err) {
    logger.error({ err }, "Resend request errored");
    return { ok: false, reason: "network_error" };
  }
}
