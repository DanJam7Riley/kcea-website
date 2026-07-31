import { Router } from "express";
import { db, invoicesTable, invoiceLineItemsTable, commitmentsTable, paymentsTable } from "@workspace/db";
import { eq, desc, sql, inArray } from "drizzle-orm";
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

// ── Payments helpers ──────────────────────────────────────────────
// Amount paid / balance / derived status are computed fresh from the payments
// table every time — never stored redundantly, so they can't drift out of
// sync with what was actually recorded.
async function paymentsForInvoice(invoiceId: number) {
    return db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoiceId)).orderBy(desc(paymentsTable.paymentDate));
}

function withPaymentTotals<T extends { total: number }>(invoice: T, payments: { amount: number }[]) {
    const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
    const balance = invoice.total - amountPaid;
    return { ...invoice, amountPaid, balance };
}

// Recompute and persist status from actual payments recorded. Never touches
// "cancelled" (an admin choice, not a payment fact) or "draft" (a draft
// invoice shouldn't flip to unpaid/partial just because a payment got
// attached to it by mistake — the admin needs to finalize it first).
async function recomputeInvoiceStatus(invoiceId: number): Promise<void> {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice || invoice.status === "cancelled" || invoice.status === "draft") return;
    const payments = await paymentsForInvoice(invoiceId);
    const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
    const nextStatus = amountPaid <= 0 ? "unpaid" : amountPaid >= invoice.total ? "paid" : "partial";
    if (nextStatus !== invoice.status) {
          await db.update(invoicesTable).set({ status: nextStatus, updatedAt: new Date() }).where(eq(invoicesTable.id, invoiceId));
    }
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

      const ids = rows.map(r => r.id);
          const allPayments = ids.length > 0 ? await db.select().from(paymentsTable).where(inArray(paymentsTable.invoiceId, ids)) : [];
          const byInvoice = new Map<number, { amount: number }[]>();
          for (const p of allPayments) {
                  const list = byInvoice.get(p.invoiceId) ?? [];
                  list.push(p);
                  byInvoice.set(p.invoiceId, list);
          }
          res.json(rows.map(r => withPaymentTotals(r, byInvoice.get(r.id) ?? [])));
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

// ── Statements ─────────────────────────────────────────────────────
// Registered above /invoices/:id for the same reason bulk-preview is — Express
// matches routes in registration order, so a literal path must come before the
// :id catch-all or it gets swallowed (see the bulk-preview bug fixed 2026-07-31).

// One resident: every invoice + payment tied to a commitment, plus a running
// balance. Admin-only. Query by ?commitmentId= (preferred, matches bulk-generated
// invoices) or ?street=&houseNumber= (for manually created invoices with no
// linked commitment).
router.get("/statements/resident", async (req, res) => {
    if (!isAdminReq(req.headers)) {
          res.status(401).json({ error: "Unauthorized" });
          return;
    }
    const commitmentId = typeof req.query.commitmentId === "string" ? parseInt(req.query.commitmentId, 10) : NaN;
    const street = typeof req.query.street === "string" ? req.query.street.trim() : "";
    const houseNumber = typeof req.query.houseNumber === "string" ? req.query.houseNumber.trim() : "";

             if (isNaN(commitmentId) && !(street && houseNumber)) {
                   res.status(400).json({ error: "Provide commitmentId, or both street and houseNumber" });
                   return;
             }

             try {
                   let resident: { fullName: string; street: string; houseNumber: string } | null = null;
                   let invoices;
                   if (!isNaN(commitmentId)) {
                           const [commitment] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, commitmentId));
                           if (!commitment) {
                                     res.status(404).json({ error: "Commitment not found" });
                                     return;
                           }
                           resident = { fullName: commitment.fullName, street: commitment.street, houseNumber: commitment.houseNumber };
                           invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.commitmentId, commitmentId)).orderBy(invoicesTable.invoiceDate);
                   } else {
                           invoices = await db
                             .select()
                             .from(invoicesTable)
                             .where(sql`${invoicesTable.billToStreet} = ${street} and ${invoicesTable.billToHouseNumber} = ${houseNumber}`)
                             .orderBy(invoicesTable.invoiceDate);
                           if (invoices[0]) resident = { fullName: invoices[0].billToName, street, houseNumber };
                   }

      const invoiceIds = invoices.map(i => i.id);
                   const allPayments = invoiceIds.length > 0 ? await db.select().from(paymentsTable).where(inArray(paymentsTable.invoiceId, invoiceIds)) : [];
                   const byInvoice = new Map<number, typeof allPayments>();
                   for (const p of allPayments) {
                           const list = byInvoice.get(p.invoiceId) ?? [];
                           list.push(p);
                           byInvoice.set(p.invoiceId, list);
                   }

      const invoiceRows = invoices.map(inv => withPaymentTotals(inv, byInvoice.get(inv.id) ?? []));
                   const totalInvoiced = invoiceRows.reduce((s, i) => s + i.total, 0);
                   const totalPaid = invoiceRows.reduce((s, i) => s + i.amountPaid, 0);

      res.json({
              resident,
              invoices: invoiceRows,
              payments: allPayments,
              summary: { totalInvoiced, totalPaid, totalOutstanding: totalInvoiced - totalPaid },
      });
             } catch (err) {
                   req.log.error(err);
                   res.status(500).json({ error: "Failed to build resident statement" });
             }
});

