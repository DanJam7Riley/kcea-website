import { Router } from "express";
import {
  db,
  captainAssignmentsTable,
  commitmentsTable,
  streetCaptainsTable,
  captainProfilesTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { isAdminReq } from "../lib/admin-auth";

const router = Router();

function isAdmin(req: import("express").Request) {
  return isAdminReq(req.headers);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

function normaliseStreet(raw: string): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Ensure a street_captains row exists for `street` owned by `captainName`, so the
// captain portal (which matches streets by captain name) shows it. This NEVER
// overwrites a different real captain's row — the system supports co-captains, so
// when another captain already holds the street we add a separate row instead.
// Resolution order: (1) refresh our own row, (2) take over an "Unassigned"
// placeholder, (3) otherwise insert a (co-)captain row.
async function syncStreetCaptain(
  street: string,
  captainName: string,
  phone: string | null,
  email: string | null,
) {
  const existing = await db
    .select()
    .from(streetCaptainsTable)
    .where(sql`lower(${streetCaptainsTable.street}) = ${street.toLowerCase()}`);

  const own = existing.find(r => r.captain.trim().toLowerCase() === captainName.trim().toLowerCase());
  if (own) {
    await db
      .update(streetCaptainsTable)
      .set({
        captainStatus: "Active Captain",
        phone: phone ?? own.phone,
        email: email ?? own.email,
      })
      .where(eq(streetCaptainsTable.id, own.id));
    return;
  }

  const placeholder = existing.find(r => r.captain.trim().toLowerCase() === "unassigned");
  if (placeholder) {
    await db
      .update(streetCaptainsTable)
      .set({
        captain: captainName,
        captainStatus: "Active Captain",
        phone: phone ?? placeholder.phone,
        email: email ?? placeholder.email,
      })
      .where(eq(streetCaptainsTable.id, placeholder.id));
    return;
  }

  await db.insert(streetCaptainsTable).values({
    street,
    captain: captainName,
    forms: 0,
    status: "In Progress",
    phone,
    email,
    captainStatus: "Active Captain",
  });
}

// When a captain no longer covers a street, release their street_captains row.
// If co-captains remain on the street, just remove this captain's row (so we don't
// leave a stray "Unassigned" row beside an active captain). If they were the sole
// captain, revert the row to "Unassigned" to keep the street on the roster.
async function unassignStreetCaptain(street: string, captainName: string) {
  const rows = await db
    .select()
    .from(streetCaptainsTable)
    .where(sql`lower(${streetCaptainsTable.street}) = ${street.toLowerCase()}`);
  const mine = rows.filter(r => r.captain.trim().toLowerCase() === captainName.trim().toLowerCase());
  const otherCaptains = rows.filter(
    r =>
      r.captain.trim().toLowerCase() !== captainName.trim().toLowerCase() &&
      r.captain.trim().toLowerCase() !== "unassigned",
  );
  for (const r of mine) {
    if (otherCaptains.length > 0) {
      await db.delete(streetCaptainsTable).where(eq(streetCaptainsTable.id, r.id));
    } else {
      await db.update(streetCaptainsTable).set({ captain: "Unassigned" }).where(eq(streetCaptainsTable.id, r.id));
    }
  }
}

// Ensure a captain_profiles row exists for this captain (so PIN/portal login works),
// keeping the phone in sync. Never touches the PIN.
async function syncCaptainProfile(captainName: string, phone: string | null) {
  const profiles = await db.select().from(captainProfilesTable);
  const match = profiles.find(p => p.name.trim().toLowerCase() === captainName.trim().toLowerCase());
  if (match) {
    if (phone && normalizePhone(phone) !== normalizePhone(match.phone ?? "")) {
      await db.update(captainProfilesTable).set({ phone }).where(eq(captainProfilesTable.id, match.id));
    }
  } else {
    await db.insert(captainProfilesTable).values({ name: captainName, phone: phone ?? null });
  }
}

// GET /api/captain-assignments — one entry per resident with active assignments.
router.get("/captain-assignments", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const rows = await db
      .select({
        assignmentId: captainAssignmentsTable.id,
        residentId: captainAssignmentsTable.residentId,
        streetName: captainAssignmentsTable.streetName,
        assignedAt: captainAssignmentsTable.assignedAt,
        fullName: commitmentsTable.fullName,
        phone: commitmentsTable.phone,
        email: commitmentsTable.email,
      })
      .from(captainAssignmentsTable)
      .innerJoin(commitmentsTable, eq(captainAssignmentsTable.residentId, commitmentsTable.id))
      .where(eq(captainAssignmentsTable.isActive, true));

    const profiles = await db
      .select({ name: captainProfilesTable.name, pin: captainProfilesTable.pin })
      .from(captainProfilesTable);
    const pinByName = new Map<string, string | null>();
    for (const p of profiles) pinByName.set(p.name.trim().toLowerCase(), p.pin);

    // Group by resident.
    const byResident = new Map<
      number,
      {
        residentId: number;
        fullName: string;
        phone: string;
        email: string;
        streets: string[];
        assignmentIds: number[];
        pinSet: boolean;
      }
    >();
    for (const r of rows) {
      let entry = byResident.get(r.residentId);
      if (!entry) {
        entry = {
          residentId: r.residentId,
          fullName: r.fullName,
          phone: r.phone,
          email: r.email,
          streets: [],
          assignmentIds: [],
          pinSet: !!pinByName.get(r.fullName.trim().toLowerCase()),
        };
        byResident.set(r.residentId, entry);
      }
      entry.streets.push(r.streetName);
      entry.assignmentIds.push(r.assignmentId);
    }

    const result = Array.from(byResident.values())
      .map(e => ({ ...e, streets: e.streets.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })) }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }));

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch captain assignments" });
  }
});

