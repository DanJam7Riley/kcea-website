import { Router } from "express";
import { db, commitmentsTable, streetCaptainsTable, siteSettingsTable } from "@workspace/db";
import { or, isNull, eq, sql } from "drizzle-orm";
import { getOrCreateSettings } from "../lib/settings";

const router = Router();
const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD ?? "kcea2026";

const CAPTAIN_UPDATES: Array<{ street: string; captain: string; phone?: string; email?: string }> = [
  { street: "Nile", captain: "Janine Riley", phone: "0832355052", email: "janine.riley@me.com" },
  { street: "Onyx", captain: "Maria D'Alves / Irene Goodwin" },
  { street: "Panther", captain: "Paul Arokiam / Jason van Wyngaard" },
  { street: "Orion", captain: "Ingrid Bester" },
  { street: "Mildura", captain: "Garren Pillay" },
];

router.post("/admin/migrate", async (req, res) => {
  const pw = req.headers["x-admin-password"] as string;
  if (!pw || pw !== ADMIN_PASSWORD()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const before = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(commitmentsTable);
    const beforeCount = before[0]?.n ?? 0;

    const deleted = await db
      .delete(commitmentsTable)
      .where(
        or(
          eq(commitmentsTable.fullName, "Imported"),
          isNull(commitmentsTable.fullName),
          eq(commitmentsTable.fullName, ""),
          eq(commitmentsTable.email, "Unknown"),
          eq(commitmentsTable.phone, "Unknown"),
        ),
      )
      .returning({ id: commitmentsTable.id });

    const after = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(commitmentsTable);
    const afterCount = after[0]?.n ?? 0;

    const captainResults: Array<{ street: string; updated: boolean }> = [];
    for (const c of CAPTAIN_UPDATES) {
      const patch: Record<string, unknown> = { captain: c.captain };
      if (c.phone !== undefined) patch.phone = c.phone;
      if (c.email !== undefined) patch.email = c.email;
      const updated = await db
        .update(streetCaptainsTable)
        .set(patch)
        .where(eq(streetCaptainsTable.street, c.street))
        .returning({ id: streetCaptainsTable.id });
      captainResults.push({ street: c.street, updated: updated.length > 0 });
    }

    // Ensure "Earls Court" exists as its own row (complex on Nile St, Kensington).
    const existingEarls = await db
      .select({ id: streetCaptainsTable.id })
      .from(streetCaptainsTable)
      .where(eq(streetCaptainsTable.street, "Earls Court"));
    let earlsCourtAdded = false;
    if (existingEarls.length === 0) {
      await db.insert(streetCaptainsTable).values({
        street: "Earls Court",
        captain: "Unassigned",
        forms: 0,
        status: "Critical",
        captainStatus: "Active Captain",
      });
      earlsCourtAdded = true;
    }

    const settings = await getOrCreateSettings();
    let settingsUpdated = false;
    if (!settings.notifyWhatsapp || settings.notifyWhatsapp.trim() === "") {
      await db
        .update(siteSettingsTable)
        .set({ notifyWhatsapp: "0832355052", updatedAt: new Date() })
        .where(eq(siteSettingsTable.id, settings.id));
      settingsUpdated = true;
    }

    res.json({
      ok: true,
      commitments: {
        before: beforeCount,
        deleted: deleted.length,
        after: afterCount,
      },
      captains: captainResults,
      earlsCourtAdded,
      settings: { notifyWhatsappInitialized: settingsUpdated },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Migration failed" });
  }
});

export default router;
