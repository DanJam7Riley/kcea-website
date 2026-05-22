import { Router } from "express";
import { db, commitmentsTable, streetCaptainsTable, siteSettingsTable } from "@workspace/db";
import { or, isNull, eq, sql, and } from "drizzle-orm";
import { getOrCreateSettings } from "../lib/settings";

const router = Router();
import { isAdminReq } from "../lib/admin-auth";

const CAPTAIN_UPDATES: Array<{ street: string; captain: string; phone?: string; email?: string }> = [
  { street: "Nile", captain: "Janine Riley", phone: "0832355052", email: "janine.riley@me.com" },
  { street: "Onyx", captain: "Maria D'Alves / Irene Goodwin" },
  { street: "Panther", captain: "Paul Arokiam / Jason van Wyngaard" },
  { street: "Orion", captain: "Ingrid Bester" },
  { street: "Mildura", captain: "Garren Pillay" },
];

router.post("/admin/migrate", async (req, res) => {
  if (!isAdminReq(req.headers)) {
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

    // Split any "A / B" combined captain names into separate rows.
    // Idempotent: if a single-name row already exists for the split-out name on the same street, skip insert.
    // Jason van Wyngaard should be Active Captain; other splits inherit the original row's captainStatus.
    const ACTIVE_SPLIT_NAMES = new Set(["Jason van Wyngaard"]);
    const allCaptains = await db
      .select()
      .from(streetCaptainsTable);
    const splitResults: Array<{ street: string; names: string[] }> = [];
    for (const row of allCaptains) {
      if (!row.captain.includes(" / ")) continue;
      const names = row.captain.split(" / ").map(n => n.trim()).filter(Boolean);
      if (names.length < 2) continue;
      const [first, ...rest] = names;
      if (!first) continue;
      // Update existing row to only the first name.
      await db
        .update(streetCaptainsTable)
        .set({ captain: first })
        .where(eq(streetCaptainsTable.id, row.id));
      // Insert remaining names as new rows on the same street, unless a row already exists.
      const insertedNames: string[] = [first];
      for (const name of rest) {
        const exists = allCaptains.some(
          r => r.street === row.street && r.captain === name && r.id !== row.id,
        );
        if (exists) continue;
        await db.insert(streetCaptainsTable).values({
          street: row.street,
          captain: name,
          forms: row.forms,
          status: row.status,
          phone: null,
          email: null,
          motivation: row.motivation ?? null,
          captainStatus: ACTIVE_SPLIT_NAMES.has(name) ? "Active Captain" : row.captainStatus,
        });
        insertedNames.push(name);
      }
      splitResults.push({ street: row.street, names: insertedNames });
    }

    // Ensure Jason van Wyngaard (Panther) is Active Captain — covers the case where row was already split previously.
    await db
      .update(streetCaptainsTable)
      .set({ captainStatus: "Active Captain" })
      .where(
        and(
          eq(streetCaptainsTable.street, "Panther"),
          eq(streetCaptainsTable.captain, "Jason van Wyngaard"),
        ),
      );

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
      splits: splitResults,
      earlsCourtAdded,
      settings: { notifyWhatsappInitialized: settingsUpdated },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Migration failed" });
  }
});

export default router;
