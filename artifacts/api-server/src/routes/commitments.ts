import { Router } from "express";
import { db, commitmentsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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
      .values({ fullName, email, phone, street, houseNumber, commitmentType })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save commitment" });
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
