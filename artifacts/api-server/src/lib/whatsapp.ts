import { getOrCreateSettings } from "./settings";
import { logger } from "./logger";

// Server-side WhatsApp sender. Used by the public "Update My Details"
// OTP flow. Credentials are read from environment variables first
// (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM) and
// fall back to the matching columns on site_settings so an admin can
// rotate them from the Settings tab without a redeploy.
//
// `from` and incoming recipient numbers are normalised to Twilio's
// `whatsapp:+E.164` shape before sending.

interface TwilioCreds {
  accountSid: string;
  authToken: string;
  from: string;
}

async function resolveCreds(): Promise<TwilioCreds | null> {
  const envSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const envTok = process.env.TWILIO_AUTH_TOKEN?.trim();
  const envFrom = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (envSid && envTok && envFrom) {
    return { accountSid: envSid, authToken: envTok, from: envFrom };
  }
  try {
    const s = await getOrCreateSettings();
    if (s.twilioAccountSid && s.twilioAuthToken && s.twilioWhatsappFrom) {
      return {
        accountSid: s.twilioAccountSid.trim(),
        authToken: s.twilioAuthToken.trim(),
        from: s.twilioWhatsappFrom.trim(),
      };
    }
  } catch (err) {
    logger.warn({ err }, "Twilio settings lookup failed");
  }
  return null;
}

// Take any user-entered phone and produce Twilio-compatible `whatsapp:+E.164`.
// SA-aware: bare local numbers like `082 123 4567` are assumed to be ZA mobile.
function toWhatsappAddr(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith("whatsapp:")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  let e164: string;
  if (trimmed.startsWith("+")) {
    e164 = `+${digits}`;
  } else if (digits.startsWith("27")) {
    e164 = `+${digits}`;
  } else if (digits.startsWith("0")) {
    e164 = `+27${digits.slice(1)}`;
  } else {
    e164 = `+${digits}`;
  }
  return `whatsapp:${e164}`;
}

export function isWhatsappConfigured(): boolean {
  const envOk = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
  return envOk;
}

export async function sendWhatsappMessage(to: string, body: string): Promise<{ ok: true; sid: string } | { ok: false; reason: string }> {
  const creds = await resolveCreds();
  if (!creds) return { ok: false, reason: "not_configured" };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`;
  const form = new URLSearchParams();
  form.set("To", toWhatsappAddr(to));
  form.set("From", toWhatsappAddr(creds.from));
  form.set("Body", body);

  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok) {
      logger.warn({ status: res.status, twilio: data }, "Twilio WhatsApp send failed");
      return { ok: false, reason: data.message ?? `http_${res.status}` };
    }
    return { ok: true, sid: data.sid ?? "" };
  } catch (err) {
    logger.error({ err }, "Twilio WhatsApp request errored");
    return { ok: false, reason: "network_error" };
  }
}
