import { Router } from "express";
import { db, invoicesTable, invoiceLineItemsTable, commitmentsTable } from "@workspace/db";
import { eq, desc, sql, and, isNull } from "drizzle-orm";
import { isAdminReq, adminRoleFromHeaders, PRIMARY_USERNAME, SECONDARY_USERNAME } from "../lib/admin-auth";
import { sendEmail } from "../lib/email";

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

// Standard rate is R250/month per household. Earls Court is a complex billed at
// R150/month — matches KCEA's own reconciled payment history, not the flat rate
// the public-facing site advertises for standalone houses.
function monthlyRateForStreet(street: string): number {
  return street === "Earls Court" ? 150 : 250;
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Preview — admin only. Returns every "monthly" commitment that doesn't already
// have an invoice dated this calendar month, with the rate that would be charged.
// Nothing is written here; the admin reviews/deselects in the UI, then confirms
// via bulk-generate. Once-off (R3,000) commitments are excluded by definition —
// this only ever looks at commitmentType === "monthly".
//
// IMPORTANT: this route must stay registered ABOVE GET /invoices/:id. Express
// matches routes in registration order, so if /invoices/:id comes first it
// swallows this request (treats "bulk-preview" as the :id param, parseInt fails,
// returns 400 "Invalid id"). Fixed 2026-07-31 — see KCEA_MASTER.md.
router.get("/invoices/bulk-preview", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const monthStart = startOfCurrentMonth();

    const monthly = await db
      .select()
      .from(commitmentsTable)
      .where(eq(commitmentsTable.commitmentType, "monthly"));

    const alreadyInvoiced = await db
      .select({ commitmentId: invoicesTable.commitmentId })
      .from(invoicesTable)
      .where(sql`${invoicesTable.commitmentId} is not null and ${invoicesTable.invoiceDate} >= ${monthStart}`);
    const invoicedIds = new Set(alreadyInvoiced.map(r => r.commitmentId));

    const eligible = monthly
      .filter(c => !invoicedIds.has(c.id))
      .map(c => ({
        commitmentId: c.id,
        fullName: c.fullName,
        street: c.street,
        houseNumber: c.houseNumber,
        email: c.email,
        rate: monthlyRateForStreet(c.street),
      }));

    res.json({ eligible, alreadyInvoicedThisMonth: monthly.length - eligible.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to build bulk invoice preview" });
  }
});

// ── Bulk email: preview + send ──────────────────────────────────
// Same reason these live here and not lower down: Express matches routes in
// registration order, and /invoices/:id below would otherwise swallow these
// (parseInt("unsent") / parseInt("send-all") fails → 400), same trap that bit
// bulk-preview before. Both must stay above GET /invoices/:id.
//
// "Unsent" = status isn't cancelled and emailSentAt is still null. Safe to
// call the send route more than once — it only ever emails each invoice once.
const isUsableEmail = (e: string | null | undefined) => !!e && e.trim() !== "";

router.get("/invoices/unsent", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(and(sql`${invoicesTable.status} != 'cancelled'`, isNull(invoicesTable.emailSentAt)));

    const emailable = rows.filter(r => isUsableEmail(r.billToEmail));
    const noEmailOnFile = rows.filter(r => !isUsableEmail(r.billToEmail));

    res.json({
      readyToSend: emailable.length,
      noEmailOnFile: noEmailOnFile.length,
      preview: emailable.slice(0, 10).map(r => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        billToName: r.billToName,
        billToEmail: r.billToEmail,
        total: r.total,
      })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load unsent invoices" });
  }
});

