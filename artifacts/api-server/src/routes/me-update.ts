// Public "Update My Details" self-service flow.
//
// Three endpoints, all unauthenticated to the user (verification is via
// email OTP -> short-lived signed session token):
//
//   POST /api/me/request-otp  { email }
//     - look up commitment by normalised email
//     - 4-digit OTP, 10-minute expiry, sent via email (Resend)
//     - rate-limited: at most one OTP per 60s per email
//     - enumeration-safe: always returns a uniform success response when
//       the input is a well-formed email
//
//   POST /api/me/verify-otp   { email, code }
//     - on success: mark OTP consumed, return signed `sessionToken`
//       plus the existing record details so the form can pre-fill
//
//   POST /api/me/save         { sessionToken, fullName, email, street, houseNumber }
//     - validates session token, updates the commitment in place,
//       enforces the same name+street duplicate guard against *other* rows

import { Router } from "express";
import { db, commitmentsTable, otpCodesTable } from "@workspace/db";
import { eq, and, desc, isNull, gt } from "drizzle-orm";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { sendEmail } from "../lib/email";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes to fill in the form
const OTP_TTL_MS = 10 * 60 * 1000;     // 10 minutes per spec
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

// Fail closed: if SESSION_SECRET is missing the OTP/session signatures would
// be trivially forgeable, so refuse to sign or verify anything.
const secret = (): string => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is not configured — refusing to sign or verify update-my-details tokens.");
  }
  return s;
};

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Normalise an email address for lookup/dedup: trim + lowercase. (We don't do
// gmail dot/plus tricks — the stored address is what wins.)
function emailKey(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

function hashCode(code: string): string {
  return createHmac("sha256", secret()).update(`otp:${code}`).digest("hex");
}

function signSession(commitmentId: number, exp: number): string {
  const payload = `${commitmentId}.${exp}`;
  const sig = createHmac("sha256", secret()).update(`session:${payload}`).digest("hex");
  return `${payload}.${sig}`;
}

function verifySession(token: string): { commitmentId: number } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [idStr, expStr, sig] = parts;
  const id = Number(idStr);
  const exp = Number(expStr);
  if (!Number.isInteger(id) || !Number.isInteger(exp)) return null;
  if (Date.now() > exp) return null;
  const expected = createHmac("sha256", secret()).update(`session:${idStr}.${expStr}`).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { commitmentId: id };
}

const nameStreetKey = (name: string, street: string) =>
  `${name.trim().toLowerCase().replace(/\s+/g, " ")}|${street.trim().toLowerCase().replace(/\s+/g, " ")}`;

const NOT_FOUND_MESSAGE =
  "We couldn't find your details. Please submit a new commitment form or contact your street captain.";
const INVALID_OTP_MESSAGE = "Invalid or expired code. Please try again.";
const UNIFORM_SENT_MESSAGE =
  "If that email is on our list, we've sent a 4-digit code. Check your inbox — it expires in 10 minutes.";

// ── POST /api/me/request-otp ─────────────────────────────────────────────
router.post("/me/request-otp", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const emailRaw = typeof body.email === "string" ? body.email : "";
  const key = emailKey(emailRaw);
  if (!key || !EMAIL_RX.test(key)) {
    res.status(400).json({ error: "invalid_email", message: "Please enter a valid email address." });
    return;
  }

  // Uniform response sent to the client regardless of whether the email is
  // on file — prevents enumerating which addresses have signed up. Residents
  // who entered an unknown address simply won't receive a code, and the help
  // text on the page tells them what to do next.
  const uniformSuccess = { ok: true, message: UNIFORM_SENT_MESSAGE };

  try {
    // Find a commitment whose email matches (case-insensitive). Placeholder
    // imported rows use "imported@kcea.local" — we exclude those so import
    // stragglers can't be triggered by anyone typing that address.
    const all = await db
      .select({ id: commitmentsTable.id, email: commitmentsTable.email })
      .from(commitmentsTable);
    const match = all.find(r => {
      const ek = emailKey(r.email);
      return ek === key && ek !== "imported@kcea.local";
    });
    if (!match) {
      req.log.info({ emailDomain: key.split("@")[1] ?? "" }, "OTP requested for unknown email — returning uniform success");
      res.json(uniformSuccess);
      return;
    }

    // Rate limit: refuse if a non-consumed, non-expired OTP was issued in the
    // last cooldown window for this email. We still return the uniform shape
    // so an attacker can't distinguish "rate-limited" from "not on list".
    const recent = await db
      .select({ createdAt: otpCodesTable.createdAt })
      .from(otpCodesTable)
      .where(and(eq(otpCodesTable.emailKey, key), isNull(otpCodesTable.consumedAt)))
      .orderBy(desc(otpCodesTable.createdAt))
      .limit(1);
    if (recent.length > 0) {
      const ageMs = Date.now() - recent[0].createdAt.getTime();
      if (ageMs < OTP_RESEND_COOLDOWN_MS) {
        req.log.info({ commitmentId: match.id }, "OTP resend cooldown active");
        res.json(uniformSuccess);
        return;
      }
    }

    const code = String(randomInt(0, 10000)).padStart(4, "0");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await db.insert(otpCodesTable).values({
      emailKey: key,
      commitmentId: match.id,
      codeHash: hashCode(code),
      expiresAt,
    });

    const subject = "Your KCEA verification code";
    const bodyText = `Your KCEA verification code is ${code}. It expires in 10 minutes. Do not share this with anyone.`;
    const sendResult = await sendEmail(match.email, subject, bodyText);

    if (!sendResult.ok) {
      // Log loudly so operators see it (especially `not_configured`, which
      // makes the whole flow unusable), but never branch the public response
      // on it — that would let attackers enumerate known emails by observing
      // a 503 for known addresses and a 200 for unknown ones.
      const level = sendResult.reason === "not_configured" ? "error" : "warn";
      req.log[level]({ commitmentId: match.id, reason: sendResult.reason }, "OTP email send failed");
      res.json(uniformSuccess);
      return;
    }

    req.log.info({ commitmentId: match.id }, "OTP sent for self-service update");
    res.json(uniformSuccess);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "internal", message: "Something went wrong. Please try again." });
  }
});

