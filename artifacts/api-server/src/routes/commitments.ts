import { Router } from "express";
import { db, commitmentsTable, captainProfilesTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";

const router = Router();

const isMissingPhone = (p: string | null | undefined) => !p || p.trim() === "" || p.trim() === "-";
const isMissingEmail = (e: string | null | undefined) => !e || e.trim() === "" || e.toLowerCase() === "imported@kcea.local";
const isMissingName = (n: string | null | undefined) => !n || n.trim() === "";

function missingForCommitment(r: { fullName: string; email: string; phone: string }): string[] {
  const m: string[] = [];
  if (isMissingName(r.fullName)) m.push("Name");
  if (isMissingPhone(r.phone)) m.push("Phone");
  if (isMissingEmail(r.email)) m.push("Email");
  return m;
}

/** Per-record HMAC token so the public /update link cannot be enumerated by guessing IDs. */
function makeUpdateToken(id: number): string {
  const secret = process.env.SESSION_SECRET ?? "kcea-fallback-secret";
  return createHmac("sha256", secret).update(`commitment:${id}`).digest("hex").slice(0, 24);
}
function verifyUpdateToken(id: number, token: string | undefined): boolean {
  if (!token) return false;
  const expected = makeUpdateToken(id);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

router.post("/commitments", async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const street = typeof body.street === "string" ? body.street.trim() : "";
  const houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";
  const commitmentType = typeof body.commitmentType === "string" ? body.commitmentType.trim() : "";

  if (!fullName || !email || !phone || !street || !houseNumber || !commitmentType) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }

  try {
    const [created] = await db
      .insert(commitmentsTable)
      .values({ fullName, email, phone, street, houseNumber, commitmentType, imported: false, paymentConfirmed: false })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save commitment" });
  }
});

