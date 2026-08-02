// One-click confirmation for residents who signed a KCEA paper consent form
// in 2025 (17 street consent-form spreadsheets, ~488 households) but were
// never captured on the live site. Those rows are bulk-imported via the
// existing admin "Import CSV" flow (POST /api/commitments/import), which
// leaves them with commitmentType "monthly", imported=true, and — because
// the schema now has these columns — identityConfirmedAt/legacyConfirmEmailSentAt
// both NULL.
//
// This file adds:
//   GET  /api/commitments/:id/confirm-info?t=TOKEN   (public, token-gated)
//   POST /api/commitments/:id/confirm-identity?t=TOKEN (public, token-gated)
//   GET  /api/commitments/legacy-unconfirmed          (admin only — preview/count)
//   POST /api/commitments/legacy-unconfirmed/send     (admin only — actually emails people)
//
// Token scheme deliberately mirrors the existing /commitments/:id/public
// self-update flow in commitments.ts: an HMAC of the record id, keyed by
// SESSION_SECRET. No separate tokens table needed — the token is
// deterministic and stateless, and can't be forged without the secret.
//
// IMPORTANT: /legacy-unconfirmed/send is the only thing in this file that
// actually sends email. It never runs on its own — an admin has to call it
// explicitly (e.g. via curl with the admin credentials), and it requires
// `{ "confirm": true }` in the body as a deliberate double-check against
// firing it by accident. Nothing here is wired to any cron/schedule.

import { Router } from "express";
import { db, commitmentsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isAdminReq } from "../lib/admin-auth";
import { sendEmail } from "../lib/email";

const router = Router();

const SITE_URL = process.env.PUBLIC_SITE_URL ?? "https://www.kcea.co.za";

/** Same scheme as makeUpdateToken/verifyUpdateToken in commitments.ts — kept
 * as its own small copy here rather than importing, since those two helpers
 * aren't exported from that file and this route set is meant to be a
 * self-contained, low-risk addition. */
function makeConfirmToken(id: number): string {
  const secret = process.env.SESSION_SECRET ?? "kcea-fallback-secret";
  return createHmac("sha256", secret).update(`legacy-confirm:${id}`).digest("hex").slice(0, 24);
}
function verifyConfirmToken(id: number, token: string | undefined): boolean {
  if (!token) return false;
  const expected = makeConfirmToken(id);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

const isPlaceholderEmail = (e: string | null | undefined) =>
  !e || e.trim() === "" || e.toLowerCase() === "imported@kcea.local";

// ── Public: fetch the pre-fill info for the confirm page ──────────────────
router.get("/commitments/:id/confirm-info", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = typeof req.query.t === "string" ? req.query.t : undefined;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!verifyConfirmToken(id, token)) { res.status(403).json({ error: "Invalid or missing link" }); return; }

  try {
    const [row] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    res.json({
      id: row.id,
      fullName: row.fullName,
      street: row.street,
      houseNumber: row.houseNumber,
      commitmentType: row.commitmentType,
      alreadyConfirmed: !!row.identityConfirmedAt,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load record" });
  }
});

// ── Public: the actual one-click confirmation ──────────────────────────────
router.post("/commitments/:id/confirm-identity", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = typeof req.query.t === "string" ? req.query.t : undefined;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!verifyConfirmToken(id, token)) { res.status(403).json({ error: "Invalid or missing link" }); return; }

  try {
    const [row] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (row.identityConfirmedAt) {
      res.json({ ok: true, alreadyConfirmed: true });
      return;
    }
    await db
      .update(commitmentsTable)
      .set({ identityConfirmedAt: new Date() })
      .where(eq(commitmentsTable.id, id));
    req.log.info({ commitmentId: id }, "Resident confirmed a legacy paper-form commitment");
    res.json({ ok: true, alreadyConfirmed: false });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to confirm" });
  }
});

// ── Admin: preview who's still unconfirmed (and emailable) ─────────────────
router.get("/commitments/legacy-unconfirmed", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const rows = await db
      .select()
      .from(commitmentsTable)
      .where(and(eq(commitmentsTable.imported, true), isNull(commitmentsTable.identityConfirmedAt)));

    const emailable = rows.filter(r => !isPlaceholderEmail(r.email));
    const alreadyEmailed = emailable.filter(r => !!r.legacyConfirmEmailSentAt);
    const notYetEmailed = emailable.filter(r => !r.legacyConfirmEmailSentAt);
    const noEmailOnFile = rows.filter(r => isPlaceholderEmail(r.email));

    res.json({
      totalUnconfirmed: rows.length,
      emailable: emailable.length,
      alreadyEmailed: alreadyEmailed.length,
      readyToSend: notYetEmailed.length,
      noEmailOnFile: noEmailOnFile.length,
      readyToSendPreview: notYetEmailed.slice(0, 10).map(r => ({ id: r.id, fullName: r.fullName, street: r.street, houseNumber: r.houseNumber, email: r.email })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load legacy-unconfirmed list" });
  }
});

// ── Admin: actually send the confirm emails ────────────────────────────────
// Requires { confirm: true } in the body as a deliberate extra step.
// Only ever sends to rows that (a) haven't confirmed yet, and
// (b) haven't already been emailed — safe to call more than once, it
// will only ever email each household once.
router.post("/commitments/legacy-unconfirmed/send", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = req.body as Record<string, unknown>;
  if (body.confirm !== true) {
    res.status(400).json({ error: "Refusing to send — pass { \"confirm\": true } in the request body." });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(commitmentsTable)
      .where(and(eq(commitmentsTable.imported, true), isNull(commitmentsTable.identityConfirmedAt), isNull(commitmentsTable.legacyConfirmEmailSentAt)));

    let sent = 0;
    let skippedNoEmail = 0;
    let failed = 0;

    for (const row of rows) {
      if (isPlaceholderEmail(row.email)) { skippedNoEmail++; continue; }

      const token = makeConfirmToken(row.id);
      const url = `${SITE_URL}/confirm?id=${row.id}&t=${token}`;
      const subject = "Confirm your KCEA road-closure commitment";
      const text =
        `Hi ${row.fullName},\n\n` +
        `Our records show you signed a KCEA road-closure consent form for ${row.street} No. ${row.houseNumber}. ` +
        `We're moving that onto our official system so it's ready for monthly invoicing.\n\n` +
        `Please confirm here (takes 10 seconds): ${url}\n\n` +
        `Not sure this is legit? Contact your street captain, or message KCEA on WhatsApp before clicking. ` +
        `We'll never ask for passwords, card numbers, or bank details by email.\n\n` +
        `— KCEA`;

      const result = await sendEmail(row.email, subject, text);
      if (result.ok) {
        await db.update(commitmentsTable).set({ legacyConfirmEmailSentAt: new Date() }).where(eq(commitmentsTable.id, row.id));
        sent++;
      } else {
        req.log.warn({ commitmentId: row.id, reason: result.reason }, "Legacy confirm email failed to send");
        failed++;
      }
    }

    res.json({ sent, skippedNoEmail, failed });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Send batch failed" });
  }
});

export default router;