// ── POST /api/me/verify-otp ──────────────────────────────────────────────
router.post("/me/verify-otp", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const emailRaw = typeof body.email === "string" ? body.email : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const key = emailKey(emailRaw);

  if (!key || !EMAIL_RX.test(key) || !/^\d{4}$/.test(code)) {
    res.status(400).json({ error: "invalid_input", message: INVALID_OTP_MESSAGE });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(otpCodesTable)
      .where(
        and(
          eq(otpCodesTable.emailKey, key),
          isNull(otpCodesTable.consumedAt),
          gt(otpCodesTable.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(otpCodesTable.createdAt))
      .limit(1);

    const otp = rows[0];
    if (!otp) {
      res.status(401).json({ error: "invalid_otp", message: INVALID_OTP_MESSAGE });
      return;
    }
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      res.status(401).json({ error: "invalid_otp", message: INVALID_OTP_MESSAGE });
      return;
    }

    const expectedHash = hashCode(code);
    const provided = Buffer.from(expectedHash, "hex");
    const stored = Buffer.from(otp.codeHash, "hex");
    const matches = provided.length === stored.length && timingSafeEqual(provided, stored);

    if (!matches) {
      await db
        .update(otpCodesTable)
        .set({ attempts: otp.attempts + 1 })
        .where(eq(otpCodesTable.id, otp.id));
      res.status(401).json({ error: "invalid_otp", message: INVALID_OTP_MESSAGE });
      return;
    }

    await db
      .update(otpCodesTable)
      .set({ consumedAt: new Date() })
      .where(eq(otpCodesTable.id, otp.id));

    const [record] = await db
      .select({
        id: commitmentsTable.id,
        fullName: commitmentsTable.fullName,
        email: commitmentsTable.email,
        phone: commitmentsTable.phone,
        street: commitmentsTable.street,
        houseNumber: commitmentsTable.houseNumber,
      })
      .from(commitmentsTable)
      .where(eq(commitmentsTable.id, otp.commitmentId));

    if (!record) {
      res.status(404).json({ error: "not_found", message: NOT_FOUND_MESSAGE });
      return;
    }

    const exp = Date.now() + SESSION_TTL_MS;
    const sessionToken = signSession(record.id, exp);

    res.json({
      ok: true,
      sessionToken,
      sessionExpiresAt: exp,
      record: {
        fullName: record.fullName,
        email: record.email,
        street: record.street,
        houseNumber: record.houseNumber,
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "internal", message: "Something went wrong. Please try again." });
  }
});

// ── POST /api/me/save ────────────────────────────────────────────────────
router.post("/me/save", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";
  const session = verifySession(sessionToken);
  if (!session) {
    res.status(401).json({ error: "session_expired", message: "Your verification has expired. Please start again." });
    return;
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const streetRaw = typeof body.street === "string" ? body.street.trim() : "";
  // Mirror the normalisation in /commitments so resident-edited rows match
  // the canonical capitalisation used everywhere else.
  const street = streetRaw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  const houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";

  if (!fullName || !email || !street || !houseNumber) {
    res.status(400).json({ error: "missing_fields", message: "Please fill in all fields." });
    return;
  }
  if (!EMAIL_RX.test(email)) {
    res.status(400).json({ error: "invalid_email", message: "Please enter a valid email address." });
    return;
  }

  try {
    // Duplicate guard: refuse if another row already has this name+street.
    const others = await db
      .select({ id: commitmentsTable.id, fullName: commitmentsTable.fullName, street: commitmentsTable.street })
      .from(commitmentsTable);
    const targetKey = nameStreetKey(fullName, street);
    const clash = others.find(r => r.id !== session.commitmentId && nameStreetKey(r.fullName, r.street) === targetKey);
    if (clash) {
      res.status(409).json({
        error: "duplicate",
        message:
          "Another record already exists with that name and street. Please contact your street captain to sort this out.",
      });
      return;
    }

    const [updated] = await db
      .update(commitmentsTable)
      .set({ fullName, email, street, houseNumber })
      .where(eq(commitmentsTable.id, session.commitmentId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "not_found", message: NOT_FOUND_MESSAGE });
      return;
    }

    req.log.info({ commitmentId: updated.id }, "Resident self-updated their details");
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "internal", message: "Something went wrong. Please try again." });
  }
});

export default router;
