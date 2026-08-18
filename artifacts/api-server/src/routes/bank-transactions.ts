// Persistent bank transaction ledger — every credit line ever imported from
// a bank statement lives here permanently (status: unallocated | allocated
// | ignored), instead of only existing during a one-time "preview then
// confirm" dialog session (the older /payments/import-preview flow). This
// lets an admin come back later — any time — and allocate whatever's still
// sitting unmatched, the same way Slipstream's swool.io Bank Transactions
// page works.
//
// Import behaviour:
//  - A row with a confident street+house match AND an open invoice gets
//    auto-allocated immediately (same as the old confirm-flow default).
//  - Everything else (no match, or matched but no open invoice) is saved as
//    "unallocated" with suggestedCommitmentId set when there's a guess, so
//    the allocate form can pre-fill it.
//  - Re-importing an overlapping statement is safe: rows are deduped against
//    already-imported ones by date + description + amount before insert.
import { Router } from "express";
import { db, commitmentsTable, invoicesTable, paymentsTable, bankTransactionsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { isAdminReq } from "../lib/admin-auth";
import { recomputeInvoiceStatus } from "./invoices";
import { parseCsv, detectColumns, parseAmount, findMatch, duplicateKey } from "./payments";

const router = Router();

function adminUsername(req: { headers: Record<string, unknown> }): string {
  const v = req.headers["x-admin-username"];
  return typeof v === "string" && v ? v : "admin";
}

// Dedupe key for an already-imported bank_transactions row — same date (to
// the day), description, and amount. Distinct from payments.ts's
// duplicateKey (which is invoice-scoped, for the payment itself); this one
// is for not re-inserting the same raw bank line twice.
function transactionDedupeKey(date: Date, description: string, amount: number): string {
  return `${date.toISOString().slice(0, 10)}|${description.trim().toLowerCase()}|${amount}`;
}

// List — admin only. ?status=unallocated|allocated|ignored to filter (omit for all).
router.get("/bank-transactions", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    let rows = await db.select().from(bankTransactionsTable).orderBy(desc(bankTransactionsTable.transactionDate));
    if (status) rows = rows.filter(r => r.status === status);

    // Attach the suggested/actual household's name + address for display,
    // without a separate fetch per row.
    const commitmentIds = new Set<number>();
    for (const r of rows) {
      if (r.suggestedCommitmentId) commitmentIds.add(r.suggestedCommitmentId);
      if (r.commitmentId) commitmentIds.add(r.commitmentId);
    }
    const commitments =
      commitmentIds.size > 0
        ? await db
            .select({ id: commitmentsTable.id, fullName: commitmentsTable.fullName, street: commitmentsTable.street, houseNumber: commitmentsTable.houseNumber })
            .from(commitmentsTable)
            .where(sql`${commitmentsTable.id} in ${Array.from(commitmentIds)}`)
        : [];
    const commitmentById = new Map(commitments.map(c => [c.id, c]));

    res.json(
      rows.map(r => ({
        ...r,
        suggestedCommitment: r.suggestedCommitmentId ? commitmentById.get(r.suggestedCommitmentId) ?? null : null,
        commitment: r.commitmentId ? commitmentById.get(r.commitmentId) ?? null : null,
      })),
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch bank transactions" });
  }
});

