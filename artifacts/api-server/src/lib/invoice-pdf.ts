import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// Builds a branded PDF invoice as an in-memory buffer, for attaching to the
// "Email all" send (see routes/invoices.ts). Uses pdf-lib rather than pdfkit
// because pdfkit reads its font metrics from .afm files on disk at runtime via
// a __dirname-relative path — that breaks once esbuild bundles this into a
// single dist/index.mjs (see build.mjs). pdf-lib embeds its standard fonts
// directly, no filesystem reads, so it survives bundling untouched.

export interface InvoicePdfLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

export interface InvoicePdfInput {
  invoiceNumber: string;
  billToName: string;
  billToStreet: string | null;
  billToHouseNumber: string | null;
  invoiceDate: Date;
  dueDate: Date;
  lineItems: InvoicePdfLineItem[];
  subtotal: number;
  total: number;
}

// #FA0377, KCEA's brand pink (see index.css --primary).
const BRAND_PINK = rgb(0.98, 0.01, 0.47);
const DARK = rgb(0.06, 0.06, 0.06);
const GRAY = rgb(0.45, 0.45, 0.45);
const LIGHT_GRAY = rgb(0.88, 0.88, 0.88);
const PANEL_GRAY = rgb(0.97, 0.97, 0.97);
const WHITE = rgb(1, 1, 1);

function formatRand(amount: number): string {
  return `R${Math.round(amount).toLocaleString("en-ZA")}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  // ── Header band ──────────────────────────────────────────────
  const headerHeight = 100;
  page.drawRectangle({ x: 0, y: height - headerHeight, width, height: headerHeight, color: BRAND_PINK });
  page.drawText("KCEA", { x: 40, y: height - 45, size: 24, font: bold, color: WHITE });
  page.drawText("Kensington Central Enclosure Association", {
    x: 40,
    y: height - 65,
    size: 9,
    font: regular,
    color: WHITE,
  });
  const invoiceLabel = "INVOICE";
  const invoiceLabelWidth = bold.widthOfTextAtSize(invoiceLabel, 20);
  page.drawText(invoiceLabel, { x: width - 40 - invoiceLabelWidth, y: height - 45, size: 20, font: bold, color: WHITE });

  let y = height - headerHeight - 40;

  // ── Invoice meta row ─────────────────────────────────────────
  const col1 = 40,
    col2 = 230,
    col3 = 400;
  page.drawText("INVOICE NUMBER", { x: col1, y, size: 8, font: bold, color: GRAY });
  page.drawText("INVOICE DATE", { x: col2, y, size: 8, font: bold, color: GRAY });
  page.drawText("DUE DATE", { x: col3, y, size: 8, font: bold, color: GRAY });
  y -= 14;
  page.drawText(input.invoiceNumber, { x: col1, y, size: 11, font: bold, color: DARK });
  page.drawText(formatDate(input.invoiceDate), { x: col2, y, size: 11, font: regular, color: DARK });
  page.drawText(formatDate(input.dueDate), { x: col3, y, size: 11, font: regular, color: DARK });

  y -= 40;

  // ── Bill to ──────────────────────────────────────────────────
  page.drawText("BILL TO", { x: col1, y, size: 8, font: bold, color: GRAY });
  y -= 14;
  page.drawText(input.billToName, { x: col1, y, size: 12, font: bold, color: DARK });
  y -= 16;
  const addressLine = [input.billToHouseNumber, input.billToStreet].filter(Boolean).join(" ");
  if (addressLine) {
    page.drawText(addressLine, { x: col1, y, size: 10, font: regular, color: GRAY });
    y -= 16;
  }

  y -= 20;

  // ── Line items table ─────────────────────────────────────────
  const tableTop = y;
  page.drawRectangle({ x: 40, y: tableTop - 22, width: width - 80, height: 22, color: PANEL_GRAY });
  page.drawText("DESCRIPTION", { x: 48, y: tableTop - 15, size: 9, font: bold, color: GRAY });
  page.drawText("QTY", { x: 380, y: tableTop - 15, size: 9, font: bold, color: GRAY });
  page.drawText("UNIT", { x: 430, y: tableTop - 15, size: 9, font: bold, color: GRAY });
  page.drawText("AMOUNT", { x: 500, y: tableTop - 15, size: 9, font: bold, color: GRAY });

  y = tableTop - 22;

  for (const item of input.lineItems) {
    y -= 26;
    page.drawText(item.description, { x: 48, y, size: 10, font: regular, color: DARK });
    page.drawText(String(item.quantity), { x: 385, y, size: 10, font: regular, color: DARK });
    page.drawText(formatRand(item.unitAmount), { x: 430, y, size: 10, font: regular, color: DARK });
    page.drawText(formatRand(item.amount), { x: 500, y, size: 10, font: regular, color: DARK });
    page.drawLine({ start: { x: 40, y: y - 8 }, end: { x: width - 40, y: y - 8 }, thickness: 0.5, color: LIGHT_GRAY });
  }

  y -= 30;

  // ── Totals ───────────────────────────────────────────────────
  const totalLabelX = 400;
  const totalValueX = 500;
  page.drawText("Subtotal", { x: totalLabelX, y, size: 10, font: regular, color: GRAY });
  page.drawText(formatRand(input.subtotal), { x: totalValueX, y, size: 10, font: regular, color: DARK });
  y -= 18;
  page.drawLine({ start: { x: totalLabelX, y: y + 10 }, end: { x: width - 40, y: y + 10 }, thickness: 0.5, color: LIGHT_GRAY });
  page.drawText("Total due", { x: totalLabelX, y, size: 12, font: bold, color: DARK });
  page.drawText(formatRand(input.total), { x: totalValueX, y, size: 12, font: bold, color: BRAND_PINK });

  y -= 50;

  // ── Banking details ──────────────────────────────────────────
  page.drawRectangle({ x: 40, y: y - 90, width: width - 80, height: 90, color: PANEL_GRAY });
  let by = y - 16;
  page.drawText("BANKING DETAILS", { x: 52, y: by, size: 8, font: bold, color: GRAY });
  by -= 16;
  page.drawText("Kensington Central Enclosure Association", { x: 52, y: by, size: 10, font: bold, color: DARK });
  by -= 14;
  page.drawText("FNB Gold Business Account", { x: 52, y: by, size: 9, font: regular, color: DARK });
  by -= 14;
  page.drawText("Account number: 63213323693   Branch code: 250655", { x: 52, y: by, size: 9, font: regular, color: DARK });
  by -= 14;
  const reference = [input.billToHouseNumber, input.billToStreet].filter(Boolean).join(" ") || input.billToName;
  page.drawText(`Reference: ${reference}`, { x: 52, y: by, size: 9, font: bold, color: DARK });

  y -= 110;

  // ── Footer ───────────────────────────────────────────────────
  page.drawText(
    "Questions? Contact your street captain, or message KCEA on WhatsApp before paying if anything looks off.",
    { x: 40, y, size: 8, font: regular, color: GRAY },
  );
  y -= 12;
  page.drawText("We'll never ask for passwords, card numbers, or bank details by email.", {
    x: 40,
    y,
    size: 8,
    font: regular,
    color: GRAY,
  });

  return doc.save();
}
