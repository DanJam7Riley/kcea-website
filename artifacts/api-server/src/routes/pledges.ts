import { Router } from "express";
import { db, pledgesTable, commitmentsTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";

const router = Router();

import { isAdminReq } from "../lib/admin-auth";

// PUBLIC: total pledged amount (sum only, no names or breakdowns).
router.get("/pledges/total", async (_req, res) => {
  try {
    const [row] = await db.select({ total: sql<number>`coalesce(sum(${pledgesTable.amount}), 0)::int` }).from(pledgesTable);
    res.json({ total: row?.total ?? 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch pledge total" });
  }
});

// PUBLIC: create a pledge.
router.post("/pledges", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const amountRaw = body.amount;
  const isResident = body.isResident === true || body.isResident === "true";
  const street = typeof body.street === "string" ? body.street.trim() : "";
  const houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  const amount = typeof amountRaw === "number"
    ? Math.floor(amountRaw)
    : typeof amountRaw === "string"
      ? parseInt(amountRaw.replace(/[^\d]/g, ""), 10)
      : NaN;

  if (!fullName || !phone || !email) {
    res.status(400).json({ error: "Name, phone and email are required" });
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Pledge amount must be a positive number" });
    return;
  }
  if (isResident && (!street || !houseNumber)) {
    res.status(400).json({ error: "Resident pledges require street and house number" });
    return;
  }

  try {
    let commitmentId: number | null = null;
    if (isResident) {
      const [match] = await db
        .select({ id: commitmentsTable.id })
        .from(commitmentsTable)
        .where(and(
          sql`lower(${commitmentsTable.fullName}) = lower(${fullName})`,
          sql`lower(${commitmentsTable.street}) = lower(${street})`,
          sql`lower(${commitmentsTable.houseNumber}) = lower(${houseNumber})`,
        ))
        .limit(1);
      if (match) commitmentId = match.id;
    }

    const [created] = await db.insert(pledgesTable).values({
      fullName,
      phone,
      email,
      amount,
      isResident,
      street: isResident ? street : null,
      houseNumber: isResident ? houseNumber : null,
      message: message || null,
      commitmentId,
    }).returning();

    req.log.info({ pledgeId: created.id, amount, isResident, linkedCommitmentId: commitmentId }, "New pledge received");
    res.status(201).json({ id: created.id, linkedCommitmentId: commitmentId });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save pledge" });
  }
});

// ADMIN: list all pledges.
router.get("/pledges", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const rows = await db.select().from(pledgesTable).orderBy(desc(pledgesTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch pledges" });
  }
});

// ADMIN: delete a pledge.
router.delete("/pledges/:id", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [deleted] = await db.delete(pledgesTable).where(eq(pledgesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete pledge" });
  }
});

export default router;
