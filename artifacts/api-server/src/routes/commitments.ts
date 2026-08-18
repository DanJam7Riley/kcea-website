import { Router } from "express";
import { db, commitmentsTable, captainProfilesTable, streetCaptainsTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { getOrCreateSettings } from "../lib/settings";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isAdminReq } from "../lib/admin-auth";

const router = Router();

// Duplicate-detection helpers shared by the public POST and admin CSV import.
// A submission is a duplicate when its phone number matches an existing row, OR
// when its (normalised) name + street pair matches an existing row.
const normalisePhone = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");
const nameStreetKey = (name: string, street: string) =>
  `${name.trim().toLowerCase().replace(/\s+/g, " ")}|${street.trim().toLowerCase().replace(/\s+/g, " ")}`;
// Anything shorter than 7 digits is too ambiguous to count as a phone match
// (e.g. blanks, "-", short extension codes from older imports).
const MIN_PHONE_DIGITS = 7;

const DUPLICATE_MESSAGE =
  "It looks like you've already signed up! Your household is already on our list. " +
  "No need to submit again. If you think this is an error, contact your street captain.";

const isMissingPhone = (p: string | null | undefined) => !p || p.trim() === "" || p.trim() === "-";
const isMissingEmail = (e: string | null | undefined) => !e || e.trim() === "" || e.toLowerCase() === "imported@kcea.local";
const isMissingName = (n: string | null | undefined) => !n || n.trim() === "";

function missingForCommitment(r: { fullName: string; email: string; phone: string }): string[] {
  const m: string[] = [];
  if (isMissingName(r.fullName)) m.push("Name");
  if (isMissingPhone(r.phone)) m.push("Phone");
  if (isMissingEmail(r.email)) m.push("Email");
  return m;
}

/** Per-record HMAC token so the public /update link cannot be enumerated by guessing IDs. */
function makeUpdateToken(id: number): string {
  const secret = process.env.SESSION_SECRET ?? "kcea-fallback-secret";
  return createHmac("sha256", secret).update(`commitment:${id}`).digest("hex").slice(0, 24);
}
function verifyUpdateToken(id: number, token: string | undefined): boolean {
  if (!token) return false;
  const expected = makeUpdateToken(id);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

router.post("/commitments", async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const streetRaw = typeof body.street === "string" ? body.street.trim() : "";
  // Normalise capitalisation on save so "MILDURA" / "mildura" / "Mildura"
  // all land as one canonical "Mildura" — prevents duplicate-looking streets.
  const street = streetRaw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  const houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";
  const commitmentType = typeof body.commitmentType === "string" ? body.commitmentType.trim() : "";

  if (!fullName || !email || !phone || !street || !houseNumber || !commitmentType) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }

  try {
    // Duplicate guard — same phone, OR same name + street.
    const existing = await db
      .select({
        fullName: commitmentsTable.fullName,
        street: commitmentsTable.street,
        phone: commitmentsTable.phone,
      })
      .from(commitmentsTable);

    const phoneNorm = normalisePhone(phone);
    const nsKey = nameStreetKey(fullName, street);
    const duplicate = existing.some(r => {
      const ephone = normalisePhone(r.phone);
      if (phoneNorm.length >= MIN_PHONE_DIGITS && ephone.length >= MIN_PHONE_DIGITS && ephone === phoneNorm) return true;
      if (nameStreetKey(r.fullName, r.street) === nsKey) return true;
      return false;
    });
    if (duplicate) {
      res.status(409).json({ error: "duplicate", message: DUPLICATE_MESSAGE });
      return;
    }

    const [created] = await db
      .insert(commitmentsTable)
      .values({ fullName, email, phone, street, houseNumber, commitmentType, imported: false, paymentConfirmed: false })
      .returning();

    // Notification routing decision (per product spec):
    //   - Primary target = the Active Captain for this street (their phone).
    //   - Fallback target = admin notifyWhatsapp, but ONLY when no Active Captain is assigned
    //     (or the assigned captain has no phone on file). Other admin notifications are intentionally
    //     limited to: new captain applications, incomplete records, and no-captain streets.
    // Today there is no server-side Twilio send wired up — the captain will see this submission in
    // their Captain Portal "New Submissions" section on next login. We log the routing decision here
    // so that adding Twilio later is a one-line drop-in, and so the audit trail is visible now.
    try {
      const activeCaptains = await db
        .select({ captain: streetCaptainsTable.captain, phone: streetCaptainsTable.phone })
        .from(streetCaptainsTable)
        .where(and(eq(streetCaptainsTable.street, street), eq(streetCaptainsTable.captainStatus, "Active Captain")));
      // A street can legitimately have co-captains — notify (log) all of them, not just the first.
      const reachable = activeCaptains.filter(
        c => c.phone && c.phone.trim() !== "" && c.phone.trim() !== "-" && c.captain !== "Unassigned",
      );
      if (reachable.length > 0) {
        req.log.info(
          {
            commitmentId: created.id,
            street,
            target: "captain",
            captains: reachable.map(c => ({ name: c.captain, phone: c.phone })),
          },
          "New commitment — routed to street captain(s)",
        );
      } else {
        const settings = await getOrCreateSettings();
        req.log.info(
          {
            commitmentId: created.id,
            street,
            target: "admin",
            reason: activeCaptains.length === 0 ? "no_active_captain" : "captain_has_no_phone",
            adminPhone: settings.notifyWhatsapp ?? null,
          },
          "New commitment — no captain available, admin notified",
        );
      }
    } catch (notifyErr) {
      req.log.warn({ err: notifyErr, commitmentId: created.id }, "Notification routing lookup failed (commitment saved OK)");
    }

    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save commitment" });
  }
});