// POST /api/captain-assignments — assign a resident to one or more streets.
// Body: { residentId: number, streets: string[], phone?: string }
router.post("/captain-assignments", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const residentId = typeof body.residentId === "number" ? body.residentId : parseInt(String(body.residentId), 10);
  const streetsRaw = Array.isArray(body.streets) ? body.streets : [];
  const phoneOverride = typeof body.phone === "string" ? body.phone.trim() : "";

  if (!Number.isFinite(residentId)) {
    res.status(400).json({ error: "residentId is required" });
    return;
  }
  const streets = Array.from(
    new Set(streetsRaw.filter((s): s is string => typeof s === "string" && s.trim() !== "").map(s => normaliseStreet(s))),
  );
  if (streets.length === 0) {
    res.status(400).json({ error: "At least one street is required" });
    return;
  }

  try {
    const [resident] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, residentId)).limit(1);
    if (!resident) {
      res.status(404).json({ error: "Resident not found" });
      return;
    }
    const phone = phoneOverride || resident.phone || null;
    const email = resident.email || null;

    // Update the resident's phone on their commitment record if an override was supplied.
    if (phoneOverride && phoneOverride !== resident.phone) {
      await db.update(commitmentsTable).set({ phone: phoneOverride }).where(eq(commitmentsTable.id, residentId));
    }

    const existingActive = await db
      .select()
      .from(captainAssignmentsTable)
      .where(and(eq(captainAssignmentsTable.residentId, residentId), eq(captainAssignmentsTable.isActive, true)));
    const existingStreets = new Set(existingActive.map(a => a.streetName.trim().toLowerCase()));

    for (const street of streets) {
      if (!existingStreets.has(street.toLowerCase())) {
        // Reactivate a prior soft-deleted row for this street if present, else insert.
        const [prior] = await db
          .select()
          .from(captainAssignmentsTable)
          .where(
            and(
              eq(captainAssignmentsTable.residentId, residentId),
              sql`lower(${captainAssignmentsTable.streetName}) = ${street.toLowerCase()}`,
            ),
          )
          .limit(1);
        if (prior) {
          await db
            .update(captainAssignmentsTable)
            .set({ isActive: true, streetName: street, assignedAt: new Date() })
            .where(eq(captainAssignmentsTable.id, prior.id));
        } else {
          await db.insert(captainAssignmentsTable).values({ residentId, streetName: street, isActive: true });
        }
      }
      await syncStreetCaptain(street, resident.fullName, phone, email);
    }

    await syncCaptainProfile(resident.fullName, phone);

    res.status(201).json({ success: true, residentId, streets });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to assign captain" });
  }
});