// Import — admin only. Body: { csv: string }. Persists every credit row,
// auto-allocating confident matches with an open invoice.
router.post("/bank-transactions/import", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) {
    res.status(400).json({ error: "csv is required" });
    return;
  }

  try {
    const rows = parseCsv(csv);
    if (rows.length === 0) {
      res.status(400).json({ error: "No rows found in CSV" });
      return;
    }
    const { dateIdx, descIdx, amountIdx, startRow } = detectColumns(rows);
    const parsed = rows.slice(startRow).map(r => ({
      date: r[dateIdx]?.trim() || null,
      description: r[descIdx]?.trim() || "",
      amount: parseAmount(r[amountIdx]),
    }));
    const credits = parsed.filter(r => r.amount !== null && r.amount > 0 && r.description);

    const commitments = await db
      .select({ id: commitmentsTable.id, fullName: commitmentsTable.fullName, street: commitmentsTable.street, houseNumber: commitmentsTable.houseNumber })
      .from(commitmentsTable);

    const openInvoicesByCommitment = new Map<number, { id: number; invoiceNumber: string; total: number }[]>();
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(and(sql`${invoicesTable.commitmentId} is not null`, sql`${invoicesTable.status} in ('unpaid', 'partial', 'overdue')`));
    for (const inv of invoices) {
      if (inv.commitmentId === null) continue;
      const list = openInvoicesByCommitment.get(inv.commitmentId) ?? [];
      list.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, total: inv.total });
      openInvoicesByCommitment.set(inv.commitmentId, list);
    }
    for (const list of openInvoicesByCommitment.values()) list.sort((a, b) => a.id - b.id);

    // Dedupe against bank_transactions already on file (re-importing an
    // overlapping statement must not create duplicate ledger rows), and
    // against payments already recorded via the older confirm-flow (so
    // switching from that flow to this one doesn't double-count history).
    const existingTx = await db.select({ transactionDate: bankTransactionsTable.transactionDate, description: bankTransactionsTable.description, amount: bankTransactionsTable.amount }).from(bankTransactionsTable);
    const existingTxKeys = new Set(existingTx.map(t => transactionDedupeKey(new Date(t.transactionDate), t.description, t.amount)));
    const existingPayments = await db.select({ invoiceId: paymentsTable.invoiceId, amount: paymentsTable.amount, paymentDate: paymentsTable.paymentDate }).from(paymentsTable);
    const existingPaymentKeys = new Set(existingPayments.map(p => duplicateKey(p.invoiceId, p.amount, new Date(p.paymentDate))));

    // Running remaining-balance per invoice, tracked live through this
    // import loop — NOT just a one-time snapshot from before the batch
    // started. Bug found 2026-08-18: two separate real payments for the
    // same household in one batch both landed on the household's single
    // "oldest open invoice" (computed once), overpaying it while a
    // different invoice for that household never got anything applied.
    // Now each invoice's remaining balance is decremented as it's used, so
    // a second payment for the same household correctly rolls forward to
    // their next invoice with room, instead of stacking on the first one.
    const paidByInvoice = new Map<number, number>();
    for (const p of existingPayments) paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + p.amount);
    const remainingByInvoice = new Map<number, number>();
    for (const list of openInvoicesByCommitment.values()) {
      for (const inv of list) remainingByInvoice.set(inv.id, inv.total - (paidByInvoice.get(inv.id) ?? 0));
    }

    function nextInvoiceWithRoom(commitmentId: number): { id: number; invoiceNumber: string; total: number } | null {
      const list = openInvoicesByCommitment.get(commitmentId) ?? [];
      return list.find(inv => (remainingByInvoice.get(inv.id) ?? 0) > 0) ?? null;
    }

    let inserted = 0;
    let autoAllocated = 0;
    let skippedDuplicate = 0;
    const recordedBy = adminUsername(req);
    const touchedInvoiceIds = new Set<number>();

    for (const row of credits) {
      const rowDate = row.date ? new Date(row.date) : new Date();
      if (isNaN(rowDate.getTime()) || row.amount === null) continue;

      const txKey = transactionDedupeKey(rowDate, row.description, row.amount);
      if (existingTxKeys.has(txKey)) {
        skippedDuplicate++;
        continue;
      }
      existingTxKeys.add(txKey);

      const match = findMatch(row.description, commitments);
      const openInvoice = match ? nextInvoiceWithRoom(match.id) : null;
      const isDuplicatePayment = openInvoice ? existingPaymentKeys.has(duplicateKey(openInvoice.id, row.amount, rowDate)) : false;
      // A payment larger than what the matched invoice actually still owes
      // is very likely a multi-month lump-sum prepayment (confirmed
      // 2026-08-18 against real production data: e.g. one real R5,000
      // transaction fully overpaying a R250 invoice by 20x) — auto-applying
      // the whole amount to one small invoice is wrong. Leave it
      // unallocated with the suggestion pre-filled so an admin decides how
      // many months it actually covers (e.g. via "Multi-month invoice")
      // before allocating it, rather than guessing.
      const fitsInvoice = openInvoice ? row.amount <= (remainingByInvoice.get(openInvoice.id) ?? 0) : false;

      if (match && openInvoice && !isDuplicatePayment && fitsInvoice) {
        // Confident match with an open invoice to attach to — auto-allocate.
        const [payment] = await db
          .insert(paymentsTable)
          .values({
            invoiceId: openInvoice.id,
            amount: row.amount,
            paymentDate: rowDate,
            method: "EFT",
            reference: row.description.slice(0, 500),
            source: "bank_import",
            recordedBy,
          })
          .returning();
        touchedInvoiceIds.add(openInvoice.id);
        existingPaymentKeys.add(duplicateKey(openInvoice.id, row.amount, rowDate));
        remainingByInvoice.set(openInvoice.id, (remainingByInvoice.get(openInvoice.id) ?? 0) - row.amount);

        await db.insert(bankTransactionsTable).values({
          transactionDate: rowDate,
          description: row.description,
          amount: row.amount,
          status: "allocated",
          suggestedCommitmentId: match.id,
          commitmentId: match.id,
          invoiceId: openInvoice.id,
          paymentId: payment.id,
        });
        autoAllocated++;
      } else {
        await db.insert(bankTransactionsTable).values({
          transactionDate: rowDate,
          description: row.description,
          amount: row.amount,
          status: "unallocated",
          suggestedCommitmentId: match?.id ?? null,
        });
      }
      inserted++;
    }

    for (const invoiceId of touchedInvoiceIds) {
      await recomputeInvoiceStatus(invoiceId);
    }

    res.status(201).json({
      totalCreditRows: credits.length,
      inserted,
      autoAllocated,
      unallocated: inserted - autoAllocated,
      skippedDuplicate,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to import bank transactions" });
  }
});

