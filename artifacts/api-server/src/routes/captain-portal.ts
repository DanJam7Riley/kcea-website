import { Router } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db, captainProfilesTable, captainTokensTable, streetCaptainsTable, commitmentsTable, propertyNotesTable, streetHousesTable, captainResidentContactsTable, invoicesTable, paymentsTable } from "@workspace/db";
import { eq, and, inArray, gt, desc, sql } from "drizzle-orm";
import { sendEmail } from "../lib/email";

const router = Router();
import { isAdminReq } from "../lib/admin-auth";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// PIN reset/setup links (see "PIN self-service" section below): a self-service
// "forgot PIN" request gets a short-lived link (used right away, in one sitting).
// An admin-triggered bulk "set up your PIN" blast gets a much longer window,
// since captains won't all click within the same half hour.
const PIN_RESET_TTL_MS = 30 * 60 * 1000;       // 30 minutes
const PIN_SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SITE_URL = process.env.PUBLIC_SITE_URL ?? "https://www.kcea.co.za";

const SEEDED_CAPTAIN_NAMES = [
  "Carina", "Ingrid Bester", "Priscilla", "Jo-Anne", "Geoff",
  "Maria D'Alves", "Kerstin", "Paul Arokiam", "Garren Pillay",
  "Irene Goodwin", "Jason van Wyngaard",
];

function hashPin(pin: string): string {
  const secret = process.env.SESSION_SECRET ?? "kcea-dev-secret";
  return createHmac("sha256", secret).update(pin).digest("hex");
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

async function getProfileFromToken(token: string) {
  if (!token) return null;
  const now = new Date();
  const rows = await db
    .select({ profile: captainProfilesTable })
    .from(captainTokensTable)
    .innerJoin(captainProfilesTable, eq(captainTokensTable.profileId, captainProfilesTable.id))
    .where(and(eq(captainTokensTable.token, token), gt(captainTokensTable.expiresAt, now)))
    .limit(1);
  return rows[0]?.profile ?? null;
}

async function getStreetsForCaptain(captainName: string): Promise<string[]> {
  const rows = await db
    .select({ street: streetCaptainsTable.street })
    .from(streetCaptainsTable)
    .where(eq(streetCaptainsTable.captain, captainName));
  return rows.map(r => r.street);
}

async function seedProfiles() {
  const existing = await db.select({ name: captainProfilesTable.name }).from(captainProfilesTable);
  const existingNames = new Set(existing.map(r => r.name));
  const toInsert = SEEDED_CAPTAIN_NAMES.filter(n => !existingNames.has(n));
  if (toInsert.length > 0) {
    await db.insert(captainProfilesTable).values(toInsert.map(name => ({ name })));
  }
}

// ── PIN self-service (forgot-PIN + admin bulk "set up your PIN") ──────────
// Deliberately stateless — no new tokens table. Mirrors the signed-session
// pattern already used in me-update.ts (signSession/verifySession) and the
// deterministic-token pattern in legacy-confirm.ts: an HMAC of the payload,
// keyed by SESSION_SECRET, with the expiry embedded in the signed payload
// itself so it can be verified without a DB lookup. Namespaced "pinreset:"
// so a token minted here can never be replayed against the unrelated
// legacy-confirm or update-my-details flows even though they share the
// same secret.
function signPinResetToken(profileId: number, exp: number): string {
  const secret = process.env.SESSION_SECRET ?? "kcea-dev-secret";
  const payload = `${profileId}.${exp}`;
  const sig = createHmac("sha256", secret).update(`pinreset:${payload}`).digest("hex");
  return `${payload}.${sig}`;
}

function verifyPinResetToken(token: string): { profileId: number } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [idStr, expStr, sig] = parts;
  const profileId = Number(idStr);
  const exp = Number(expStr);
  if (!Number.isInteger(profileId) || !Number.isInteger(exp)) return null;
  if (Date.now() > exp) return null;
  const secret = process.env.SESSION_SECRET ?? "kcea-dev-secret";
  const expected = createHmac("sha256", secret).update(`pinreset:${idStr}.${expStr}`).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { profileId };
}

