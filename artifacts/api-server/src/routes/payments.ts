// Payments tracking: manual recording + bank-statement (FNB CSV export) bulk
// import matching. Every payment created here is a row in `payments`; an
// invoice's status (unpaid/partial/paid) is fully derived from the sum of
// its payments (see recomputeInvoiceStatus in invoices.ts) — nothing here
// sets "paid" directly.
//
// The CSV matcher mirrors the manual reconciliation approach used on
// 2026-08-05 (KCEA_Payments_Reconciliation_2026-08-05.xlsx): match a bank
// transaction description against "<street name> <house number>" (or the
// reverse order) found anywhere in the description, case-insensitive. Rows
// that don't confidently match go to "needsReview" for a human to match by
// hand — never guessed at.
import { Router } from "express";
import { db, invoicesTable, commitmentsTable, paymentsTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { isAdminReq } from "../lib/admin-auth";
import { recomputeInvoiceStatus } from "./invoices";

const router = Router();

function adminUsername(req: { headers: Record<string, unknown> }): string {
  const v = req.headers["x-admin-username"];
  return typeof v === "string" && v ? v : "admin";
}

// ── Manual record / undo ─────────────────────────────────────────────────

// Record a payment against an invoice — admin only.
// Body: { invoiceId, amount, paymentDate?, method?, reference?, notes? }
router.post("/payments", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const invoiceId = typeof body.invoiceId === "number" && Number.isInteger(body.invoiceId) ? body.invoiceId : null;
  const amount = typeof body.amount === "number" && body.amount > 0 ? Math.round(body.amount) : null;
  if (!invoiceId || !amount) {
    res.status(400).json({ error: "invoiceId and a positive amount are required" });
    return;
  }
  const paymentDate = typeof body.paymentDate === "string" && body.paymentDate ? new Date(body.paymentDate) : new Date();
  if (isNaN(paymentDate.getTime())) {
    res.status(400).json({ error: "Invalid paymentDate" });
    return;
  }
  const method = typeof body.method === "string" && body.method.trim() ? body.method.trim() : "EFT";
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
      .values({ invoiceId, amount, paymentDate, method, reference, notes, source: "manual", recordedBy: adminUsername(req) })
      .returning();

    await recomputeInvoiceStatus(invoiceId);
    const [updatedInvoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    res.status(201).json({ payment, invoice: updatedInvoice });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to record payment" });
  }
});

// Undo a payment — admin only. Recomputes the invoice status afterwards
// (e.g. a "paid" invoice reverts to "unpaid"/"partial" automatically).
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
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete payment" });
  }
});

// ── Bank statement CSV import ────────────────────────────────────────────

interface ParsedRow {
  rowIndex: number;
  date: string | null;
  description: string;
  amount: number | null;
}

// Minimal, dependency-free CSV parser (handles quoted fields with embedded
// commas). FNB's export uses simple comma-separated columns with an
// optional header row.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some(f => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some(f => f.trim() !== "")) rows.push(row);
  return rows;
}

// Column detection is intentionally loose — bank export formats vary. Looks
// for a header row containing recognisable column names; if none is found,
// assumes date/description/amount are the first three columns. Verify
// against a real FNB export before relying on this in production — flagged
// in the PR description.
function detectColumns(rows: string[][]): { dateIdx: number; descIdx: number; amountIdx: number; startRow: number } {
  const headerCandidates = ["date", "description", "amount", "money in", "credit", "deposit", "narrative"];
  const first = rows[0]?.map(c => c.trim().toLowerCase()) ?? [];
  const looksLikeHeader = first.some(c => headerCandidates.some(h => c.includes(h)));
  if (!looksLikeHeader) {
    return { dateIdx: 0, descIdx: 1, amountIdx: 2, startRow: 0 };
  }
  const dateIdx = first.findIndex(c => c.includes("date"));
  const descIdx = first.findIndex(c => c.includes("description") || c.includes("narrative") || c.includes("detail"));
  const amountIdx = first.findIndex(c => c.includes("amount") || c.includes("money in") || c.includes("credit") || c.includes("deposit"));
  return {
    dateIdx: dateIdx >= 0 ? dateIdx : 0,
    descIdx: descIdx >= 0 ? descIdx : 1,
    amountIdx: amountIdx >= 0 ? amountIdx : 2,
    startRow: 1,
  };
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return Math.round(n);
}

interface MatchCandidate {
  commitmentId: number;
  fullName: string;
  street: string;
  houseNumber: string;
  invoiceId: number | null;
  invoiceNumber: string | null;
  balanceDue: number | null;
}

function findMatch(
  description: string,
  commitments: { id: number; fullName: string; street: string; houseNumber: string }[],
): { id: number; fullName: string; street: string; houseNumber: string } | null {
  const desc = description.toLowerCase();
  let best: { id: number; fullName: string; street: string; houseNumber: string } | null = null;
  let bestLen = 0;
  for (const c of commitments) {
    const street = c.street.toLowerCase().trim();
    const house = c.houseNumber.toLowerCase().trim();
    if (!street || !house) continue;
    const houseWordMatch = new RegExp(`(^|[^0-9])${house.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`).test(desc);
    if (desc.includes(street) && houseWordMatch && street.length > bestLen) {
      best = c;
      bestLen = street.length;
    }
  }
  return best;
}