// Allocate — admin only. Body: { commitmentId, invoiceId, amount?, paymentDate?, method?, reference? }
router.post("/bank-transactions/:id/allocate", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const commitmentId = typeof body.commitmentId === "number" && Number.isInteger(body.commitmentId) ? body.commitmentId : null;
  const invoiceId = typeof body.invoiceId === "number" && Number.isInteger(body.invoiceId) ? body.invoiceId : null;
  if (!commitmentId || !invoiceId) {
    res.status(400).json({ error: "commitmentId and invoiceId are required" });
    return;
  }

  try {
    const [tx] = await db.select().from(bankTransactionsTable).where(eq(bankTransactionsTable.id, id));
    if (!tx) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (tx.status === "allocated") {
      res.status(409).json({ error: "Already allocated" });
      return;
    }
    const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice) {
      res.status(400).json({ error: "Invoice not found" });
      return;
    }

    const amount = typeof body.amount === "number" && body.amount > 0 ? Math.round(body.amount) : tx.amount;
    const paymentDate = typeof body.paymentDate === "string" && body.paymentDate ? new Date(body.paymentDate) : new Date(tx.transactionDate);
    const method = typeof body.method === "string" && body.method.trim() ? body.method.trim() : "EFT";
    const reference = typeof body.reference === "string" ? body.reference.trim() || null : tx.description.slice(0, 500);

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        invoiceId,
        amount,
        paymentDate: isNaN(paymentDate.getTime()) ? new Date() : paymentDate,
        method,
        reference,
        source: "bank_import",
        recordedBy: adminUsername(req),
      })
      .returning();

    const [updated] = await db
      .update(bankTransactionsTable)
      .set({ status: "allocated", commitmentId, invoiceId, paymentId: payment.id })
      .where(eq(bankTransactionsTable.id, id))
      .returning();

    await recomputeInvoiceStatus(invoiceId);
    res.json({ transaction: updated, payment });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to allocate transaction" });
  }
});

// Ignore — admin only. For rows that aren't a real resident payment (a bank
// fee that slipped through the credit/debit filter, KCEA's own internal
// transfer, etc.) — removes it from the unallocated queue without
// pretending it's a household payment.
router.post("/bank-transactions/:id/ignore", async (req, res) => {
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
    const [updated] = await db.update(bankTransactionsTable).set({ status: "ignored" }).where(eq(bankTransactionsTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to ignore transaction" });
  }
});

// Un-ignore — puts a row back to unallocated (undo an accidental ignore).
router.post("/bank-transactions/:id/unignore", async (req, res) => {
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
    const [updated] = await db.update(bankTransactionsTable).set({ status: "unallocated" }).where(eq(bankTransactionsTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to unignore transaction" });
  }
});

export default router;
