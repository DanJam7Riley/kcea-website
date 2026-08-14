import { Router } from "express";
import { db, invoicesTable, invoiceLineItemsTable, commitmentsTable, paymentsTable } from "@workspace/db";
import { eq, desc, sql, and, isNull } from "drizzle-orm";
import { isAdminReq, adminRoleFromHeaders, PRIMARY_USERNAME, SECONDARY_USERNAME } from "../lib/admin-auth";
import { sendEmail } from "../lib/email";
import { buildInvoicePdf } from "../lib/invoice-pdf";
import { makeStatementToken } from "./statement";

const SITE_URL = process.env.PUBLIC_SITE_URL ?? "https://www.kcea.co.za";

// Link to a resident's self-service statement (invoice history + payments +
// running balance) — included in every invoice email so residents can check
// what they owe/have paid themselves instead of asking KCEA to resend
// something. No-op (empty string) if the invoice has no linked commitment
// (e.g. a manually created one-off invoice with no commitmentId).
function statementLink(commitmentId: number | null): string {
  if (!commitmentId) return "";
  return `${SITE_URL}/statement?id=${commitmentId}&t=${makeStatementToken(commitmentId)}`;
}

const router = Router();

// Derived status, per the 2026-07-31 decision: "paid" is never set by hand —
// it (and "partial") come purely from the sum of recorded payments vs total.
// "draft" and "cancelled" stay fully admin-controlled (a cancelled invoice
// with a payment recorded against it is an edge case for a human to resolve,
// not something this function should silently override).
export function deriveInvoiceStatus(currentStatus: string, totalPaid: number, total: number): string {
  if (currentStatus === "draft" || currentStatus === "cancelled") return currentStatus;
  if (totalPaid <= 0) return "unpaid";
  if (totalPaid >= total) return "paid";
  return "partial";
}

export async function recomputeInvoiceStatus(invoiceId: number): Promise<void> {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!invoice) return;
  const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.invoiceId, invoiceId));
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const status = deriveInvoiceStatus(invoice.status, totalPaid, invoice.total);
  if (status !== invoice.status) {
    await db.update(invoicesTable).set({ status, updatedAt: new Date() }).where(eq(invoicesTable.id, invoiceId));
  }
}

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

    // amountPaid per invoice, so the list view can show balances without a
    // separate fetch per row. Fetched in one query and aggregated in JS —
    // simpler than a SQL join here and fine at KCEA's invoice volume.
    const allPayments = await db.select({ invoiceId: paymentsTable.invoiceId, amount: paymentsTable.amount }).from(paymentsTable);
    const paidByInvoice = new Map<number, number>();
    for (const p of allPayments) paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + p.amount);

    res.json(rows.map(r => ({ ...r, amountPaid: paidByInvoice.get(r.id) ?? 0 })));
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

// Resolves a target billing month from an optional "YYYY-MM" string, e.g.
// catching up an unsent past month. Falls back to the current calendar month
// when omitted/invalid, which keeps every existing unparameterized caller
// working exactly as before. Returns a start/end pair (end exclusive) so the
// "already invoiced" check can't leak across month boundaries.
function resolveMonthRange(monthParam: unknown): { start: Date; end: Date; isCurrent: boolean } {
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

// Invoice date to use for a given target month: "now" for the current month
// (preserves the exact original behaviour), or the 1st of the month for a
// backdated catch-up run (e.g. generating last month's invoices today).
function invoiceDateForMonth(range: { start: Date; isCurrent: boolean }): Date {
  return range.isCurrent ? new Date() : range.start;
}

// True if an existing invoice (dated invoiceDate, covering coversMonths
// calendar months starting at invoiceDate's month) already covers the target
// month range [rangeStart, rangeEnd). Used so a multi-month invoice (e.g. 6
// months paid up front in one go) correctly blocks the normal monthly
// bulk-generate run from also billing those same months.
function invoiceCoversRange(invoiceDate: Date, coversMonths: number, rangeStart: Date, rangeEnd: Date): boolean {
  const coverStart = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth(), 1);
  const coverEnd = new Date(coverStart.getFullYear(), coverStart.getMonth() + Math.max(1, coversMonths), 1);
  return coverStart < rangeEnd && coverEnd > rangeStart;
}