// Requires { confirm: true } in the body as a deliberate extra step, same
// pattern as the legacy-confirm send route — never fires by accident.
router.post("/invoices/send-all", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (body.confirm !== true) {
    res.status(400).json({ error: "Refusing to send — pass { \"confirm\": true } in the request body." });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(and(sql`${invoicesTable.status} != 'cancelled'`, isNull(invoicesTable.emailSentAt)));

    let sent = 0;
    let skippedNoEmail = 0;
    let failed = 0;

    for (const inv of rows) {
      if (!isUsableEmail(inv.billToEmail)) {
        skippedNoEmail++;
        continue;
      }
      const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, inv.id));
      const itemsText = lineItems.map(li => `- ${li.description} x${li.quantity}: R${li.amount.toLocaleString("en-ZA")}`).join("\n");
      const dueDateStr = new Date(inv.dueDate).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
      const reference = [inv.billToHouseNumber, inv.billToStreet].filter(Boolean).join(" ") || inv.billToName;

      const subject = `KCEA invoice ${inv.invoiceNumber}`;
      const text =
        `Hi ${inv.billToName},\n\n` +
        `Here's your KCEA invoice ${inv.invoiceNumber}.\n\n` +
        `${itemsText}\n\n` +
        `Total due: R${inv.total.toLocaleString("en-ZA")}\n` +
        `Due date: ${dueDateStr}\n\n` +
        `Banking details:\n` +
        `Kensington Central Enclosure Association\n` +
        `FNB Gold Business Account\n` +
        `Account number: 63213323693\n` +
        `Branch code: 250655\n` +
        `Reference: ${reference}\n\n` +
        `Questions? Contact your street captain, or message KCEA on WhatsApp before paying if anything looks off. ` +
        `We'll never ask for passwords, card numbers, or bank details by email.\n\n` +
        `— KCEA`;

      const result = await sendEmail(inv.billToEmail as string, subject, text);
      if (result.ok) {
        await db.update(invoicesTable).set({ emailSentAt: new Date() }).where(eq(invoicesTable.id, inv.id));
        sent++;
      } else {
        req.log.warn({ invoiceId: inv.id, reason: result.reason }, "Invoice email failed to send");
        failed++;
      }
    }

    res.json({ sent, skippedNoEmail, failed });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Send batch failed" });
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
  // Default payment terms: 15 days, per Ingrid (treasurer) — 7 was too tight for residents paid mid-month.
  const dueInDays = typeof body.dueInDays === "number" && body.dueInDays > 0 ? body.dueInDays : 15;

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

// Generate — admin only. Body: { commitmentIds: number[] } — exactly the set the
// admin kept after reviewing the preview (anyone they unchecked, e.g. a once-off
// payer that slipped through, is simply left out). Re-checks eligibility per ID
// so nothing gets double-invoiced even if the preview is stale.
router.post("/invoices/bulk-generate", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const commitmentIds = Array.isArray(body.commitmentIds)
    ? (body.commitmentIds as unknown[]).filter((n): n is number => typeof n === "number" && Number.isInteger(n))
    : [];
  if (commitmentIds.length === 0) {
    res.status(400).json({ error: "commitmentIds must be a non-empty array" });
    return;
  }

  const created: string[] = [];
  const skipped: { commitmentId: number; reason: string }[] = [];
  const monthStart = startOfCurrentMonth();
  const createdBy = createdByFromReq(req.headers as Record<string, unknown>);

  try {
    for (const commitmentId of commitmentIds) {
      const [commitment] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, commitmentId));
      if (!commitment) {
        skipped.push({ commitmentId, reason: "Commitment not found" });
        continue;
      }
      if (commitment.commitmentType !== "monthly") {
        skipped.push({ commitmentId, reason: "Not a monthly commitment (likely once-off)" });
        continue;
      }
      const [existing] = await db
        .select({ id: invoicesTable.id })
        .from(invoicesTable)
        .where(
          sql`${invoicesTable.commitmentId} = ${commitmentId} and ${invoicesTable.invoiceDate} >= ${monthStart}`,
        );
      if (existing) {
        skipped.push({ commitmentId, reason: "Already invoiced this month" });
        continue;
      }

      const rate = monthlyRateForStreet(commitment.street);
      const invoiceDate = new Date();
      // 15-day due date, per Ingrid (treasurer) — matches the default on the manual create form.
      const dueDate = new Date(invoiceDate.getTime() + 15 * 24 * 60 * 60 * 1000);
      const invoiceNumber = await nextInvoiceNumber();

      const [invoice] = await db
        .insert(invoicesTable)
        .values({
          invoiceNumber,
          commitmentId,
          billToName: commitment.fullName,
          billToStreet: commitment.street,
          billToHouseNumber: commitment.houseNumber,
          billToEmail: commitment.email,
          invoiceDate,
          dueDate,
          status: "unpaid",
          subtotal: rate,
          total: rate,
          notes: null,
          createdBy,
        })
        .returning();

      await db.insert(invoiceLineItemsTable).values({
        invoiceId: invoice.id,
        description: "Monthly household contribution",
        quantity: 1,
        unitAmount: rate,
        amount: rate,
      });

      created.push(invoiceNumber);
    }

    res.status(201).json({ created, skipped, createdCount: created.length, skippedCount: skipped.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to bulk-generate invoices" });
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

// Delete — admin only. Hard delete (line items cascade via FK). For cleaning up
// test invoices or bulk-generate mistakes (e.g. a once-off payer that slipped
// through) — per KCEA's own instruction that removal should mean gone, not
// just hidden as "cancelled".
router.delete("/invoices/:id", async (req, res) => {
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
    const [deleted] = await db.delete(invoicesTable).where(eq(invoicesTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

export default router;