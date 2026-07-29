import { Router } from "express";
import { db, invoicesTable, invoiceLineItemsTable, commitmentsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { isAdminReq, adminRoleFromHeaders, PRIMARY_USERNAME, SECONDARY_USERNAME } from "../lib/admin-auth";

const router = Router();

// Digital sign-off: record which admin login created/actioned the invoice.
// No physical signature field — matches KCEA's own instruction that this is a
// digital-only process for now.
function createdByFromReq(headers: Record<string, unknown>): string {
  const role = adminRoleFromHeaders(headers as Parameters<typeof adminRoleFromHeaders>[0]);
  if (role === "primary") return PRIMARY_USERNAME;
  if (role === "secondary") return SECONDARY_USERNAME;
  return "admin";
}

// KCEA-{year}-{3-digit sequence, per year}. Sequence gap/race risk is acceptable
// for a single-admin manual tool — if it ever collides, the unique constraint on
// invoice_number will reject the insert and the caller can retry.
async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `KCEA-${year}-`;
  const rows = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber })
    .from(invoicesTable)
    .where(sql`${invoicesTable.invoiceNumber} LIKE ${prefix + "%"}`);
  let maxSeq = 0;
  for (const r of rows) {
    const m = /-(\d{3,})$/.exec(r.invoiceNumber);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

interface LineItemInput {
  description: string;
  quantity?: number;
  unitAmount: number;
}

// List + search — admin only. Optional ?q= matches name/street/invoice number, ?status= filters.
router.get("/invoices", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";

    let rows = await db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt));

    if (status) rows = rows.filter(r => r.status === status);
    if (q) {
      rows = rows.filter(
        r =>
          r.invoiceNumber.toLowerCase().includes(q) ||
          r.billToName.toLowerCase().includes(q) ||
          (r.billToStreet ?? "").toLowerCase().includes(q) ||
          (r.billToHouseNumber ?? "").toLowerCase().includes(q),
      );
    }
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// Single invoice + its line items — admin only.
router.get("/invoices/:id", async (req, res) => {
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
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!invoice) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const lineItems = await db
      .select()
      .from(invoiceLineItemsTable)
      .where(eq(invoiceLineItemsTable.invoiceId, id));
    res.json({ ...invoice, lineItems });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

// Create — admin only. Body: { commitmentId?, billToName, billToStreet?, billToHouseNumber?,
// billToEmail?, dueInDays? (default 7), notes?, lineItems: [{ description, quantity?, unitAmount }] }
router.post("/invoices", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;

  const billToName = typeof body.billToName === "string" ? body.billToName.trim() : "";
  if (!billToName) {
    res.status(400).json({ error: "billToName is required" });
    return;
  }
  const lineItemsInput = Array.isArray(body.lineItems) ? (body.lineItems as LineItemInput[]) : [];
  if (lineItemsInput.length === 0) {
    res.status(400).json({ error: "At least one line item is required" });
    return;
  }
  for (const li of lineItemsInput) {
    if (!li || typeof li.description !== "string" || !li.description.trim() || typeof li.unitAmount !== "number") {
      res.status(400).json({ error: "Each line item needs a description and unitAmount" });
      return;
    }
  }

  const commitmentId =
    typeof body.commitmentId === "number" && Number.isInteger(body.commitmentId) ? body.commitmentId : null;
  const billToStreet = typeof body.billToStreet === "string" ? body.billToStreet.trim() || null : null;
  const billToHouseNumber = typeof body.billToHouseNumber === "string" ? body.billToHouseNumber.trim() || null : null;
  const billToEmail = typeof body.billToEmail === "string" ? body.billToEmail.trim() || null : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  // Default payment terms: 7 days, per KCEA's own instruction.
  const dueInDays = typeof body.dueInDays === "number" && body.dueInDays > 0 ? body.dueInDays : 7;

  try {
    if (commitmentId !== null) {
      const [exists] = await db.select({ id: commitmentsTable.id }).from(commitmentsTable).where(eq(commitmentsTable.id, commitmentId));
      if (!exists) {
        res.status(400).json({ error: "commitmentId does not match an existing commitment" });
        return;
      }
    }

    const invoiceDate = new Date();
    const dueDate = new Date(invoiceDate.getTime() + dueInDays * 24 * 60 * 60 * 1000);
    const invoiceNumber = await nextInvoiceNumber();

    const items = lineItemsInput.map(li => {
      const quantity = typeof li.quantity === "number" && li.quantity > 0 ? Math.floor(li.quantity) : 1;
      const unitAmount = Math.round(li.unitAmount);
      return { description: li.description.trim(), quantity, unitAmount, amount: quantity * unitAmount };
    });
    const total = items.reduce((s, i) => s + i.amount, 0);

    const [invoice] = await db
      .insert(invoicesTable)
      .values({
        invoiceNumber,
        commitmentId,
        billToName,
        billToStreet,
        billToHouseNumber,
        billToEmail,
        invoiceDate,
        dueDate,
        status: "unpaid",
        subtotal: total,
        total,
        notes,
        createdBy: createdByFromReq(req.headers as Record<string, unknown>),
      })
      .returning();

    await db.insert(invoiceLineItemsTable).values(items.map(i => ({ ...i, invoiceId: invoice.id })));

    const savedItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id));
    res.status(201).json({ ...invoice, lineItems: savedItems });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

// Update status only — admin only. Body: { status: "draft"|"unpaid"|"paid"|"overdue"|"cancelled" }
router.put("/invoices/:id/status", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const validStatuses = ["draft", "unpaid", "paid", "overdue", "cancelled"];
  const body = req.body as Record<string, unknown>;
  const status = typeof body.status === "string" ? body.status : "";
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    return;
  }
  try {
    const [updated] = await db
      .update(invoicesTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(invoicesTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update invoice status" });
  }
});

export default router;
