// Lightweight expense tracking — admin only. Not double-entry bookkeeping
// (no ledger/journal/trial balance) — just enough to answer "what have we
// spent and on what" alongside the resident-payment income already
// tracked. See schema/index.ts for the full reasoning.
import { Router } from "express";
import { db, expensesTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { isAdminReq } from "../lib/admin-auth";

const router = Router();

function adminUsername(req: { headers: Record<string, unknown> }): string {
  const v = req.headers["x-admin-username"];
  return typeof v === "string" && v ? v : "admin";
}

router.get("/expenses", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const rows = await db.select().from(expensesTable).orderBy(desc(expensesTable.expenseDate));
    const [totals] = await db.select({ total: sql<number>`coalesce(sum(${expensesTable.amount}), 0)::int` }).from(expensesTable);
    res.json({ expenses: rows, total: totals?.total ?? 0 });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

// Body: { expenseDate?, category, amount, description, reference? }
router.post("/expenses", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const amount = typeof body.amount === "number" && body.amount > 0 ? Math.round(body.amount) : null;
  if (!category || !description || !amount) {
    res.status(400).json({ error: "category, description, and a positive amount are required" });
    return;
  }
  const expenseDate = typeof body.expenseDate === "string" && body.expenseDate ? new Date(body.expenseDate) : new Date();
  const reference = typeof body.reference === "string" ? body.reference.trim() || null : null;

  try {
    const [created] = await db
      .insert(expensesTable)
      .values({
        expenseDate: isNaN(expenseDate.getTime()) ? new Date() : expenseDate,
        category,
        amount,
        description,
        reference,
        createdBy: adminUsername(req),
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to record expense" });
  }
});

router.delete("/expenses/:id", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [deleted] = await db.delete(expensesTable).where(eq(expensesTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

export default router;
