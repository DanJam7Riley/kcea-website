import { Router } from "express";
import { createHmac, randomBytes } from "crypto";
import { db, captainProfilesTable, captainTokensTable, streetCaptainsTable, commitmentsTable, propertyNotesTable, streetHousesTable } from "@workspace/db";
import { eq, and, inArray, gt, desc } from "drizzle-orm";

const router = Router();
const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD ?? "kcea2026";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const SEEDED_CAPTAIN_NAMES = [
  "Carina", "Ingrid", "Priscilla", "Jo-Anne", "Geoff",
  "Maria D'Alves", "Kerstin", "Paul Arokiam", "Garren (Feroze assist)",
];

function hashPin(pin: string): string {
  const secret = process.env.SESSION_SECRET ?? "kcea-dev-secret";
  return createHmac("sha256", secret).update(pin).digest("hex");
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

async function getProfileFromToken(token: string) {
  if (!token) return null;
  const now = new Date();
  const rows = await db
    .select({ profile: captainProfilesTable })
    .from(captainTokensTable)
    .innerJoin(captainProfilesTable, eq(captainTokensTable.profileId, captainProfilesTable.id))
    .where(and(eq(captainTokensTable.token, token), gt(captainTokensTable.expiresAt, now)))
    .limit(1);
  return rows[0]?.profile ?? null;
}

async function getStreetsForCaptain(captainName: string): Promise<string[]> {
  const rows = await db
    .select({ street: streetCaptainsTable.street })
    .from(streetCaptainsTable)
    .where(eq(streetCaptainsTable.captain, captainName));
  return rows.map(r => r.street);
}

async function seedProfiles() {
  const existing = await db.select({ name: captainProfilesTable.name }).from(captainProfilesTable);
  const existingNames = new Set(existing.map(r => r.name));
  const toInsert = SEEDED_CAPTAIN_NAMES.filter(n => !existingNames.has(n));
  if (toInsert.length > 0) {
    await db.insert(captainProfilesTable).values(toInsert.map(name => ({ name })));
  }
}

// POST /api/captain/login
router.post("/captain/login", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone.trim()) : "";
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";

  if (!phone || !pin) {
    res.status(400).json({ error: "Phone and PIN are required" });
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 4 digits" });
    return;
  }

  try {
    const profiles = await db.select().from(captainProfilesTable);
    const profile = profiles.find(p => p.phone && normalizePhone(p.phone) === phone);

    if (!profile || !profile.pinHash) {
      res.status(401).json({ error: "Invalid phone number or PIN" });
      return;
    }
    if (profile.pinHash !== hashPin(pin)) {
      res.status(401).json({ error: "Invalid phone number or PIN" });
      return;
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await db.insert(captainTokensTable).values({ profileId: profile.id, token, expiresAt });
    await db.update(captainProfilesTable).set({ lastLoginAt: new Date() }).where(eq(captainProfilesTable.id, profile.id));

    res.json({ token, captainName: profile.name });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// GET /api/captain/dashboard
router.get("/captain/dashboard", async (req, res) => {
  const token = req.headers["x-captain-token"] as string;
  try {
    const profile = await getProfileFromToken(token);
    if (!profile) { res.status(401).json({ error: "Unauthorized" }); return; }

    const streets = await getStreetsForCaptain(profile.name);

    let committed: { id: number; fullName: string; street: string; houseNumber: string; commitmentType: string; paymentConfirmed: boolean }[] = [];
    let houses: { id: number; street: string; houseNumber: string }[] = [];
    let notes: { id: number; street: string; houseNumber: string; note: string; updatedAt: Date }[] = [];

    if (streets.length > 0) {
      committed = await db
        .select({
          id: commitmentsTable.id,
          fullName: commitmentsTable.fullName,
          street: commitmentsTable.street,
          houseNumber: commitmentsTable.houseNumber,
          commitmentType: commitmentsTable.commitmentType,
          paymentConfirmed: commitmentsTable.paymentConfirmed,
        })
        .from(commitmentsTable)
        .where(inArray(commitmentsTable.street, streets));

      houses = await db
        .select()
        .from(streetHousesTable)
        .where(inArray(streetHousesTable.street, streets));

      notes = await db
        .select({
          id: propertyNotesTable.id,
          street: propertyNotesTable.street,
          houseNumber: propertyNotesTable.houseNumber,
          note: propertyNotesTable.note,
          updatedAt: propertyNotesTable.updatedAt,
        })
        .from(propertyNotesTable)
        .where(inArray(propertyNotesTable.street, streets));
    }

    const committedKeys = new Set(committed.map(c => `${c.street}|${c.houseNumber}`));
    const notCommitted = houses.filter(h => !committedKeys.has(`${h.street}|${h.houseNumber}`));

    res.json({ captainName: profile.name, streets, committed, notCommitted, notes });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// POST /api/captain/notes
router.post("/captain/notes", async (req, res) => {
  const token = req.headers["x-captain-token"] as string;
  const body = req.body as Record<string, unknown>;
  try {
    const profile = await getProfileFromToken(token);
    if (!profile) { res.status(401).json({ error: "Unauthorized" }); return; }

    const street = typeof body.street === "string" ? body.street.trim() : "";
    const houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (!street || !houseNumber) {
      res.status(400).json({ error: "Street and house number are required" });
      return;
    }

    const streets = await getStreetsForCaptain(profile.name);
    if (!streets.includes(street)) { res.status(403).json({ error: "Access denied" }); return; }

    const [existing] = await db
      .select()
      .from(propertyNotesTable)
      .where(and(eq(propertyNotesTable.street, street), eq(propertyNotesTable.houseNumber, houseNumber)))
      .limit(1);

    if (note === "") {
      if (existing) await db.delete(propertyNotesTable).where(eq(propertyNotesTable.id, existing.id));
      res.json({ deleted: true });
    } else if (existing) {
      const [updated] = await db
        .update(propertyNotesTable)
        .set({ note, captainName: profile.name, profileId: profile.id, updatedAt: new Date() })
        .where(eq(propertyNotesTable.id, existing.id))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(propertyNotesTable)
        .values({ street, houseNumber, profileId: profile.id, captainName: profile.name, note })
        .returning();
      res.json(created);
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save note" });
  }
});

// POST /api/captain/houses
router.post("/captain/houses", async (req, res) => {
  const token = req.headers["x-captain-token"] as string;
  const body = req.body as Record<string, unknown>;
  try {
    const profile = await getProfileFromToken(token);
    if (!profile) { res.status(401).json({ error: "Unauthorized" }); return; }

    const street = typeof body.street === "string" ? body.street.trim() : "";
    const houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";

    if (!street || !houseNumber) {
      res.status(400).json({ error: "Street and house number required" });
      return;
    }

    const streets = await getStreetsForCaptain(profile.name);
    if (!streets.includes(street)) { res.status(403).json({ error: "Access denied" }); return; }

    const [existing] = await db
      .select()
      .from(streetHousesTable)
      .where(and(eq(streetHousesTable.street, street), eq(streetHousesTable.houseNumber, houseNumber)))
      .limit(1);

    if (existing) { res.json(existing); return; }

    const [created] = await db.insert(streetHousesTable).values({ street, houseNumber }).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to register house" });
  }
});

// DELETE /api/captain/session (logout)
router.delete("/captain/session", async (req, res) => {
  const token = req.headers["x-captain-token"] as string;
  if (token) {
    try { await db.delete(captainTokensTable).where(eq(captainTokensTable.token, token)); } catch {}
  }
  res.json({ success: true });
});

// --- ADMIN ROUTES ---

// GET /api/captain/management
router.get("/captain/management", async (req, res) => {
  const pw = req.headers["x-admin-password"] as string;
  if (!pw || pw !== ADMIN_PASSWORD()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    await seedProfiles();
    const profiles = await db.select().from(captainProfilesTable).orderBy(captainProfilesTable.name);
    res.json(profiles);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch profiles" });
  }
});

// POST /api/captain/management/profiles
router.post("/captain/management/profiles", async (req, res) => {
  const pw = req.headers["x-admin-password"] as string;
  if (!pw || pw !== ADMIN_PASSWORD()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone.trim()) : "";
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }
  try {
    const [created] = await db.insert(captainProfilesTable).values({ name, phone: phone || null }).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create profile" });
  }
});

// PUT /api/captain/management/:id
router.put("/captain/management/:id", async (req, res) => {
  const pw = req.headers["x-admin-password"] as string;
  if (!pw || pw !== ADMIN_PASSWORD()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.phone === "string") {
    const p = normalizePhone(body.phone.trim());
    patch.phone = p || null;
  }
  if (typeof body.pin === "string") {
    const pin = body.pin.trim();
    if (pin && !/^\d{4}$/.test(pin)) { res.status(400).json({ error: "PIN must be 4 digits" }); return; }
    patch.pin = pin || null;
    patch.pinHash = pin ? hashPin(pin) : null;
  }

  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  try {
    const [updated] = await db.update(captainProfilesTable).set(patch).where(eq(captainProfilesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// POST /api/captain/management/:id/set-pin  — generate (or set) PIN and notify captain via WhatsApp
router.post("/captain/management/:id/set-pin", async (req, res) => {
  const pw = req.headers["x-admin-password"] as string;
  if (!pw || pw !== ADMIN_PASSWORD()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = (req.body as Record<string, unknown> | undefined) ?? {};
  const providedPin = typeof body.pin === "string" && /^\d{4}$/.test(body.pin.trim()) ? body.pin.trim() : null;
  const pin = providedPin ?? String(Math.floor(1000 + Math.random() * 9000));

  try {
    const [updated] = await db
      .update(captainProfilesTable)
      .set({ pin, pinHash: hashPin(pin) })
      .where(eq(captainProfilesTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Not found" }); return; }

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to set PIN" });
  }
});

// DELETE /api/captain/management/:id
router.delete("/captain/management/:id", async (req, res) => {
  const pw = req.headers["x-admin-password"] as string;
  if (!pw || pw !== ADMIN_PASSWORD()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(captainTokensTable).where(eq(captainTokensTable.profileId, id));
    const [deleted] = await db.delete(captainProfilesTable).where(eq(captainProfilesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete profile" });
  }
});

// GET /api/captain/management/notes
router.get("/captain/management/notes", async (req, res) => {
  const pw = req.headers["x-admin-password"] as string;
  if (!pw || pw !== ADMIN_PASSWORD()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const notes = await db.select().from(propertyNotesTable).orderBy(desc(propertyNotesTable.updatedAt));
    res.json(notes);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

export default router;