// captain_profiles has no email column — captains' emails already live on
// street_captains (collected when they signed up as a captain), joined here
// by name, same join used everywhere else in this file (getStreetsForCaptain).
const isUsableEmail = (e: string | null | undefined) => !!e && e.trim() !== "";

async function findProfileByEmail(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return null;
  const scRows = await db
    .select({ captain: streetCaptainsTable.captain, email: streetCaptainsTable.email })
    .from(streetCaptainsTable);
  const matchNames = new Set(
    scRows.filter(r => isUsableEmail(r.email) && r.email!.trim().toLowerCase() === email).map(r => r.captain),
  );
  if (matchNames.size === 0) return null;
  const profiles = await db.select().from(captainProfilesTable);
  return profiles.find(p => matchNames.has(p.name)) ?? null;
}

async function getEmailForProfile(profileName: string): Promise<string | null> {
  const rows = await db
    .select({ email: streetCaptainsTable.email })
    .from(streetCaptainsTable)
    .where(eq(streetCaptainsTable.captain, profileName));
  const found = rows.find(r => isUsableEmail(r.email));
  return found?.email ?? null;
}

function buildPinEmail(captainName: string, url: string, isSetup: boolean) {
  const subject = isSetup ? "Set up your KCEA Captain Portal PIN" : "Reset your KCEA Captain Portal PIN";
  const expiryText = isSetup ? "7 days" : "30 minutes";
  const text = isSetup
    ? `Hi ${captainName},\n\n` +
      `You're a KCEA street captain — this is your link to set up your own login PIN for the Captain Portal ` +
      `(so you don't need to wait on us to send you one).\n\n` +
      `Set your PIN here (link expires in ${expiryText}): ${url}\n\n` +
      `Once it's set, sign in any time at ${SITE_URL}/captain with your phone number and PIN.\n\n` +
      `Not expecting this? Contact KCEA before clicking. We'll never ask for passwords or bank details by email.\n\n` +
      `— KCEA`
    : `Hi ${captainName},\n\n` +
      `We received a request to reset your KCEA Captain Portal PIN.\n\n` +
      `Set a new PIN here (link expires in ${expiryText}): ${url}\n\n` +
      `If you didn't request this, you can ignore this email — your existing PIN stays the same.\n\n` +
      `— KCEA`;
  return { subject, text };
}