// Preview — admin only. Returns every "monthly" commitment that doesn't already
// have an invoice dated in the target calendar month (defaults to this month;
// pass ?month=YYYY-MM to catch up a past month), with the rate that would be
// charged. Nothing is written here; the admin reviews/deselects in the UI, then
// confirms via bulk-generate. Once-off (R3,000) commitments are excluded by
// definition — this only ever looks at commitmentType === "monthly" (they get
// their own one-time invoice via /invoices/onceoff-preview + onceoff-generate).
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
    const { start, end } = resolveMonthRange(req.query.month);

    const monthly = await db
      .select()
      .from(commitmentsTable)
      .where(eq(commitmentsTable.commitmentType, "monthly"));

    // Fetch every non-cancelled invoice with a commitmentId and check month
    // coverage in JS (not just an exact-month SQL match) — a multi-month
    // invoice (coversMonths > 1) must also block bulk-generate for every
    // month it covers, not just the month it's dated in.
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
        .filter(r => invoiceCoversRange(new Date(r.invoiceDate), r.coversMonths, start, end))
        .map(r => r.commitmentId),
    );

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

// ── Once-off (R3,000) signups: one invoice each, ever ───────────────────────
// These residents prepaid a lump sum instead of joining the monthly cycle, but
// still need an invoice on record so their account balance matches everyone
// else's — marked "paid" immediately if we already have paymentConfirmed=true
// on their commitment, "unpaid" otherwise. Guarded so a commitment can only
// ever receive ONE invoice via this route (checked by commitmentId having any
// invoice at all, not just one this month) — safe to click more than once.
const ONCEOFF_AMOUNT = 3000;

router.get("/invoices/onceoff-preview", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const onceoff = await db
      .select()
      .from(commitmentsTable)
      .where(eq(commitmentsTable.commitmentType, "onceoff"));

    const alreadyInvoiced = await db
      .select({ commitmentId: invoicesTable.commitmentId })
      .from(invoicesTable)
      .where(sql`${invoicesTable.commitmentId} is not null`);
    const invoicedIds = new Set(alreadyInvoiced.map(r => r.commitmentId));

    const eligible = onceoff
      .filter(c => !invoicedIds.has(c.id))
      .map(c => ({
        commitmentId: c.id,
        fullName: c.fullName,
        street: c.street,
        houseNumber: c.houseNumber,
        email: c.email,
        amount: ONCEOFF_AMOUNT,
        willBeMarkedPaid: c.paymentConfirmed,
      }));

    res.json({ eligible, alreadyInvoiced: onceoff.length - eligible.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to build once-off invoice preview" });
  }
});

router.post("/invoices/onceoff-generate", async (req, res) => {
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
  const createdBy = createdByFromReq(req.headers as Record<string, unknown>);

  try {
    for (const commitmentId of commitmentIds) {
      const [commitment] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, commitmentId));
      if (!commitment) {
        skipped.push({ commitmentId, reason: "Commitment not found" });
        continue;
      }
      if (commitment.commitmentType !== "onceoff") {
        skipped.push({ commitmentId, reason: "Not a once-off commitment" });
        continue;
      }
      const [existing] = await db
        .select({ id: invoicesTable.id })
        .from(invoicesTable)
        .where(sql`${invoicesTable.commitmentId} = ${commitmentId}`);
      if (existing) {
        skipped.push({ commitmentId, reason: "Already has an invoice on record" });
        continue;
      }

      // Dated to when they actually committed/paid, not today — this is a
      // record of a past payment, not a new charge.
      const invoiceDate = new Date(commitment.submittedAt);
      const dueDate = new Date(invoiceDate.getTime() + 15 * 24 * 60 * 60 * 1000);
      const invoiceNumber = await nextInvoiceNumber();
      const status = commitment.paymentConfirmed ? "paid" : "unpaid";

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

      created.push(invoiceNumber);
    }

    res.status(201).json({ created, skipped, createdCount: created.length, skippedCount: skipped.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to generate once-off invoices" });
  }
});

