import { db, invoicesTable, invoiceLineItemsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail } from "./email";
import { buildInvoicePdf } from "./invoice-pdf";
import { makeStatementToken } from "../routes/statement";
import { logCommunication } from "../routes/communications";

const SITE_URL = process.env.PUBLIC_SITE_URL ?? "https://www.kcea.co.za";

function statementLink(commitmentId: number | null): string {
  if (!commitmentId) return "";
  return `${SITE_URL}/statement?id=${commitmentId}&t=${makeStatementToken(commitmentId)}`;
}

export const isUsableEmail = (e: string | null | undefined): boolean => !!e && e.trim() !== "";

// Sends one invoice's email — the single code path used by the manual
// send-all route, the manual send-test route, new-signup auto-send, and the
// 25th-of-month auto-run, so every sender behaves identically and every send
// gets its Resend id stored the same way (needed for the delivery-status
// webhook to match events back to the right invoice).
export async function sendInvoiceEmail(invoiceId: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!inv) return { ok: false, reason: "invoice_not_found" };
  if (!isUsableEmail(inv.billToEmail)) return { ok: false, reason: "no_email_on_file" };

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
  } catch {
    // Falls back to sending without the attachment — a PDF rendering bug
    // shouldn't block the invoice email itself.
  }

  const result = await sendEmail(inv.billToEmail as string, subject, text, attachments);
  if (result.ok) {
    await db
      .update(invoicesTable)
      .set({ emailSentAt: new Date(), resendEmailId: result.id || null, deliveryStatus: "sent", deliveryStatusUpdatedAt: new Date() })
      .where(eq(invoicesTable.id, inv.id));
    if (inv.commitmentId) {
      await logCommunication({ commitmentId: inv.commitmentId, type: "invoice", subject, recipient: inv.billToEmail as string });
    }
    return { ok: true };
  }
  return { ok: false, reason: result.reason };
}