// Everyone, date range: all invoice + payment activity between ?from= and ?to=
// (inclusive, YYYY-MM-DD), filtered on invoiceDate. Admin-only.
router.get("/statements", async (req, res) => {
    if (!isAdminReq(req.headers)) {
          res.status(401).json({ error: "Unauthorized" });
          return;
    }
    try {
          const from = typeof req.query.from === "string" && req.query.from ? new Date(req.query.from) : null;
          const to = typeof req.query.to === "string" && req.query.to ? new Date(req.query.to + "T23:59:59") : null;

      let invoices = await db.select().from(invoicesTable).orderBy(invoicesTable.invoiceDate);
          if (from) invoices = invoices.filter(i => new Date(i.invoiceDate) >= from);
          if (to) invoices = invoices.filter(i => new Date(i.invoiceDate) <= to);

      const invoiceIds = invoices.map(i => i.id);
          const allPayments = invoiceIds.length > 0 ? await db.select().from(paymentsTable).where(inArray(paymentsTable.invoiceId, invoiceIds)) : [];
          const byInvoice = new Map<number, typeof allPayments>();
          for (const p of allPayments) {
                  const list = byInvoice.get(p.invoiceId) ?? [];
                  list.push(p);
                  byInvoice.set(p.invoiceId, list);
          }

      const invoiceRows = invoices.map(inv => withPaymentTotals(inv, byInvoice.get(inv.id) ?? []));
          const totalInvoiced = invoiceRows.reduce((s, i) => s + i.total, 0);
          const totalPaid = invoiceRows.reduce((s, i) => s + i.amountPaid, 0);

      res.json({
              from: req.query.from ?? null,
              to: req.query.to ?? null,
              invoices: invoiceRows,
              payments: allPayments,
              summary: {
                        totalInvoiced,
                        totalPaid,
                        totalOutstanding: totalInvoiced - totalPaid,
                        invoiceCount: invoiceRows.length,
              },
      });
    } catch (err) {
          req.log.error(err);
          res.status(500).json({ error: "Failed to build statement" });
    }
});

// Single invoice + its line items + its payments — admin only.
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
          const payments = await paymentsForInvoice(id);
          res.json({ ...withPaymentTotals(invoice, payments), lineItems, payments });
    } catch (err) {
          req.log.error(err);
          res.status(500).json({ error: "Failed to fetch invoice" });
    }
});

// Create — admin only. Body: { commitmentId?, billToName, billToStreet?, billToHouseNumber?,
// billToEmail?, dueInDays? (default 15), notes?, lineItems: [{ description, quantity?, unitAmount }] }
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

