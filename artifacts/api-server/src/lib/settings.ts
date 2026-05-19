import { db, siteSettingsTable } from "@workspace/db";

export function normalizeSAPhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `+27${digits.slice(1)}`;
  if (digits.startsWith("27") && digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

export async function getNotifyNumber(): Promise<string | null> {
  try {
    const rows = await db
      .select({ notifyWhatsapp: siteSettingsTable.notifyWhatsapp })
      .from(siteSettingsTable)
      .limit(1);
    const raw = rows[0]?.notifyWhatsapp ?? process.env.NOTIFY_WHATSAPP_NUMBER ?? null;
    if (!raw) return null;
    return normalizeSAPhone(raw);
  } catch {
    const raw = process.env.NOTIFY_WHATSAPP_NUMBER ?? null;
    if (!raw) return null;
    return normalizeSAPhone(raw);
  }
}

export async function getOrCreateSettings() {
  const rows = await db.select().from(siteSettingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(siteSettingsTable).values({}).returning();
  return created;
}

export async function getTwilioCredentials(): Promise<{ accountSid: string | null; authToken: string | null; from: string }> {
  try {
    const rows = await db
      .select({
        twilioAccountSid: siteSettingsTable.twilioAccountSid,
        twilioAuthToken: siteSettingsTable.twilioAuthToken,
        twilioWhatsappFrom: siteSettingsTable.twilioWhatsappFrom,
      })
      .from(siteSettingsTable)
      .limit(1);
    const row = rows[0];
    if (row) {
      return {
        accountSid: row.twilioAccountSid ?? process.env.TWILIO_ACCOUNT_SID ?? null,
        authToken: row.twilioAuthToken ?? process.env.TWILIO_AUTH_TOKEN ?? null,
        from: row.twilioWhatsappFrom ?? process.env.TWILIO_WHATSAPP_FROM ?? "+14155238886",
      };
    }
  } catch {}
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? null,
    authToken: process.env.TWILIO_AUTH_TOKEN ?? null,
    from: process.env.TWILIO_WHATSAPP_FROM ?? "+14155238886",
  };
}