// POST /api/captain/login
// Accepts either a phone number or an email address as the identifier (some
// captains' phone numbers are on file in inconsistent formats — 083..., +27 83...,
// with/without spaces — while email has no such ambiguity once normalized).
router.post("/captain/login", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const identifierRaw = typeof body.identifier === "string" ? body.identifier.trim()
    : typeof body.phone === "string" ? body.phone.trim() // back-compat with the old phone-only field
    : "";
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";

  if (!identifierRaw || !pin) {
    res.status(400).json({ error: "Phone number or email, and PIN, are required" });
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 4 digits" });
    return;
  }

  const normalizedPhone = normalizePhone(identifierRaw);
  const normalizedEmail = identifierRaw.toLowerCase();

  try {
    const profiles = await db.select().from(captainProfilesTable);
    // Match on phone OR email. Multiple profiles can share the same phone/email
    // (e.g. a captain's display name changed and a new profile got created
    // alongside the old one) — try the PIN against every matching candidate
    // rather than just the first row a plain .find() would happen to hit, so a
    // captain's real, current PIN always works even if a stale duplicate exists.
    const candidates = profiles.filter(p =>
      (p.phone && normalizePhone(p.phone) === normalizedPhone) ||
      (p.email && p.email.trim().toLowerCase() === normalizedEmail),
    );
    const pinHash = hashPin(pin);
    const profile = candidates.find(p => p.pinHash && p.pinHash === pinHash);

    if (!profile) {
      res.status(401).json({ error: "Invalid phone number or PIN" });
      return;
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await db.insert(captainTokensTable).values({ profileId: profile.id, token, expiresAt });

    // Roll the previousLoginAt snapshot forward ONLY when this looks like a fresh session
    // (more than 30 minutes since the last login). Otherwise a quick refresh / second device
    // login would clobber the cutoff and instantly hide every "new" submission.
    const now = new Date();
    const SESSION_GAP_MS = 30 * 60 * 1000;
    const isFreshSession =
      !profile.lastLoginAt || now.getTime() - new Date(profile.lastLoginAt).getTime() > SESSION_GAP_MS;
    const patch: { lastLoginAt: Date; previousLoginAt?: Date | null } = { lastLoginAt: now };
    if (isFreshSession) patch.previousLoginAt = profile.lastLoginAt;
    await db.update(captainProfilesTable).set(patch).where(eq(captainProfilesTable.id, profile.id));

    res.json({ token, captainName: profile.name });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/captain/forgot-pin — public, enumeration-safe (always uniform response)
router.post("/captain/forgot-pin", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const uniform = {
    ok: true,
    message: "If that email is on file for a street captain, we've sent a link to set a new PIN. It expires in 30 minutes.",
  };
  if (!email) { res.json(uniform); return; }

  try {
    const profile = await findProfileByEmail(email);
    if (!profile) {
      req.log.info({ emailDomain: email.split("@")[1] ?? "" }, "Forgot-PIN requested for unknown email — returning uniform success");
      res.json(uniform);
      return;
    }
    const exp = Date.now() + PIN_RESET_TTL_MS;
    const token = signPinResetToken(profile.id, exp);
    const url = `${SITE_URL}/captain/reset-pin?token=${token}`;
    const { subject, text } = buildPinEmail(profile.name, url, false);
    const result = await sendEmail(email, subject, text);
    if (!result.ok) {
      req.log.warn({ profileId: profile.id, reason: result.reason }, "Forgot-PIN email failed to send");
    } else {
      req.log.info({ profileId: profile.id }, "Forgot-PIN email sent");
    }
    res.json(uniform);
  } catch (err) {
    req.log.error(err);
    res.json(uniform); // stay uniform even on internal error — don't leak state
  }
});

// GET /api/captain/reset-pin/info?token=... — public, token-gated. Lets the
// reset page greet the captain by name before they type a new PIN.
router.get("/captain/reset-pin/info", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = verifyPinResetToken(token);
  if (!session) { res.status(401).json({ error: "expired", message: "This link has expired or is invalid. Please request a new one." }); return; }
  try {
    const [profile] = await db.select().from(captainProfilesTable).where(eq(captainProfilesTable.id, session.profileId)).limit(1);
    if (!profile) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ captainName: profile.name });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "internal" });
  }
});

// POST /api/captain/reset-pin — public, token-gated. The actual PIN set/reset.
router.post("/captain/reset-pin", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";

  const session = verifyPinResetToken(token);
  if (!session) { res.status(401).json({ error: "expired", message: "This link has expired or is invalid. Please request a new one." }); return; }
  if (!/^\d{4}$/.test(pin)) { res.status(400).json({ error: "invalid_pin", message: "PIN must be exactly 4 digits." }); return; }

  try {
    const [updated] = await db
      .update(captainProfilesTable)
      .set({ pin, pinHash: hashPin(pin) })
      .where(eq(captainProfilesTable.id, session.profileId))
      .returning();
    if (!updated) { res.status(404).json({ error: "not_found" }); return; }
    req.log.info({ profileId: updated.id }, "Captain set their own PIN via email link");
    res.json({ ok: true, captainName: updated.name });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "internal", message: "Something went wrong. Please try again." });
  }
});