// ── Multi-month invoices ──────────────────────────────────────────────────
// Some residents ask to pay several months in one go (e.g. 6 months up
// front) rather than being invoiced monthly. This creates ONE invoice with
// one line item per covered month, dated to start at the given/next month.
// coversMonths is set on the invoice so bulk-preview/bulk-generate correctly
// skip this commitment for every month it covers (see invoiceCoversRange
// above) — the resident won't also get separately billed by the normal
// monthly run during that window.
router.post("/invoices/multi-month", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const commitmentId = typeof body.commitmentId === "number" && Number.isInteger(body.commitmentId) ? body.commitmentId : null;
  const months = typeof body.months === "number" && Number.isInteger(body.months) ? body.months : 0;
  if (!commitmentId) {
    res.status(400).json({ error: "commitmentId is required" });
    return;
  }
  if (months < 2 || months > 24) {
    res.status(400).json({ error: "months must be between 2 and 24 (use the normal single-month invoice for 1 month)" });
    return;
  }

  try {
    const [commitment] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, commitmentId));
    if (!commitment) {
      res.status(404).json({ error: "Commitment not found" });
      return;
    }
    if (commitment.commitmentType !== "monthly") {
      res.status(400).json({ error: "Not a monthly commitment (likely once-off)" });
      return;
    }

    const range = resolveMonthRange(body.startMonth);
    const invoiceDate = invoiceDateForMonth(range);

    // Refuse if any of the target months are already covered by an existing
    // (non-cancelled) invoice for this commitment — same overlap check used
    // by bulk-generate, so this can't double-bill either direction.
    const rangeEnd = new Date(range.start.getFullYear(), range.start.getMonth() + months, 1);
    const existingForCommitment = await db
      .select({ invoiceDate: invoicesTable.invoiceDate, coversMonths: invoicesTable.coversMonths })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.commitmentId, commitmentId), sql`${invoicesTable.status} != 'cancelled'`));
    const overlap = existingForCommitment.some(r =>
      invoiceCoversRange(new Date(r.invoiceDate), r.coversMonths, range.start, rangeEnd),
    );
    if (overlap) {
      res.status(409).json({ error: "One or more of the target months already has an invoice on record for this household" });
      return;
    }

    const rate = monthlyRateForStreet(commitment.street);
    const dueDate = new Date(invoiceDate.getTime() + 15 * 24 * 60 * 60 * 1000);
    const invoiceNumber = await nextInvoiceNumber();
    const total = rate * months;

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
        subtotal: total,
        total,
        notes: `Covers ${months} months of household contributions in one invoice.`,
        createdBy: createdByFromReq(req.headers as Record<string, unknown>),
        coversMonths: months,
      })
      .returning();

    const lineItems = Array.from({ length: months }, (_, i) => {
      const monthDate = new Date(range.start.getFullYear(), range.start.getMonth() + i, 1);
      const label = monthDate.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
      return { invoiceId: invoice.id, description: `Monthly household contribution — ${label}`, quantity: 1, unitAmount: rate, amount: rate };
    });
    await db.insert(invoiceLineItemsTable).values(lineItems);

    const savedItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id));
    res.status(201).json({ ...invoice, lineItems: savedItems });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to generate multi-month invoice" });
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
//
// Processes at most BATCH_SIZE invoices per call instead of every unsent
// invoice in one go. A single request sending hundreds of emails sequentially
// (each one an awaited call to Resend) can run long enough to hit the
// platform's request timeout — the client sees a hung "Sending..." with no
// result, and a second click risks a second in-flight run touching invoices
// the first hasn't marked emailSentAt on yet. Batching keeps each request
// short and bounded; the frontend calls this repeatedly (using `remaining`)
// until it hits 0. Safe to call in any order, any number of times — each
// invoice still only ever gets emailed once.
const SEND_ALL_BATCH_SIZE = 40;

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
    const allUnsent = await db
      .select()
      .from(invoicesTable)
      .where(and(sql`${invoicesTable.status} != 'cancelled'`, isNull(invoicesTable.emailSentAt)));

    const rows = allUnsent.slice(0, SEND_ALL_BATCH_SIZE);
    const remaining = Math.max(0, allUnsent.length - rows.length);

    let sent = 0;
    let skippedNoEmail = 0;
    let failed = 0;
    // First few distinct failure reasons, surfaced to the caller — without
    // this, a systemic problem (e.g. hitting Resend's rate limit) just shows
    // up as an opaque "40 failed" with no way to tell what actually broke.
    const failureReasons: string[] = [];

    for (const inv of rows) {
      if (!isUsableEmail(inv.billToEmail)) {
        skippedNoEmail++;
        continue;
      }
      // Resend rate-limits by requests/second; firing 40 sends back-to-back
      // in a tight loop can blow through that and fail the whole batch. A
      // small gap between sends keeps us under it without slowing things
      // down much (40 invoices ≈ 16s per batch).
      if (sent + failed > 0) {
        await new Promise(r => setTimeout(r, 400));
      }
      const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, inv.id));
      const itemsText = lineItems.map(li => `- ${li.description} x${li.quantity}: R${li.amount.toLocaleString("en-ZA")}`).join("\n");
      const dueDateStr = new Date(inv.dueDate).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
      const reference = [inv.billToHouseNumber, inv.billToStreet].filter(Boolean).join(" ") || inv.billToName;

      const subject = `KCEA invoice ${inv.invoiceNumber}`;
      const text =
        `Hi ${inv.billToName},\n\n` +
        `Here's your KCEA invoice ${inv.invoiceNumber} — a PDF copy is attached.\n\n` +
        `${itemsText}\n\n` +
        `Total due: R${inv.total.toLocaleString("en-ZA")}\n` +
        `Due date: ${dueDateStr}\n\n` +
        `Banking details:\n` +
        `Kensington Central Enclosure Association\n` +
        `FNB Gold Business Account\n` +
        `Account number: 63213323693\n` +
        `Branch code: 250655\n` +
        `Reference: ${reference}\n\n` +
        `If you've already paid this, please ignore this email.\n\n` +
        (statementLink(inv.commitmentId)
          ? `View your full statement (all invoices, payments, and balance) any time: ${statementLink(inv.commitmentId)}\n\n`
          : "") +
        `Questions? Contact your street captain, or message KCEA on WhatsApp before paying if anything looks off. ` +
        `We'll never ask for passwords, card numbers, or bank details by email.\n\n` +
        `— KCEA`;

      // Build the PDF attachment. If generation fails for any reason, fall
      // back to sending the plain-text email rather than blocking the whole
      // invoice on a rendering bug — matches the resilient style of the rest
      // of this route (a bad invoice shouldn't stall the batch).
      let attachments: { filename: string; content: string }[] | undefined;
      try {
        const pdfBytes = await buildInvoicePdf({
          invoiceNumber: inv.invoiceNumber,
          billToName: inv.billToName,
          billToStreet: inv.billToStreet,
          billToHouseNumber: inv.billToHouseNumber,
          invoiceDate: new Date(inv.invoiceDate),
          dueDate: new Date(inv.dueDate),
          lineItems: lineItems.map(li => ({
            description: li.description,
            quantity: li.quantity,
            unitAmount: li.unitAmount,
            amount: li.amount,
          })),
          subtotal: inv.subtotal,
          total: inv.total,
        });
        attachments = [{ filename: `${inv.invoiceNumber}.pdf`, content: Buffer.from(pdfBytes).toString("base64") }];
      } catch (pdfErr) {
        req.log.warn({ invoiceId: inv.id, err: pdfErr }, "PDF generation failed — sending without attachment");
      }

      const result = await sendEmail(inv.billToEmail as string, subject, text, attachments);
      if (result.ok) {
        await db.update(invoicesTable).set({ emailSentAt: new Date() }).where(eq(invoicesTable.id, inv.id));
        sent++;
      } else {
        req.log.warn({ invoiceId: inv.id, reason: result.reason }, "Invoice email failed to send");
        failed++;
        if (!failureReasons.includes(result.reason) && failureReasons.length < 3) {
          failureReasons.push(result.reason);
        }
      }
    }

    res.json({ sent, skippedNoEmail, failed, remaining, failureReasons });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Send batch failed" });
  }
});