// ── Payments ────────────────────────────────────────────────────────
// Record a payment — admin only. Body: { amount, paymentDate?, method? (default
// "eft"), reference?, notes? }. Recomputes the invoice's status immediately
// (unpaid → partial → paid) — this is now the only way an invoice becomes
// "paid"; the manual status field no longer accepts "paid" directly (see
// PUT /invoices/:id/status below).
router.post("/invoices/:id/payments", async (req, res) => {
    if (!isAdminReq(req.headers)) {
          res.status(401).json({ error: "Unauthorized" });
          return;
    }
    const invoiceId = parseInt(req.params.id, 10);
    if (isNaN(invoiceId)) {
          res.status(400).json({ error: "Invalid id" });
          return;
    }
    const body = req.body as Record<string, unknown>;
    const amount = typeof body.amount === "number" && body.amount > 0 ? Math.round(body.amount) : NaN;
    if (isNaN(amount)) {
          res.status(400).json({ error: "amount must be a positive number" });
          return;
    }
    const paymentDate = typeof body.paymentDate === "string" && body.paymentDate ? new Date(body.paymentDate) : new Date();
    const method = typeof body.method === "string" && body.method.trim() ? body.method.trim() : "eft";
    const reference = typeof body.reference === "string" ? body.reference.trim() || null : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

              try {
                    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
                    if (!invoice) {
                            res.status(404).json({ error: "Invoice not found" });
                            return;
                    }
                    const [payment] = await db
                      .insert(paymentsTable)
                      .values({
                                invoiceId,
                                amount,
                                paymentDate,
                                method,
                                reference,
                                notes,
                                recordedBy: createdByFromReq(req.headers as Record<string, unknown>),
                      })
                      .returning();

      await recomputeInvoiceStatus(invoiceId);
                    const [updatedInvoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
                    const payments = await paymentsForInvoice(invoiceId);
                    res.status(201).json({ payment, invoice: withPaymentTotals(updatedInvoice, payments) });
              } catch (err) {
                    req.log.error(err);
                    res.status(500).json({ error: "Failed to record payment" });
              }
});

// List payments for one invoice — admin only.
router.get("/invoices/:id/payments", async (req, res) => {
    if (!isAdminReq(req.headers)) {
          res.status(401).json({ error: "Unauthorized" });
          return;
    }
    const invoiceId = parseInt(req.params.id, 10);
    if (isNaN(invoiceId)) {
          res.status(400).json({ error: "Invalid id" });
          return;
    }
    try {
          res.json(await paymentsForInvoice(invoiceId));
    } catch (err) {
          req.log.error(err);
          res.status(500).json({ error: "Failed to fetch payments" });
    }
});

// Undo a payment — admin only. Hard delete, matches the "removal means gone"
// convention already used for invoices. Recomputes the invoice's status back down.
router.delete("/payments/:id", async (req, res) => {
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
          const [deleted] = await db.delete(paymentsTable).where(eq(paymentsTable.id, id)).returning();
          if (!deleted) {
                  res.status(404).json({ error: "Not found" });
                  return;
          }
          await recomputeInvoiceStatus(deleted.invoiceId);
          const [updatedInvoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, deleted.invoiceId));
          const payments = await paymentsForInvoice(deleted.invoiceId);
          res.json({ ok: true, invoice: updatedInvoice ? withPaymentTotals(updatedInvoice, payments) : null });
    } catch (err) {
          req.log.error(err);
          res.status(500).json({ error: "Failed to delete payment" });
    }
});

// Update status only — admin only. Body: { status: "draft"|"unpaid"|"overdue"|"cancelled" }
// "paid"/"partial" are derived from recorded payments (see POST .../payments)
// and can no longer be set here — matches Janine's 2026-07-31 decision that
// "mark as paid" should mean "record a payment", not a manual status flip.
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
    const validStatuses = ["draft", "unpaid", "overdue", "cancelled"];
    const body = req.body as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status : "";
    if (!validStatuses.includes(status)) {
          res.status(400).json({
                  error:
                            status === "paid" || status === "partial"
                      ? "Use POST /invoices/:id/payments to record a payment instead of setting this status manually"
                              : `status must be one of: ${validStatuses.join(", ")}`,
          });
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

// Delete — admin only. Hard delete (line items cascade via FK). Blocked if any
// payment has been recorded against the invoice — per Janine's 2026-07-31
// decision, deleting a paid/partially-paid invoice would break the statement's
// audit trail; delete the payment(s) first if the invoice really needs to go.
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
          const existingPayments = await paymentsForInvoice(id);
          if (existingPayments.length > 0) {
                  res.status(409).json({ error: "Can't delete an invoice with payments recorded. Delete the payment(s) first." });
                  return;
          }
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
export default router;