// GET /api/captain/dashboard
router.get("/captain/dashboard", async (req, res) => {
  const token = req.headers["x-captain-token"] as string;
  try {
    const profile = await getProfileFromToken(token);
    if (!profile) { res.status(401).json({ error: "Unauthorized" }); return; }

    const streets = await getStreetsForCaptain(profile.name);

    let committed: { id: number; fullName: string; email: string; street: string; houseNumber: string; commitmentType: string; paymentConfirmed: boolean; phone: string; submittedAt: Date }[] = [];
    let houses: { id: number; street: string; houseNumber: string }[] = [];
    let notes: { id: number; street: string; houseNumber: string; note: string; updatedAt: Date }[] = [];
    let targetHouseholds = 0;
    const targetByStreet: Record<string, number> = {};

    if (streets.length > 0) {
      committed = await db
        .select({
          id: commitmentsTable.id,
          fullName: commitmentsTable.fullName,
          email: commitmentsTable.email,
          street: commitmentsTable.street,
          houseNumber: commitmentsTable.houseNumber,
          commitmentType: commitmentsTable.commitmentType,
          paymentConfirmed: commitmentsTable.paymentConfirmed,
          phone: commitmentsTable.phone,
          submittedAt: commitmentsTable.submittedAt,
        })
        .from(commitmentsTable)
        .where(inArray(commitmentsTable.street, streets));

      // Per-street household targets (defaults to 30 — see schema/seed). Multiple captain rows
      // can exist for the same street (co-captains); use MAX so we don't double-count.
      const targetRows = await db
        .select({ street: streetCaptainsTable.street, target: streetCaptainsTable.targetHouseholds })
        .from(streetCaptainsTable)
        .where(inArray(streetCaptainsTable.street, streets));
      for (const s of streets) targetByStreet[s] = 30;
      for (const r of targetRows) {
        targetByStreet[r.street] = Math.max(targetByStreet[r.street] ?? 0, r.target);
      }
      targetHouseholds = Object.values(targetByStreet).reduce((a, b) => a + b, 0);

      houses = await db
        .select()
        .from(streetHousesTable)
        .where(inArray(streetHousesTable.street, streets));

      notes = await db
        .select({
          id: propertyNotesTable.id,
          street: propertyNotesTable.street,
          houseNumber: propertyNotesTable.houseNumber,
          note: propertyNotesTable.note,
          updatedAt: propertyNotesTable.updatedAt,
        })
        .from(propertyNotesTable)
        .where(inArray(propertyNotesTable.street, streets));
    }

    // Payment visibility for captains — Janine's request: captains need to see
    // when a household on their street last paid so they know who to follow up
    // with, without needing invoice-level admin access. Computed across every
    // (non-cancelled) invoice for each committed household: "paid" if nothing
    // is outstanding, "partial" if some but not all is paid, "unpaid" if
    // nothing has been paid at all, "no invoices" if none exist yet.
    const paymentStatusByCommitment: Record<
      number,
      { lastPaymentDate: Date | null; status: "paid" | "partial" | "unpaid" | "no invoices" }
    > = {};
    if (committed.length > 0) {
      const commitmentIds = committed.map(c => c.id);
      const invoiceRows = await db
        .select({ id: invoicesTable.id, commitmentId: invoicesTable.commitmentId, total: invoicesTable.total })
        .from(invoicesTable)
        .where(and(inArray(invoicesTable.commitmentId, commitmentIds), sql`${invoicesTable.status} != 'cancelled'`));

      const invoiceIds = invoiceRows.map(r => r.id);
      const paymentRows =
        invoiceIds.length > 0
          ? await db
              .select({ invoiceId: paymentsTable.invoiceId, amount: paymentsTable.amount, paymentDate: paymentsTable.paymentDate })
              .from(paymentsTable)
              .where(inArray(paymentsTable.invoiceId, invoiceIds))
          : [];

      const paidByInvoice = new Map<number, number>();
      const lastPaymentByInvoice = new Map<number, Date>();
      for (const p of paymentRows) {
        paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + p.amount);
        const existing = lastPaymentByInvoice.get(p.invoiceId);
        if (!existing || new Date(p.paymentDate) > existing) lastPaymentByInvoice.set(p.invoiceId, new Date(p.paymentDate));
      }

      const invoicesByCommitment = new Map<number, typeof invoiceRows>();
      for (const inv of invoiceRows) {
        if (inv.commitmentId === null) continue;
        const list = invoicesByCommitment.get(inv.commitmentId) ?? [];
        list.push(inv);
        invoicesByCommitment.set(inv.commitmentId, list);
      }

      for (const c of committed) {
        const invs = invoicesByCommitment.get(c.id) ?? [];
        if (invs.length === 0) {
          paymentStatusByCommitment[c.id] = { lastPaymentDate: null, status: "no invoices" };
          continue;
        }
        let totalDue = 0;
        let totalPaid = 0;
        let lastPaymentDate: Date | null = null;
        for (const inv of invs) {
          totalDue += inv.total;
          totalPaid += paidByInvoice.get(inv.id) ?? 0;
          const last = lastPaymentByInvoice.get(inv.id);
          if (last && (!lastPaymentDate || last > lastPaymentDate)) lastPaymentDate = last;
        }
        const status = totalPaid <= 0 ? "unpaid" : totalPaid >= totalDue ? "paid" : "partial";
        paymentStatusByCommitment[c.id] = { lastPaymentDate, status };
      }
    }
    const committedWithPaymentStatus = committed.map(c => ({
      ...c,
      paymentStatus: paymentStatusByCommitment[c.id]?.status ?? "no invoices",
      lastPaymentDate: paymentStatusByCommitment[c.id]?.lastPaymentDate ?? null,
    }));

    const committedKeys = new Set(committed.map(c => `${c.street}|${c.houseNumber}`));
    const notCommitted = houses.filter(h => !committedKeys.has(`${h.street}|${h.houseNumber}`));

    // "New since last login" — uses previousLoginAt (snapshot at login time). On first ever login
    // we show submissions from the past 7 days as a sensible default rather than the entire history.
    const cutoff = profile.previousLoginAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newSubmissions = committed
      .filter(c => new Date(c.submittedAt).getTime() > cutoff.getTime())
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

    // Which residents has THIS captain already contacted? Persisted across logins.
    const contacts = await db
      .select({ commitmentId: captainResidentContactsTable.commitmentId, contactedAt: captainResidentContactsTable.contactedAt })
      .from(captainResidentContactsTable)
      .where(eq(captainResidentContactsTable.captainProfileId, profile.id));
    const contactedResidents = contacts.map(c => ({ commitmentId: c.commitmentId, contactedAt: c.contactedAt }));

    // Committed residents with missing/empty phone or email — flagged so the captain can chase them.
    const missingContactInfo = committed
      .filter(c => !(c.phone ?? "").trim() || !(c.email ?? "").trim())
      .map(c => ({
        id: c.id,
        fullName: c.fullName,
        street: c.street,
        houseNumber: c.houseNumber,
        missingPhone: !(c.phone ?? "").trim(),
        missingEmail: !(c.email ?? "").trim(),
      }));

    res.json({
      captainName: profile.name,
      streets,
      committed: committedWithPaymentStatus,
      notCommitted,
      notes,
      newSubmissions,
      contactedResidents,
      targetByStreet,
      targetHouseholds,
      missingContactInfo,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// POST /api/captain/notes
router.post("/captain/notes", async (req, res) => {
  const token = req.headers["x-captain-token"] as string;
  const body = req.body as Record<string, unknown>;
  try {
    const profile = await getProfileFromToken(token);
    if (!profile) { res.status(401).json({ error: "Unauthorized" }); return; }

    const street = typeof body.street === "string" ? body.street.trim() : "";
    const houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (!street || !houseNumber) {
      res.status(400).json({ error: "Street and house number are required" });
      return;
    }

    const streets = await getStreetsForCaptain(profile.name);
    if (!streets.includes(street)) { res.status(403).json({ error: "Access denied" }); return; }

    const [existing] = await db
      .select()
      .from(propertyNotesTable)
      .where(and(eq(propertyNotesTable.street, street), eq(propertyNotesTable.houseNumber, houseNumber)))
      .limit(1);

    if (note === "") {
      if (existing) await db.delete(propertyNotesTable).where(eq(propertyNotesTable.id, existing.id));
      res.json({ deleted: true });
    } else if (existing) {
      const [updated] = await db
        .update(propertyNotesTable)
        .set({ note, captainName: profile.name, profileId: profile.id, updatedAt: new Date() })
        .where(eq(propertyNotesTable.id, existing.id))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(propertyNotesTable)
        .values({ street, houseNumber, profileId: profile.id, captainName: profile.name, note })
        .returning();
      res.json(created);
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save note" });
  }
});

// POST /api/captain/houses
router.post("/captain/houses", async (req, res) => {
  const token = req.headers["x-captain-token"] as string;
  const body = req.body as Record<string, unknown>;
  try {
    const profile = await getProfileFromToken(token);
    if (!profile) { res.status(401).json({ error: "Unauthorized" }); return; }

    const street = typeof body.street === "string" ? body.street.trim() : "";
    const houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";

    if (!street || !houseNumber) {
      res.status(400).json({ error: "Street and house number required" });
      return;
    }

    const streets = await getStreetsForCaptain(profile.name);
    if (!streets.includes(street)) { res.status(403).json({ error: "Access denied" }); return; }

    const [existing] = await db
      .select()
      .from(streetHousesTable)
      .where(and(eq(streetHousesTable.street, street), eq(streetHousesTable.houseNumber, houseNumber)))
      .limit(1);

    if (existing) { res.json(existing); return; }

    const [created] = await db.insert(streetHousesTable).values({ street, houseNumber }).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to register house" });
  }
});

// POST /api/captain/contact-resident — captain clicked WhatsApp on a new submission
router.post("/captain/contact-resident", async (req, res) => {
  const token = req.headers["x-captain-token"] as string;
  const body = req.body as Record<string, unknown>;
  try {
    const profile = await getProfileFromToken(token);
    if (!profile) { res.status(401).json({ error: "Unauthorized" }); return; }

    const commitmentId = typeof body.commitmentId === "number" ? body.commitmentId : parseInt(String(body.commitmentId), 10);
    if (!Number.isFinite(commitmentId)) { res.status(400).json({ error: "commitmentId required" }); return; }

    // Authorisation: the captain must own (Active on) the street this commitment belongs to.
    const [commitment] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, commitmentId)).limit(1);
    if (!commitment) { res.status(404).json({ error: "Commitment not found" }); return; }
    const streets = await getStreetsForCaptain(profile.name);
    if (!streets.includes(commitment.street)) { res.status(403).json({ error: "Access denied" }); return; }

    const now = new Date();
    // Upsert: if a contact row already exists, refresh contactedAt (so "Resend" updates the timestamp).
    const [existing] = await db
      .select()
      .from(captainResidentContactsTable)
      .where(and(
        eq(captainResidentContactsTable.captainProfileId, profile.id),
        eq(captainResidentContactsTable.commitmentId, commitmentId),
      ))
      .limit(1);
    if (existing) {
      await db
        .update(captainResidentContactsTable)
        .set({ contactedAt: now })
        .where(eq(captainResidentContactsTable.id, existing.id));
    } else {
      await db.insert(captainResidentContactsTable).values({
        captainProfileId: profile.id,
        commitmentId,
        contactedAt: now,
      });
    }
    res.json({ commitmentId, contactedAt: now });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to record contact" });
  }
});

// DELETE /api/captain/session (logout)
router.delete("/captain/session", async (req, res) => {
  const token = req.headers["x-captain-token"] as string;
  if (token) {
    try { await db.delete(captainTokensTable).where(eq(captainTokensTable.token, token)); } catch {}
  }
  res.json({ success: true });
});

// --- ADMIN ROUTES ---

// GET /api/captain/management
router.get("/captain/management", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    await seedProfiles();
    const profiles = await db.select().from(captainProfilesTable).orderBy(captainProfilesTable.name);
    res.json(profiles);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch profiles" });
  }
});

// POST /api/captain/management/profiles
router.post("/captain/management/profiles", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone.trim()) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }
  try {
    const [created] = await db.insert(captainProfilesTable).values({ name, phone: phone || null, email: email || null }).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to create profile" });
  }
});

