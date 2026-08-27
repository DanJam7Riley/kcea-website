// Resident self-service statement — public, token-gated, no login required.
// Purpose: residents keep asking KCEA to resend an invoice; this gives them
// a link (included in every invoice email) that always shows their current
// invoice history, payments, and running balance, so they can check it
// themselves instead of generating admin work each time.
//
// Token scheme is the same stateless HMAC pattern as legacy-confirm.ts /
// commitments.ts's public self-update flow — deterministic, keyed by
// SESSION_SECRET, no separate tokens table needed. Unlike the legacy-confirm
// token this one has no expiry (a statement link should keep working
// indefinitely, the same way a real bank statement link would).
import { Router } from "express";
import { db, commitmentsTable, invoicesTable, invoiceLineItemsTable, paymentsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isAdminReq } from "../lib/admin-auth";

const router = Router();

export function makeStatementToken(commitmentId: number): string {
  const secret = process.env.SESSION_SECRET ?? "kcea-fallback-secret";
  return createHmac("sha256", secret).update(`statement:${commitmentId}`).digest("hex").slice(0, 24);
}

function verifyStatementToken(commitmentId: number, token: string | undefined): boolean {
  if (!token) return false;
  const expected = makeStatementToken(commitmentId);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

// Also usable by admin directly (no token needed) — e.g. the resident
// detail popup in the admin Residents tab. Public callers still need a
// valid token; the admin auth headers are just an alternate way in.
router.get("/commitments/:id/statement", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = typeof req.query.t === "string" ? req.query.t : undefined;
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!verifyStatementToken(id, token) && !isAdminReq(req.headers)) {
    res.status(403).json({ error: "Invalid or missing link" });
    return;
  }

  try {
    const [commitment] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, id));
    if (!commitment) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.commitmentId, id));
    invoices.sort((a, b) => new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime());

    const invoiceIds = invoices.map(i => i.id);
    const lineItemsByInvoice = new Map<number, { description: string; quantity: number; unitAmount: number; amount: number }[]>();
    const paymentsByInvoice = new Map<number, { amount: number; paymentDate: Date; method: string; reference: string | null }[]>();

    for (const inv of invoices) {
      const items = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, inv.id));
      lineItemsByInvoice.set(
        inv.id,
        items.map(i => ({ description: i.description, quantity: i.quantity, unitAmount: i.unitAmount, amount: i.amount })),
      );
      const pays = await db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, inv.id));
      paymentsByInvoice.set(
        inv.id,
        pays.map(p => ({ amount: p.amount, paymentDate: p.paymentDate, method: p.method, reference: p.reference })),
      );
    }

    // Per-invoice "balance" stays floored at 0 — an individual invoice is
    // either owed-on or fully settled, never itself "negative". But the
    // household's overall position must NOT be floored per-invoice before
    // summing, or a real credit balance (paid more in total than invoiced)
    // silently disappears into "R0" instead of showing as credit — found
    // 2026-08-18 on a real resident (paid R1,500 against R500 total across
    // two invoices, showed "Balance R0" instead of "R1,000 in credit").
    let totalInvoiced = 0;
    let totalPaidOverall = 0;
    const statementInvoices = invoices.map(inv => {
      const amountPaid = (paymentsByInvoice.get(inv.id) ?? []).reduce((s, p) => s + p.amount, 0);
      const balance = Math.max(0, inv.total - amountPaid);
      totalInvoiced += inv.total;
      totalPaidOverall += amountPaid;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        status: inv.status,
        total: inv.total,
        amountPaid,
        balance,
        lineItems: lineItemsByInvoice.get(inv.id) ?? [],
        payments: paymentsByInvoice.get(inv.id) ?? [],
      };
    });
    // Unapplied credit — money allocated directly to this household (not a
    // specific invoice), e.g. via the bank transactions ledger's "Allocate
    // to household" action when there's no open invoice yet. Counts toward
    // the household's overall position immediately (so it shows as credit
    // here even before an invoice exists to apply it to), and auto-connects
    // to the next invoice generated for them (see applyAvailableCredit in
    // invoices.ts) rather than staying stranded.
    const unappliedCredits = await db
      .select()
      .from(paymentsTable)
      .where(and(eq(paymentsTable.commitmentId, id), isNull(paymentsTable.invoiceId)));
    const unappliedCreditTotal = unappliedCredits.reduce((s, c) => s + c.amount, 0);
    totalPaidOverall += unappliedCreditTotal;

    // Positive = owes KCEA; negative = KCEA owes them (in credit).
    const totalOutstanding = totalInvoiced - totalPaidOverall;

    res.json({
      commitment: {
        id: commitment.id,
        fullName: commitment.fullName,
        street: commitment.street,
        houseNumber: commitment.houseNumber,
        commitmentType: commitment.commitmentType,
      },
      invoices: statementInvoices,
      unappliedCredits: unappliedCredits.map(c => ({
        id: c.id,
        amount: c.amount,
        paymentDate: c.paymentDate,
        method: c.method,
        reference: c.reference,
      })),
      totalOutstanding,
      invoiceCount: invoiceIds.length,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load statement" });
  }
});

export default router;