// PUT /api/captain-assignments/:residentId — update streets / phone for a resident.
// Body: { streets: string[], phone?: string }
router.put("/captain-assignments/:residentId", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const residentId = parseInt(req.params.residentId, 10);
  if (isNaN(residentId)) {
    res.status(400).json({ error: "Invalid residentId" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const streetsRaw = Array.isArray(body.streets) ? body.streets : [];
  const phoneOverride = typeof body.phone === "string" ? body.phone.trim() : "";
  const desiredStreets = Array.from(
    new Set(streetsRaw.filter((s): s is string => typeof s === "string" && s.trim() !== "").map(s => normaliseStreet(s))),
  );
  if (desiredStreets.length === 0) {
    res.status(400).json({ error: "At least one street is required (use Remove to deactivate all)" });
    return;
  }

  try {
    const [resident] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, residentId)).limit(1);
    if (!resident) {
      res.status(404).json({ error: "Resident not found" });
      return;
    }

    if (phoneOverride && phoneOverride !== resident.phone) {
      await db.update(commitmentsTable).set({ phone: phoneOverride }).where(eq(commitmentsTable.id, residentId));
    }
    const phone = phoneOverride || resident.phone || null;
    const email = resident.email || null;

    const existingActive = await db
      .select()
      .from(captainAssignmentsTable)
      .where(and(eq(captainAssignmentsTable.residentId, residentId), eq(captainAssignmentsTable.isActive, true)));
    const desiredLower = new Set(desiredStreets.map(s => s.toLowerCase()));
    const existingLower = new Set(existingActive.map(a => a.streetName.trim().toLowerCase()));

    // Deactivate assignments for streets no longer desired.
    for (const a of existingActive) {
      if (!desiredLower.has(a.streetName.trim().toLowerCase())) {
        await db.update(captainAssignmentsTable).set({ isActive: false }).where(eq(captainAssignmentsTable.id, a.id));
        await unassignStreetCaptain(a.streetName, resident.fullName);
      }
    }

    // Add (or reactivate) assignments for newly desired streets.
    for (const street of desiredStreets) {
      if (!existingLower.has(street.toLowerCase())) {
        const [prior] = await db
          .select()
          .from(captainAssignmentsTable)
          .where(
            and(
              eq(captainAssignmentsTable.residentId, residentId),
              sql`lower(${captainAssignmentsTable.streetName}) = ${street.toLowerCase()}`,
            ),
          )
          .limit(1);
        if (prior) {
          await db
            .update(captainAssignmentsTable)
            .set({ isActive: true, streetName: street, assignedAt: new Date() })
            .where(eq(captainAssignmentsTable.id, prior.id));
        } else {
          await db.insert(captainAssignmentsTable).values({ residentId, streetName: street, isActive: true });
        }
      }
      await syncStreetCaptain(street, resident.fullName, phone, email);
    }

    await syncCaptainProfile(resident.fullName, phone);

    res.json({ success: true, residentId, streets: desiredStreets });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update assignment" });
  }
});

// DELETE /api/captain-assignments/:residentId — soft-delete ALL of a resident's
// active assignments (is_active=false) and release their streets back to Unassigned.
router.delete("/captain-assignments/:residentId", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const residentId = parseInt(req.params.residentId, 10);
  if (isNaN(residentId)) {
    res.status(400).json({ error: "Invalid residentId" });
    return;
  }
  try {
    const [resident] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, residentId)).limit(1);
    const active = await db
      .select()
      .from(captainAssignmentsTable)
      .where(and(eq(captainAssignmentsTable.residentId, residentId), eq(captainAssignmentsTable.isActive, true)));
    if (active.length === 0) {
      res.status(404).json({ error: "No active assignments for this resident" });
      return;
    }
    await db
      .update(captainAssignmentsTable)
      .set({ isActive: false })
      .where(and(eq(captainAssignmentsTable.residentId, residentId), eq(captainAssignmentsTable.isActive, true)));

    if (resident) {
      for (const a of active) {
        await unassignStreetCaptain(a.streetName, resident.fullName);
      }
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to remove assignment" });
  }
});

export default router;