// Send a test copy of ONE invoice (with PDF attached) to any email address —
// admin only. Deliberately does NOT touch emailSentAt, so a test send never
// counts as "sent" and can't cause the real invoice to be skipped by
// /invoices/send-all — safe to click as many times as needed while checking
// the PDF looks right before running the real batch. Body: { email: string }
router.post("/invoices/:id/send-test", async (req, res) => {
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
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  try {
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!inv) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, inv.id));
    const itemsText = lineItems.map(li => `- ${li.description} x${li.quantity}: R${li.amount.toLocaleString("en-ZA")}`).join("\n");
    const dueDateStr = new Date(inv.dueDate).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
    const reference = [inv.billToHouseNumber, inv.billToStreet].filter(Boolean).join(" ") || inv.billToName;

    const subject = `[TEST] KCEA invoice ${inv.invoiceNumber}`;
    const text =
      `TEST SEND — this is a preview copy for checking the layout/PDF, not a real invoice notice.\n\n` +
      `Hi ${inv.billToName},\n\n` +
      `Here's your KCEA invoice ${inv.invoiceNumber} — a PDF copy is attached.\n\n` +
      `${itemsText}\n\n` +
      `Total due: R${inv.total.toLocaleString("en-ZA")}\n` +
      `Due date: ${dueDateStr}\n\n` +
      `Banking details:\n` +
      `Kensington Central Enclosure Association\n` +
      `FNB Gold Business Account\n` +
      `Account number: 63213323693\n` +
      `Branch code: 250655\n` +
      `Reference: ${reference}\n\n` +
      `If you've already paid this, please ignore this email.\n\n` +
      (statementLink(inv.commitmentId)
        ? `View your full statement (all invoices, payments, and balance) any time: ${statementLink(inv.commitmentId)}\n\n`
        : "") +
      `— KCEA`;

    // Same resilient pattern as send-all: a PDF failure shouldn't block the
    // test send outright — the caller needs to know the email itself works,
    // and the response reports whether the PDF actually attached.
    let attachments: { filename: string; content: string }[] | undefined;
    let pdfError: string | undefined;
    try {
      const pdfBytes = await buildInvoicePdf({
        invoiceNumber: inv.invoiceNumber,
        billToName: inv.billToName,
        billToStreet: inv.billToStreet,
        billToHouseNumber: inv.billToHouseNumber,
        invoiceDate: new Date(inv.invoiceDate),
        dueDate: new Date(inv.dueDate),
        lineItems: lineItems.map(li => ({
          description: li.description,
          quantity: li.quantity,
          unitAmount: li.unitAmount,
          amount: li.amount,
        })),
        subtotal: inv.subtotal,
        total: inv.total,
      });
      attachments = [{ filename: `${inv.invoiceNumber}.pdf`, content: Buffer.from(pdfBytes).toString("base64") }];
    } catch (pdfErr) {
      req.log.warn({ invoiceId: inv.id, err: pdfErr }, "Test send: PDF generation failed");
      pdfError = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
    }

    const result = await sendEmail(email, subject, text, attachments);
    if (!result.ok) {
      res.status(502).json({ error: `Send failed: ${result.reason}`, pdfAttached: !!attachments, pdfError });
      return;
    }
    res.json({ ok: true, pdfAttached: !!attachments, pdfError });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to send test invoice" });
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
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.invoiceId, id))
      .orderBy(desc(paymentsTable.paymentDate));
    const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
    res.json({ ...invoice, lineItems, payments, amountPaid, balanceDue: Math.max(0, invoice.total - amountPaid) });
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

