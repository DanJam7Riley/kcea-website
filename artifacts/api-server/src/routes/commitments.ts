import { Router } from "express";
import { db, commitmentsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

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
    // Search by name (partial, case-insensitive) OR street + house combination
    const rows = await db
      .select({
        fullName: commitmentsTable.fullName,
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

    // Return the best match — payment confirmed if any match has it
    const confirmed = rows.some(r => r.paymentConfirmed);
    res.json({
      found: true,
      paymentConfirmed: confirmed,
      count: rows.length,
      names: rows.map(r => `${r.fullName} — ${r.street} No. ${r.houseNumber}`),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Lookup failed" });
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
