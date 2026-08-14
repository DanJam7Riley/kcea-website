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
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";

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

router.get("/commitments/:id/statement", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = typeof req.query.t === "string" ? req.query.t : undefined;
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!verifyStatementToken(id, token)) {
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

    let runningBalance = 0;
    const statementInvoices = invoices.map(inv => {
      const amountPaid = (paymentsByInvoice.get(inv.id) ?? []).reduce((s, p) => s + p.amount, 0);
      const balance = Math.max(0, inv.total - amountPaid);
      runningBalance += balance;
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

    res.json({
      commitment: {
        id: commitment.id,
        fullName: commitment.fullName,
        street: commitment.street,
        houseNumber: commitment.houseNumber,
        commitmentType: commitment.commitmentType,
      },
      invoices: statementInvoices,
      totalOutstanding: runningBalance,
      invoiceCount: invoiceIds.length,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load statement" });
  }
});

export default router;
