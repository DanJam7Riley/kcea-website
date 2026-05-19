import { db, siteSettingsTable } from "@workspace/db";

export async function getOrCreateSettings() {
  const rows = await db.select().from(siteSettingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(siteSettingsTable).values({}).returning();
  return created;
}