// PUT /api/captain/management/:id
router.put("/captain/management/:id", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.phone === "string") {
    const p = normalizePhone(body.phone.trim());
    patch.phone = p || null;
  }
  if (typeof body.email === "string") {
    const e = body.email.trim().toLowerCase();
    patch.email = e || null;
  }
  if (typeof body.pin === "string") {
    const pin = body.pin.trim();
    if (pin && !/^\d{4}$/.test(pin)) { res.status(400).json({ error: "PIN must be 4 digits" }); return; }
    patch.pin = pin || null;
    patch.pinHash = pin ? hashPin(pin) : null;
  }

  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  try {
    const [updated] = await db.update(captainProfilesTable).set(patch).where(eq(captainProfilesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// POST /api/captain/management/:id/set-pin  — generate (or set) PIN and notify captain via WhatsApp
router.post("/captain/management/:id/set-pin", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = (req.body as Record<string, unknown> | undefined) ?? {};
  const providedPin = typeof body.pin === "string" && /^\d{4}$/.test(body.pin.trim()) ? body.pin.trim() : null;
  const pin = providedPin ?? String(Math.floor(1000 + Math.random() * 9000));

  try {
    const [updated] = await db
      .update(captainProfilesTable)
      .set({ pin, pinHash: hashPin(pin) })
      .where(eq(captainProfilesTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Not found" }); return; }

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to set PIN" });
  }
});

// POST /api/captain/management/:id/mark-pin-sent — admin clicked "Send PIN via WhatsApp"
router.post("/captain/management/:id/mark-pin-sent", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [updated] = await db
      .update(captainProfilesTable)
      .set({ pinSentAt: new Date() })
      .where(eq(captainProfilesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to mark PIN sent" });
  }
});

// POST /api/captain/management/send-pin-setup-emails — admin bulk action.
// Requires { confirm: true } as a deliberate double-check against firing it
// by accident (same guard pattern as /commitments/legacy-unconfirmed/send).
// For every captain profile, looks up their email via street_captains (by
// name), sends a "set up your PIN" link (7-day expiry — a blast email won't
// all get clicked within 30 minutes), and marks pinSentAt. Captains with no
// email on file are returned in noEmailOnFile so they can be chased another
// way (e.g. the existing WhatsApp "Send PIN" flow).
router.post("/captain/management/send-pin-setup-emails", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = req.body as Record<string, unknown>;
  if (body.confirm !== true) {
    res.status(400).json({ error: "Refusing to send — pass { \"confirm\": true } in the request body." });
    return;
  }

  try {
    await seedProfiles();
    const profiles = await db.select().from(captainProfilesTable).orderBy(captainProfilesTable.name);

    let sent = 0;
    const noEmailOnFile: string[] = [];
    const failed: string[] = [];

    for (const profile of profiles) {
      const email = await getEmailForProfile(profile.name);
      if (!email) { noEmailOnFile.push(profile.name); continue; }

      const exp = Date.now() + PIN_SETUP_TTL_MS;
      const token = signPinResetToken(profile.id, exp);
      const url = `${SITE_URL}/captain/reset-pin?token=${token}`;
      const { subject, text } = buildPinEmail(profile.name, url, true);

      const result = await sendEmail(email, subject, text);
      if (result.ok) {
        await db.update(captainProfilesTable).set({ pinSentAt: new Date() }).where(eq(captainProfilesTable.id, profile.id));
        sent++;
      } else {
        req.log.warn({ profileId: profile.id, reason: result.reason }, "PIN setup email failed to send");
        failed.push(profile.name);
      }
    }

    res.json({ sent, noEmailOnFile, failed });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Send batch failed" });
  }
});

// DELETE /api/captain/management/:id
router.delete("/captain/management/:id", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(captainTokensTable).where(eq(captainTokensTable.profileId, id));
    const [deleted] = await db.delete(captainProfilesTable).where(eq(captainProfilesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete profile" });
  }
});

// GET /api/captain/management/notes
router.get("/captain/management/notes", async (req, res) => {
  if (!isAdminReq(req.headers)) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const notes = await db.select().from(propertyNotesTable).orderBy(desc(propertyNotesTable.updatedAt));
    res.json(notes);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

export default router;