// Preview a bank statement CSV — admin only. Body: { csv: string }.
// Matches each credit row to a household by street + house number found in
// the description, then to that household's oldest non-paid invoice.
router.post("/payments/import-preview", async (req, res) => {
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

    const parsed: ParsedRow[] = rows.slice(startRow).map((r, i) => ({
      rowIndex: startRow + i,
      date: r[dateIdx]?.trim() || null,
      description: r[descIdx]?.trim() || "",
      amount: parseAmount(r[amountIdx]),
    }));
    // Only positive amounts (money in) are payments — bank fees / debits are
    // excluded, same as the 2026-08-05 manual reconciliation.
    const credits = parsed.filter(r => r.amount !== null && r.amount > 0 && r.description);

    const commitments = await db
      .select({ id: commitmentsTable.id, fullName: commitmentsTable.fullName, street: commitmentsTable.street, houseNumber: commitmentsTable.houseNumber })
      .from(commitmentsTable);

    const openInvoicesByCommitment = new Map<number, { id: number; invoiceNumber: string; balanceDue: number }[]>();
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(and(sql`${invoicesTable.commitmentId} is not null`, sql`${invoicesTable.status} in ('unpaid', 'partial', 'overdue')`));
    for (const inv of invoices) {
      if (inv.commitmentId === null) continue;
      const list = openInvoicesByCommitment.get(inv.commitmentId) ?? [];
      list.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, balanceDue: inv.total });
      openInvoicesByCommitment.set(inv.commitmentId, list);
    }
    // Oldest-first per commitment (id ascending is a reasonable proxy for
    // creation order given invoices are never renumbered).
    for (const list of openInvoicesByCommitment.values()) list.sort((a, b) => a.id - b.id);

    const matched: (ParsedRow & { candidate: MatchCandidate })[] = [];
    const needsReview: ParsedRow[] = [];

    for (const row of credits) {
      const match = findMatch(row.description, commitments);
      if (!match) {
        needsReview.push(row);
        continue;
      }
      const openInvoice = openInvoicesByCommitment.get(match.id)?.[0] ?? null;
      matched.push({
        ...row,
        candidate: {
          commitmentId: match.id,
          fullName: match.fullName,
          street: match.street,
          houseNumber: match.houseNumber,
          invoiceId: openInvoice?.id ?? null,
          invoiceNumber: openInvoice?.invoiceNumber ?? null,
          balanceDue: openInvoice?.balanceDue ?? null,
        },
      });
    }

    res.json({
      totalRows: parsed.length,
      creditRows: credits.length,
      matchedCount: matched.length,
      needsReviewCount: needsReview.length,
      matched,
      needsReview,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to parse/preview statement" });
  }
});

// Confirm a batch of matched rows from the preview — admin only. Body:
// { rows: [{ invoiceId, amount, date?, description? }] } — exactly the rows
// the admin kept (any they excluded from the preview are simply omitted).
router.post("/payments/import-confirm", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const rowsInput = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];
  if (rowsInput.length === 0) {
    res.status(400).json({ error: "rows must be a non-empty array" });
    return;
  }

  const created: number[] = [];
  const skipped: { row: unknown; reason: string }[] = [];
  const recordedBy = adminUsername(req);
  const touchedInvoiceIds = new Set<number>();

  try {
    for (const r of rowsInput) {
      const invoiceId = typeof r.invoiceId === "number" && Number.isInteger(r.invoiceId) ? r.invoiceId : null;
      const amount = typeof r.amount === "number" && r.amount > 0 ? Math.round(r.amount) : null;
      if (!invoiceId || !amount) {
        skipped.push({ row: r, reason: "Missing invoiceId or a positive amount" });
        continue;
      }
      const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
      if (!invoice) {
        skipped.push({ row: r, reason: "Invoice not found" });
        continue;
      }
      const paymentDate = typeof r.date === "string" && r.date ? new Date(r.date) : new Date();
      const reference = typeof r.description === "string" ? r.description.slice(0, 500) : null;

      const [payment] = await db
        .insert(paymentsTable)
        .values({
          invoiceId,
          amount,
          paymentDate: isNaN(paymentDate.getTime()) ? new Date() : paymentDate,
          method: "EFT",
          reference,
          source: "bank_import",
          recordedBy,
        })
        .returning();
      created.push(payment.id);
      touchedInvoiceIds.add(invoiceId);
    }

    for (const invoiceId of touchedInvoiceIds) {
      await recomputeInvoiceStatus(invoiceId);
    }

    res.status(201).json({ createdCount: created.length, created, skippedCount: skipped.length, skipped });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to confirm import" });
  }
});

export default router;
