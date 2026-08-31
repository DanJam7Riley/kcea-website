import { db, invoicesTable, invoiceLineItemsTable, commitmentsTable, type Commitment } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";

// Once-off registration contribution — same constant as invoices.ts's own copy.
const ONCEOFF_AMOUNT = 3000;

// Standard rate is R250/month per household. Earls Court is a complex billed
// at R150/month — matches KCEA's own reconciled payment history.
export function monthlyRateForStreet(street: string): number {
  return street === "Earls Court" ? 150 : 250;
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Resolves a target billing month from an optional "YYYY-MM" string. Falls
// back to the current calendar month when omitted/invalid.
export function resolveMonthRange(monthParam: unknown): { start: Date; end: Date; isCurrent: boolean } {
  const now = new Date();
  if (typeof monthParam === "string" && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    const isCurrent = start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth();
    return { start, end, isCurrent };
  }
  const start = startOfCurrentMonth();
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return { start, end, isCurrent: true };
}

function invoiceDateForMonth(range: { start: Date; isCurrent: boolean }): Date {
  return range.isCurrent ? new Date() : range.start;
}

function invoiceCoversRange(invoiceDate: Date, coversMonths: number, rangeStart: Date, rangeEnd: Date): boolean {
  const coverStart = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth(), 1);
  const coverEnd = new Date(coverStart.getFullYear(), coverStart.getMonth() + Math.max(1, coversMonths), 1);
  return coverStart < rangeEnd && coverEnd > rangeStart;
}

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

// Every "monthly" commitment that doesn't already have an invoice covering
// the target month — same eligibility logic as GET /invoices/bulk-preview,
// factored out so the 25th-of-month auto-run can reuse it without an HTTP
// round-trip to itself.
export async function getEligibleMonthlyCommitments(range: { start: Date; end: Date }): Promise<Commitment[]> {
  const monthly = await db.select().from(commitmentsTable).where(eq(commitmentsTable.commitmentType, "monthly"));

  const candidateInvoices = await db
    .select({
      commitmentId: invoicesTable.commitmentId,
      invoiceDate: invoicesTable.invoiceDate,
      coversMonths: invoicesTable.coversMonths,
    })
    .from(invoicesTable)
    .where(and(sql`${invoicesTable.commitmentId} is not null`, sql`${invoicesTable.status} != 'cancelled'`));
  const invoicedIds = new Set(
    candidateInvoices
      .filter(r => invoiceCoversRange(new Date(r.invoiceDate), r.coversMonths, range.start, range.end))
      .map(r => r.commitmentId),
  );

  return monthly.filter(c => !invoicedIds.has(c.id));
}

// Creates one monthly invoice for a commitment against the given month range.
// Caller is responsible for confirming eligibility first (not already
// invoiced for that month) — this always creates, never checks.
export async function createMonthlyInvoice(
  commitment: Commitment,
  range: { start: Date; isCurrent: boolean },
  createdBy: string,
) {
  const rate = monthlyRateForStreet(commitment.street);
  const invoiceDate = invoiceDateForMonth(range);
  // 15-day due date, per Ingrid (treasurer) — matches the manual flows.
  const dueDate = new Date(invoiceDate.getTime() + 15 * 24 * 60 * 60 * 1000);
  const invoiceNumber = await nextInvoiceNumber();

  const [invoice] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber,
      commitmentId: commitment.id,
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

  return invoice;
}

// Creates the one-time once-off invoice for a commitment. Caller is
// responsible for confirming the commitment doesn't already have one.
export async function createOnceoffInvoice(commitment: Commitment, createdBy: string) {
  const invoiceDate = new Date(commitment.submittedAt);
  const dueDate = new Date(invoiceDate.getTime() + 15 * 24 * 60 * 60 * 1000);
  const invoiceNumber = await nextInvoiceNumber();
  const status = commitment.paymentConfirmed ? "paid" : "unpaid";

  const [invoice] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber,
      commitmentId: commitment.id,
      billToName: commitment.fullName,
      billToStreet: commitment.street,
      billToHouseNumber: commitment.houseNumber,
      billToEmail: commitment.email,
      invoiceDate,
      dueDate,
      status,
      subtotal: ONCEOFF_AMOUNT,
      total: ONCEOFF_AMOUNT,
      notes: "Once-off registration contribution — recorded for account history.",
      createdBy,
    })
    .returning();

  await db.insert(invoiceLineItemsTable).values({
    invoiceId: invoice.id,
    description: "Once-off registration contribution",
    quantity: 1,
    unitAmount: ONCEOFF_AMOUNT,
    amount: ONCEOFF_AMOUNT,
  });

  return invoice;
}