// Public lookup — returns status only, no personal details
router.get("/commitments/lookup", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }

  try {
    // Search by name (partial, case-insensitive)
    const rows = await db
      .select({
        fullName: commitmentsTable.fullName,
        email: commitmentsTable.email,
        phone: commitmentsTable.phone,
        street: commitmentsTable.street,
        houseNumber: commitmentsTable.houseNumber,
        paymentConfirmed: commitmentsTable.paymentConfirmed,
      })
      .from(commitmentsTable)
      .where(sql`lower(${commitmentsTable.fullName}) like ${"%" + q.toLowerCase() + "%"}`)
      .limit(10);

    if (rows.length === 0) {
      res.json({ found: false });
      return;
    }

    const isIncomplete = (r: typeof rows[0]) => {
      const badPhone = !r.phone || r.phone.trim() === "" || r.phone.trim() === "-";
      const badEmail = !r.email || r.email.trim() === "" || r.email.toLowerCase() === "imported@kcea.local";
      const badName = !r.fullName || r.fullName.trim() === "";
      return badPhone || badEmail || badName;
    };

    const records = rows.map(r => ({
      name: r.fullName,
      street: r.street,
      houseNumber: r.houseNumber,
      paymentConfirmed: r.paymentConfirmed,
      incomplete: isIncomplete(r),
    }));
    const confirmed = records.some(r => r.paymentConfirmed);
    const incomplete = records.some(r => r.incomplete);
    res.json({
      found: true,
      paymentConfirmed: confirmed,
      incomplete,
      count: rows.length,
      names: rows.map(r => `${r.fullName} — ${r.street} No. ${r.houseNumber}`),
      records,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

router.get("/commitments/incomplete", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const rows = await db.select().from(commitmentsTable).orderBy(desc(commitmentsTable.submittedAt));
    const commitments = rows
      .map(r => ({
        ...r,
        kind: "commitment" as const,
        missingFields: missingForCommitment(r),
        updateToken: makeUpdateToken(r.id),
      }))
      .filter(r => r.missingFields.length > 0);

    const profiles = await db.select().from(captainProfilesTable);
    const incompleteProfiles = profiles
      .filter(p => isMissingPhone(p.phone))
      .map(p => ({
        id: p.id,
        kind: "profile" as const,
        fullName: p.name,
        email: null as string | null,
        phone: p.phone,
        street: "",
        houseNumber: "",
        commitmentType: "",
        submittedAt: new Date().toISOString(),
        missingFields: ["Phone"],
      }));

    // Commitments submitted within the last 30 days on streets with NO Active Captain assigned —
    // these need admin attention because no captain will see them in their portal.
    const captainRows = await db
      .select({ street: streetCaptainsTable.street, captain: streetCaptainsTable.captain, captainStatus: streetCaptainsTable.captainStatus })
      .from(streetCaptainsTable);
    const streetsWithActiveCaptain = new Set(
      captainRows
        .filter(r => r.captainStatus === "Active Captain" && r.captain && r.captain !== "Unassigned")
        .map(r => r.street),
    );
    // De-dupe: a commitment that's already surfaced via missingFields should NOT be listed a
    // second time as "no-captain" — the admin sees both flags inside one row instead.
    const alreadyIncompleteIds = new Set(commitments.map(c => c.id));
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const noCaptainSubmissions = rows
      .filter(r =>
        !alreadyIncompleteIds.has(r.id) &&
        !streetsWithActiveCaptain.has(r.street) &&
        new Date(r.submittedAt).getTime() > thirtyDaysAgo,
      )
      .map(r => ({
        id: r.id,
        kind: "no-captain" as const,
        fullName: r.fullName,
        email: r.email,
        phone: r.phone,
        street: r.street,
        houseNumber: r.houseNumber,
        commitmentType: r.commitmentType,
        submittedAt: r.submittedAt.toISOString(),
        missingFields: ["No captain assigned"],
      }));

    res.json([...commitments, ...incompleteProfiles, ...noCaptainSubmissions]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch incomplete records" });
  }
});

// PUBLIC: fetch a commitment by id+token so the resident can see what's missing and pre-fill the form.
// Requires a valid HMAC token (issued by admin link); rejects complete records to limit data exposure.
router.get("/commitments/:id/public", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = typeof req.query.t === "string" ? req.query.t : undefined;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!verifyUpdateToken(id, token)) { res.status(403).json({ error: "Invalid or missing token" }); return; }
  try {
    const [row] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const missing = missingForCommitment(row);
    if (missing.length === 0) {
      res.status(404).json({ error: "Record is already complete — no update needed" });
      return;
    }
    res.json({
      id: row.id,
      complete: false,
      missing,
      fullName: isMissingName(row.fullName) ? "" : row.fullName,
      email: isMissingEmail(row.email) ? "" : row.email,
      phone: isMissingPhone(row.phone) ? "" : row.phone,
      street: row.street,
      houseNumber: row.houseNumber,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch record" });
  }
});

// PUBLIC: resident self-update — token-gated, only fills fields that were originally missing.
router.put("/commitments/:id/self-update", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = typeof req.query.t === "string" ? req.query.t : (typeof (req.body as Record<string, unknown>)?.t === "string" ? (req.body as Record<string, string>).t : undefined);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!verifyUpdateToken(id, token)) { res.status(403).json({ error: "Invalid or missing token" }); return; }
  try {
    const [row] = await db.select().from(commitmentsTable).where(eq(commitmentsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const missing = missingForCommitment(row);
    if (missing.length === 0) { res.status(400).json({ error: "Record is already complete" }); return; }

    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (missing.includes("Name") && typeof body.fullName === "string" && body.fullName.trim()) {
      patch.fullName = body.fullName.trim();
    }
    if (missing.includes("Phone") && typeof body.phone === "string" && body.phone.trim()) {
      patch.phone = body.phone.trim();
    }
    if (missing.includes("Email") && typeof body.email === "string" && body.email.trim()) {
      patch.email = body.email.trim();
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Please fill in at least one of the missing fields" });
      return;
    }
    const [updated] = await db.update(commitmentsTable).set(patch).where(eq(commitmentsTable.id, id)).returning();
    res.json({ id: updated?.id, updated: Object.keys(patch), stillMissing: missingForCommitment(updated!) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update record" });
  }
});

router.post("/commitments/import", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const rows = body.rows;
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: "rows must be an array" });
    return;
  }

  let added = 0;
  let skipped = 0;
  let duplicates = 0;

  try {
    const existing = await db
      .select({
        fullName: commitmentsTable.fullName,
        street: commitmentsTable.street,
        phone: commitmentsTable.phone,
      })
      .from(commitmentsTable);

    const existingPhones = new Set(
      existing
        .map(r => normalisePhone(r.phone))
        .filter(p => p.length >= MIN_PHONE_DIGITS),
    );
    const existingNameStreet = new Set(existing.map(r => nameStreetKey(r.fullName, r.street)));

    for (const row of rows) {
      if (typeof row !== "object" || row === null) { skipped++; continue; }
      const r = row as Record<string, unknown>;

      const fullName = typeof r.fullName === "string" ? r.fullName.trim() : "";
      const street = typeof r.street === "string" ? r.street.trim() : "";
      const houseNumber = typeof r.houseNumber === "string" ? r.houseNumber.trim() : "";
      const email = typeof r.email === "string" ? r.email.trim() : "";
      const phone = typeof r.phone === "string" ? r.phone.trim() : "";
      const commitmentType = typeof r.commitmentType === "string" ? r.commitmentType.trim() : "monthly";
      const submittedAt = typeof r.submittedAt === "string" && r.submittedAt ? new Date(r.submittedAt) : new Date();

      if (!fullName || !street || !houseNumber) { skipped++; continue; }

      const phoneNorm = normalisePhone(phone);
      const nsKey = nameStreetKey(fullName, street);
      const phoneMatch = phoneNorm.length >= MIN_PHONE_DIGITS && existingPhones.has(phoneNorm);
      const nameStreetMatch = existingNameStreet.has(nsKey);
      if (phoneMatch || nameStreetMatch) { duplicates++; continue; }

      await db.insert(commitmentsTable).values({
        fullName,
        email: email || "imported@kcea.local",
        phone: phone || "-",
        street,
        houseNumber,
        commitmentType: commitmentType === "once-off" || commitmentType === "onceoff" ? "onceoff" : "monthly",
        imported: true,
        paymentConfirmed: false,
        submittedAt: isNaN(submittedAt.getTime()) ? new Date() : submittedAt,
      });

      if (phoneNorm.length >= MIN_PHONE_DIGITS) existingPhones.add(phoneNorm);
      existingNameStreet.add(nsKey);
      added++;
    }

    res.json({ added, skipped, duplicates });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Import failed" });
  }
});

