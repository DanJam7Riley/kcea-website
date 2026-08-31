import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { getOrCreateSettings } from "./settings";
import { resolveMonthRange, getEligibleMonthlyCommitments, createMonthlyInvoice } from "./invoice-generation";
import { sendInvoiceEmail } from "./invoice-email";

// Runs entirely in-process on kcea-api (a paid Starter Render service that
// doesn't sleep/scale-to-zero, unlike the free tier) rather than as a
// separate Render Cron Job — no new infra to provision, and the existing
// getOrCreateSettings()/db connection are already warmed up here.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly is plenty for a once-a-month trigger
const AUTO_RUN_DAY_OF_MONTH = 25;
const SEND_THROTTLE_MS = 400; // same Resend rate-limit gap as the manual send-all route

// "YYYY-MM" for the month AFTER whatever "now" is, computed in South African
// local time (Africa/Johannesburg, UTC+2, no DST) regardless of the server's
// own timezone — Render's containers run in UTC.
function nextMonthKeyInSAST(now: Date): string {
  const sastNow = new Date(now.getTime() + 2 * 60 * 60 * 1000); // UTC+2, fixed offset, no DST in SA
  const y = sastNow.getUTCFullYear();
  const m = sastNow.getUTCMonth(); // 0-indexed "this" month
  const nextY = m === 11 ? y + 1 : y;
  const nextM = m === 11 ? 0 : m + 1;
  return `${nextY}-${String(nextM + 1).padStart(2, "0")}`;
}

function dayOfMonthInSAST(now: Date): number {
  const sastNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return sastNow.getUTCDate();
}

// Generates + immediately emails every eligible monthly household's invoice
// for next month. Fully automatic (no admin review step) per Janine's
// explicit choice — relies on the delivery-status webhook (see
// resend-webhook.ts) to surface anything that goes wrong afterward, since
// there's no human in the loop to catch a bad batch before it sends.
async function runAutoInvoiceForNextMonth(monthKey: string): Promise<void> {
  const range = resolveMonthRange(monthKey);
  const eligible = await getEligibleMonthlyCommitments(range);

  logger.info({ monthKey, eligibleCount: eligible.length }, "25th-of-month auto-invoice run starting");

  let generated = 0;
  let sent = 0;
  let sendFailed = 0;

  for (const commitment of eligible) {
    try {
      const invoice = await createMonthlyInvoice(commitment, range, "auto:scheduled-25th");
      generated++;

      if (generated + sendFailed > 1) {
        await new Promise(r => setTimeout(r, SEND_THROTTLE_MS));
      }
      const result = await sendInvoiceEmail(invoice.id);
      if (result.ok) {
        sent++;
      } else {
        sendFailed++;
        logger.warn({ invoiceId: invoice.id, commitmentId: commitment.id, reason: result.reason }, "Auto-invoice email failed to send");
      }
    } catch (err) {
      logger.error({ err, commitmentId: commitment.id }, "Auto-invoice generation failed for a commitment — continuing with the rest");
    }
  }

  logger.info({ monthKey, generated, sent, sendFailed }, "25th-of-month auto-invoice run complete");
}

export async function runMonthlyAutoInvoiceIfDue(): Promise<void> {
  const now = new Date();
  if (dayOfMonthInSAST(now) !== AUTO_RUN_DAY_OF_MONTH) return;

  const targetMonthKey = nextMonthKeyInSAST(now);
  const settings = await getOrCreateSettings();
  if (settings.lastAutoInvoiceRunMonth === targetMonthKey) return; // already ran today/this cycle

  try {
    await runAutoInvoiceForNextMonth(targetMonthKey);
    await db.update(siteSettingsTable).set({ lastAutoInvoiceRunMonth: targetMonthKey, updatedAt: new Date() }).where(eq(siteSettingsTable.id, settings.id));
  } catch (err) {
    logger.error({ err, targetMonthKey }, "25th-of-month auto-invoice run failed outright — will retry on the next hourly check");
    // Deliberately does NOT update lastAutoInvoiceRunMonth on outright failure,
    // so the next hourly check (still the 25th) retries rather than silently
    // skipping the whole month.
  }
}

export function startScheduledInvoicing(): void {
  setInterval(() => {
    void runMonthlyAutoInvoiceIfDue();
  }, CHECK_INTERVAL_MS);
  // Also check once at startup — covers the case where kcea-api happens to
  // restart on the 25th after the last hourly check already passed.
  void runMonthlyAutoInvoiceIfDue();
}
