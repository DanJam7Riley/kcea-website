import { Router, type Request } from "express";
import { db, invoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyResendWebhookSignature } from "../lib/resend-webhook-verify";

const router = Router();

// Maps Resend's webhook event "type" to the deliveryStatus value we store.
// Only the events relevant to "did this invoice actually reach someone" are
// handled — others (e.g. email.opened, email.clicked, email.sent) are
// acknowledged with 200 but ignored, since "sent" is already set the moment
// we call Resend and open/click tracking isn't something this project uses.
const STATUS_BY_EVENT: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "delayed",
};

// Public endpoint — Resend calls this directly, so it can't require the
// admin auth headers every other route in this app uses. Security instead
// comes from verifying the Svix-style signature on every request; anything
// that fails verification is rejected before touching the database.
//
// **Manual setup required in Resend's dashboard (not something this code can
// do on its own): add a webhook pointed at POST /api/webhooks/resend, select
// the delivered/bounced/complained/delivery_delayed events, and set the
// signing secret it gives you as RESEND_WEBHOOK_SECRET on Render's kcea-api.**
router.post("/webhooks/resend", async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Not configured yet — 200 so Resend doesn't retry-storm us, but log it
    // since a webhook firing with nothing to verify against is worth noticing.
    req.log.warn("Resend webhook received but RESEND_WEBHOOK_SECRET is not set — ignoring");
    res.status(200).json({ ok: true, ignored: "not_configured" });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const valid =
    !!rawBody &&
    verifyResendWebhookSignature({
      rawBody,
      svixId: req.header("svix-id"),
      svixTimestamp: req.header("svix-timestamp"),
      svixSignature: req.header("svix-signature"),
      secret,
    });

  if (!valid) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  try {
    const body = req.body as { type?: string; data?: { email_id?: string } };
    const status = body.type ? STATUS_BY_EVENT[body.type] : undefined;
    const emailId = body.data?.email_id;

    if (status && emailId) {
      await db
        .update(invoicesTable)
        .set({ deliveryStatus: status, deliveryStatusUpdatedAt: new Date() })
        .where(eq(invoicesTable.resendEmailId, emailId));
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    req.log.error(err);
    // Still 200 — a DB hiccup on our side shouldn't make Resend retry
    // forever; the event itself was received and understood fine.
    res.status(200).json({ ok: false });
  }
});

export default router;
