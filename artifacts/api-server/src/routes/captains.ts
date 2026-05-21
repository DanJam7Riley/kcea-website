import { Router } from "express";
import { db, streetCaptainsTable, captainProfilesTable, commitmentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

const DEFAULT_CAPTAINS = [
  { street: "Derby", captain: "Carina", forms: 27, status: "Strong" },
  { street: "Orion", captain: "Ingrid", forms: 18, status: "Good" },
  { street: "Protea", captain: "Priscilla", forms: 17, status: "Good" },
  { street: "Osprey", captain: "Jo-Anne", forms: 15, status: "Solid" },
  { street: "Ocean", captain: "Geoff", forms: 12, status: "In Progress" },
  { street: "Onyx", captain: "Maria D'Alves", forms: 12, status: "Good" },
  { street: "Westmoreland", captain: "Assigned", forms: 13, status: "Steady" },
  { street: "Nymphe", captain: "Maria D'Alves", forms: 9, status: "In Progress" },
  { street: "Nottingham", captain: "Kerstin", forms: 8, status: "In Progress" },
  { street: "Highlands", captain: "Assigned", forms: 10, status: "Good" },
  { street: "Panther", captain: "Paul Arokiam", forms: 6, status: "Re-engaged" },
  { street: "Mildura", captain: "Garren (Feroze assist)", forms: 0, status: "Critical" },
];

async function getOrSeedCaptains() {
  const rows = await db.select().from(streetCaptainsTable);
  if (rows.length > 0) return rows;
  const seeded = await db
    .insert(streetCaptainsTable)
    .values(DEFAULT_CAPTAINS.map(c => ({ ...c, captainStatus: "Active Captain" })))
    .returning();
  return seeded;
}

const adminPassword = () => process.env.ADMIN_PASSWORD ?? "kcea2026";
function isAdmin(req: import("express").Request) {
  return req.headers["x-admin-password"] === adminPassword();
}

router.get("/captains", async (req, res) => {
  try {
    const all = await getOrSeedCaptains();

    // Per-street committed counts (only the number — never PII) so the public homepage
    // can render real "X of Y households" progress for each street.
    const counts = await db
      .select({ street: commitmentsTable.street, n: sql<number>`count(*)::int` })
      .from(commitmentsTable)
      .groupBy(commitmentsTable.street);
    const committedByStreet = new Map<string, number>();
    for (const r of counts) committedByStreet.set(r.street, Number(r.n));
    const withCounts = all.map(c => ({ ...c, committedHouseholds: committedByStreet.get(c.street) ?? 0 }));

    if (isAdmin(req)) {
      // Enrich each captain with their PIN (from captain_profiles, matched by name) so the admin
      // welcome WhatsApp button can include it. PIN is only ever exposed to admin-authenticated requests.
      const profiles = await db
        .select({ name: captainProfilesTable.name, pin: captainProfilesTable.pin })
        .from(captainProfilesTable);
      const pinByName = new Map<string, string | null>();
      for (const p of profiles) pinByName.set(p.name.trim().toLowerCase(), p.pin);
      const enriched = withCounts.map(c => ({
        ...c,
        pin: pinByName.get(c.captain.trim().toLowerCase()) ?? null,
      }));
      res.json(enriched);
    } else {
      res.json(withCounts.filter(c => c.captainStatus === "Active Captain"));
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch captains" });
  }
});

router.post("/captains", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const street = typeof body.street === "string" ? body.street.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const motivation = typeof body.motivation === "string" ? body.motivation.trim() : undefined;

  if (!fullName || !street || !phone || !email) {
    res.status(400).json({ error: "Name, street, phone and email are required" });
    return;
  }

  try {
    await getOrSeedCaptains();
    const [created] = await db
      .insert(streetCaptainsTable)
      .values({
        street,
        captain: fullName,
        forms: 0,
        status: "In Progress",
        phone,
        email,
        motivation: motivation || null,
        captainStatus: "Pending / New Volunteer",
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save application" });
  }
});

// Admin-only: add a new street to the roster as Unassigned (target 20). Used when a resident
// submits a commitment for a street that isn't on the official list yet.
router.post("/captains/add-street", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const streetRaw = typeof body.street === "string" ? body.street.trim() : "";
  if (!streetRaw) {
    res.status(400).json({ error: "Street name is required" });
    return;
  }
  try {
    const existing = await db.select({ id: streetCaptainsTable.id, street: streetCaptainsTable.street }).from(streetCaptainsTable);
    const dup = existing.find(r => r.street.trim().toLowerCase() === streetRaw.toLowerCase());
    if (dup) {
      res.status(409).json({ error: "Street already on roster", id: dup.id });
      return;
    }
    const [created] = await db
      .insert(streetCaptainsTable)
      .values({
        street: streetRaw,
        captain: "Unassigned",
        forms: 0,
        status: "In Progress",
        targetHouseholds: 20,
        captainStatus: "Active Captain",
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to add street" });
  }
});

router.post("/captains/:id/welcomed", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [updated] = await db
      .update(streetCaptainsTable)
      .set({ welcomedAt: new Date() })
      .where(eq(streetCaptainsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Captain not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to mark welcomed" });
  }
});

router.put("/captains/:id", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const patch: { captain?: string; forms?: number; targetHouseholds?: number; status?: string; captainStatus?: string; phone?: string | null; email?: string | null } = {};

  if (typeof body.captain === "string" && body.captain.trim()) patch.captain = body.captain.trim();
  if (typeof body.forms === "number") patch.forms = Math.max(0, Math.floor(body.forms));
  if (typeof body.targetHouseholds === "number") patch.targetHouseholds = Math.max(0, Math.floor(body.targetHouseholds));
  if (typeof body.status === "string" && body.status.trim()) patch.status = body.status.trim();
  if (body.captainStatus === "Active Captain" || body.captainStatus === "Pending / New Volunteer") {
    patch.captainStatus = body.captainStatus;
  }
  if (typeof body.phone === "string") patch.phone = body.phone.trim() || null;
  if (typeof body.email === "string") patch.email = body.email.trim() || null;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  try {
    const [updated] = await db
      .update(streetCaptainsTable)
      .set(patch)
      .where(eq(streetCaptainsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Captain not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update captain" });
  }
});

router.delete("/captains/:id", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [deleted] = await db
      .delete(streetCaptainsTable)
      .where(eq(streetCaptainsTable.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Captain not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete captain" });
  }
});

export default router;