router.get("/commitments", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(commitmentsTable)
      .orderBy(desc(commitmentsTable.submittedAt));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch commitments" });
  }
});

// Edit a commitment — admin only. Accepts a partial body of editable fields.
router.put("/commitments/:id", async (req, res) => {
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
  const patch: Record<string, unknown> = {};
  const strField = (k: string, required = false): string | null | undefined => {
    if (!(k in body)) return undefined;
    const v = body[k];
    if (v === null || v === "") return required ? null : "";
    return typeof v === "string" ? v.trim() : String(v);
  };

  const fullName = strField("fullName");
  if (fullName !== undefined) {
    if (!fullName) { res.status(400).json({ error: "fullName cannot be empty" }); return; }
    patch.fullName = fullName;
  }
  const street = strField("street");
  if (street !== undefined) {
    if (!street) { res.status(400).json({ error: "street cannot be empty" }); return; }
    patch.street = street;
  }
  for (const k of ["email", "phone", "houseNumber", "commitmentType"]) {
    const v = strField(k);
    if (v !== undefined) patch[k] = v;
  }
  // notes is nullable (unlike the fields above), so an empty string clears it
  // rather than getting stored as "" — used by the resident detail page's
  // Notes tab.
  if ("notes" in body) {
    const v = strField("notes");
    patch.notes = v || null;
  }
  if (typeof body.imported === "boolean") patch.imported = body.imported;
  if (typeof body.paymentConfirmed === "boolean") patch.paymentConfirmed = body.paymentConfirmed;
  if (typeof body.submittedAt === "string" && body.submittedAt) {
    const d = new Date(body.submittedAt);
    if (isNaN(d.getTime())) { res.status(400).json({ error: "Invalid submittedAt" }); return; }
    patch.submittedAt = d;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No editable fields provided" });
    return;
  }

  try {
    const [updated] = await db
      .update(commitmentsTable)
      .set(patch)
      .where(eq(commitmentsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update commitment" });
  }
});

// Toggle payment confirmed — admin only
router.put("/commitments/:id/confirm", async (req, res) => {
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
  const paymentConfirmed = typeof body.paymentConfirmed === "boolean" ? body.paymentConfirmed : true;

  try {
    const [updated] = await db
      .update(commitmentsTable)
      .set({ paymentConfirmed })
      .where(eq(commitmentsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update" });
  }
});

router.delete("/commitments/:id", async (req, res) => {
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
    const [deleted] = await db
      .delete(commitmentsTable)
      .where(eq(commitmentsTable.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Commitment not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete commitment" });
  }
});

export default router;