// Generate — admin only. Body: { commitmentIds: number[], month? } — exactly
// the set the admin kept after reviewing the preview (anyone they unchecked,
// e.g. a once-off payer that slipped through, is simply left out). Pass the
// same month ("YYYY-MM") used on the bulk-preview call to catch up a past
// month; omit it for the current month (unchanged default behaviour).
// Re-checks eligibility per ID so nothing gets double-invoiced even if the
// preview is stale.
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
  const range = resolveMonthRange(body.month);
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
      const existingForCommitment = await db
        .select({ invoiceDate: invoicesTable.invoiceDate, coversMonths: invoicesTable.coversMonths })
        .from(invoicesTable)
        .where(and(eq(invoicesTable.commitmentId, commitmentId), sql`${invoicesTable.status} != 'cancelled'`));
      const alreadyCovered = existingForCommitment.some(r =>
        invoiceCoversRange(new Date(r.invoiceDate), r.coversMonths, range.start, range.end),
      );
      if (alreadyCovered) {
        skipped.push({ commitmentId, reason: "Already invoiced for that month" });
        continue;
      }

      const rate = monthlyRateForStreet(commitment.street);
      const invoiceDate = invoiceDateForMonth(range);
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

// Update status only — admin only. Body: { status: "draft"|"unpaid"|"overdue"|"cancelled" }
// "paid"/"partial" are NOT settable here as of the payments-tracking feature —
// per the 2026-07-31 decision, those are derived purely from recorded
// payments (see recomputeInvoiceStatus above, called from payments.ts).
// Record a payment to move an invoice to paid/partial instead.
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
      error: `status must be one of: ${validStatuses.join(", ")} (paid/partial are set automatically by recording a payment)`,
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

// Delete — admin only. Hard delete (line items cascade via FK). For cleaning up
// test invoices or bulk-generate mistakes (e.g. a once-off payer that slipped
// through) — per KCEA's own instruction that removal should mean gone, not
// just hidden as "cancelled". Blocked on any invoice with a payment recorded
// against it (2026-07-31 decision) — protects the audit trail; delete the
// payment first (DELETE /payments/:id) if it was genuinely a mistake.
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
    const [existingPayment] = await db.select({ id: paymentsTable.id }).from(paymentsTable).where(eq(paymentsTable.invoiceId, id));
    if (existingPayment) {
      res.status(409).json({ error: "Cannot delete an invoice with a payment recorded against it — delete the payment first." });
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