// Public lookup — returns status only, no personal details
router.get("/commitments/lookup", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }

  try {
    // Search by name (partial, case-insensitive)
    const rows = await db
      .select({
        fullName: commitmentsTable.fullName,
        email: commitmentsTable.email,
        phone: commitmentsTable.phone,
        street: commitmentsTable.street,
        houseNumber: commitmentsTable.houseNumber,
        paymentConfirmed: commitmentsTable.paymentConfirmed,
      })
      .from(commitmentsTable)
      .where(sql`lower(${commitmentsTable.fullName}) like ${"%" + q.toLowerCase() + "%"}`)
      .limit(10);

    if (rows.length === 0) {
      res.json({ found: false });
      return;
    }

    const isIncomplete = (r: typeof rows[0]) => {
      const badPhone = !r.phone || r.phone.trim() === "" || r.phone.trim() === "-";
      const badEmail = !r.email || r.email.trim() === "" || r.email.toLowerCase() === "imported@kcea.local";
      const badName = !r.fullName || r.fullName.trim() === "";
      return badPhone || badEmail || badName;
    };

    const records = rows.map(r => ({
      name: r.fullName,
      street: r.street,
      houseNumber: r.houseNumber,
      paymentConfirmed: r.paymentConfirmed,
      incomplete: isIncomplete(r),
    }));
    const confirmed = records.some(r => r.paymentConfirmed);
    const incomplete = records.some(r => r.incomplete);
    res.json({
      found: true,
      paymentConfirmed: confirmed,
      incomplete,
      count: rows.length,
      names: rows.map(r => `${r.fullName} — ${r.street} No. ${r.houseNumber}`),
      records,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

router.get("/commitments/incomplete", async (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const rows = await db.select().from(commitmentsTable).orderBy(desc(commitmentsTable.submittedAt));
    const commitments = rows
      .map(r => ({
        ...r,
        kind: "commitment" as const,
        missingFields: missingForCommitment(r),
        updateToken: makeUpdateToken(r.id),
      }))
      .filter(r => r.missingFields.length > 0);

    const profiles = await db.select().from(captainProfilesTable);
    const incompleteProfiles = profiles
      .filter(p => isMissingPhone(p.phone))
      .map(p => ({
        id: p.id,
        kind: "profile" as const,
        fullName: p.name,
        email: null as string | null,
        phone: p.phone,
        street: "",
        houseNumber: "",
        commitmentType: "",
        submittedAt: new Date().toISOString(),
        missingFields: ["Phone"],
      }));

    res.json([...commitments, ...incompleteProfiles]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch incomplete records" });
  }
});

// PUBLIC: fetch a commitment by id+token so the resident can see what's missing and pre-fill the form.
// Requires a valid HMAC token (issued by admin link); rejects complete records to limit data exposure.
router.get("/commitments/:id/public", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = typeof req.query.t === "string" ? req.query.t : undefined;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!verifyUpdateToken(id, token)) { res.status(403).json({ error: "Invalid or missing token" }); return; }
  try {
    const [row] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const missing = missingForCommitment(row);
    if (missing.length === 0) {
      res.status(404).json({ error: "Record is already complete — no update needed" });
      return;
    }
    res.json({
      id: row.id,
      complete: false,
      missing,
      fullName: isMissingName(row.fullName) ? "" : row.fullName,
      email: isMissingEmail(row.email) ? "" : row.email,
      phone: isMissingPhone(row.phone) ? "" : row.phone,
      street: row.street,
      houseNumber: row.houseNumber,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch record" });
  }
});

// PUBLIC: resident self-update — token-gated, only fills fields that were originally missing.
router.put("/commitments/:id/self-update", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = typeof req.query.t === "string" ? req.query.t : (typeof (req.body as Record<string, unknown>)?.t === "string" ? (req.body as Record<string, string>).t : undefined);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!verifyUpdateToken(id, token)) { res.status(403).json({ error: "Invalid or missing token" }); return; }
  try {
    const [row] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const missing = missingForCommitment(row);
    if (missing.length === 0) { res.status(400).json({ error: "Record is already complete" }); return; }

    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (missing.includes("Name") && typeof body.fullName === "string" && body.fullName.trim()) {
      patch.fullName = body.fullName.trim();
    }
    if (missing.includes("Phone") && typeof body.phone === "string" && body.phone.trim()) {
      patch.phone = body.phone.trim();
    }
    if (missing.includes("Email") && typeof body.email === "string" && body.email.trim()) {
      patch.email = body.email.trim();
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Please fill in at least one of the missing fields" });
      return;
    }
    const [updated] = await db.update(commitmentsTable).set(patch).where(eq(commitmentsTable.id, id)).returning();
    res.json({ id: updated?.id, updated: Object.keys(patch), stillMissing: missingForCommitment(updated!) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update record" });
  }
});

router.post("/commitments/import", async (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const rows = body.rows;
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: "rows must be an array" });
    return;
  }

  let added = 0;
  let skipped = 0;

  try {
    const existing = await db
      .select({ fullName: commitmentsTable.fullName, street: commitmentsTable.street, houseNumber: commitmentsTable.houseNumber })
      .from(commitmentsTable);

    const existingKeys = new Set(
      existing.map(r => `${r.fullName.toLowerCase()}|${r.street.toLowerCase()}|${r.houseNumber.toLowerCase()}`)
    );

    for (const row of rows) {
      if (typeof row !== "object" || row === null) { skipped++; continue; }
      const r = row as Record<string, unknown>;

      const fullName = typeof r.fullName === "string" ? r.fullName.trim() : "";
      const street = typeof r.street === "string" ? r.street.trim() : "";
      const houseNumber = typeof r.houseNumber === "string" ? r.houseNumber.trim() : "";
      const email = typeof r.email === "string" ? r.email.trim() : "";
      const phone = typeof r.phone === "string" ? r.phone.trim() : "";
      const commitmentType = typeof r.commitmentType === "string" ? r.commitmentType.trim() : "monthly";
      const submittedAt = typeof r.submittedAt === "string" && r.submittedAt ? new Date(r.submittedAt) : new Date();

      if (!fullName || !street || !houseNumber) { skipped++; continue; }

      const key = `${fullName.toLowerCase()}|${street.toLowerCase()}|${houseNumber.toLowerCase()}`;
      if (existingKeys.has(key)) { skipped++; continue; }

      await db.insert(commitmentsTable).values({
        fullName,
        email: email || "imported@kcea.local",
        phone: phone || "-",
        street,
        houseNumber,
        commitmentType: commitmentType === "once-off" || commitmentType === "onceoff" ? "onceoff" : "monthly",
        imported: true,
        paymentConfirmed: false,
        submittedAt: isNaN(submittedAt.getTime()) ? new Date() : submittedAt,
      });

      existingKeys.add(key);
      added++;
    }

    res.json({ added, skipped });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Import failed" });
  }
});

router.get("/commitments", async (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(commitmentsTable)
      .orderBy(desc(commitmentsTable.submittedAt));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch commitments" });
  }
});

// Toggle payment confirmed — admin only
router.put("/commitments/:id/confirm", async (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const paymentConfirmed = typeof body.paymentConfirmed === "boolean" ? body.paymentConfirmed : true;

  try {
    const [updated] = await db
      .update(commitmentsTable)
      .set({ paymentConfirmed })
      .where(eq(commitmentsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update" });
  }
});

router.delete("/commitments/:id", async (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
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
      .delete(commitmentsTable)
      .where(eq(commitmentsTable.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Commitment not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete commitment" });
  }
});

export default router;
