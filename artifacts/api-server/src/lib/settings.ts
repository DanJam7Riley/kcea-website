import { db, siteSettingsTable } from "@workspace/db";

export async function getOrCreateSettings() {
  const rows = await db.select().from(siteSettingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(siteSettingsTable).values({}).returning();
  return created;
}

export async function getNotifyNumber(): Promise<string | undefined> {
  try {
    const rows = await db
      .select({ notifyWhatsapp: siteSettingsTable.notifyWhatsapp })
      .from(siteSettingsTable)
      .limit(1);
    const fromDb = rows[0]?.notifyWhatsapp;
    if (fromDb) return fromDb;
  } catch {}
  return process.env.NOTIFY_WHATSAPP_NUMBER ?? undefined;
}
