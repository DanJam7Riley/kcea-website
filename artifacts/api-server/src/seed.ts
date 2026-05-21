import { db, siteStatsTable, streetCaptainsTable, commitmentsTable, captainProfilesTable } from "@workspace/db";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { logger } from "./lib/logger";

/** Canonical name renames so street_captains.captain matches captain_profiles.name exactly. */
const NAME_NORMALIZATIONS: Array<{ street: string; from: string; to: string }> = [
  { street: "Orion",   from: "Ingrid",  to: "Ingrid Bester" },
  { street: "Mildura", from: "Garren",  to: "Garren Pillay" },
];

/** Captains that should be removed (e.g. assists tracked as a note on the primary captain). */
const REMOVE_CAPTAINS: Array<{ street: string; captain: string }> = [
  { street: "Mildura", captain: "Feroze" },
];

/** Stale captain_profiles rows superseded by canonical names. Merged into target then deleted. */
const PROFILE_RENAMES: Array<{ from: string; to: string }> = [
  { from: "Ingrid",                 to: "Ingrid Bester" },
  { from: "Garren (Feroze assist)", to: "Garren Pillay" },
  { from: "Garren",                 to: "Garren Pillay" },
];

const SEED_CAPTAINS = [
  { street: "Derby",        captain: "Carina",          forms: 30, status: "Strong"      },
  { street: "Orion",        captain: "Ingrid",          forms: 19, status: "Strong"      },
  { street: "Protea",       captain: "Priscilla",       forms: 17, status: "Good"        },
  { street: "Osprey",       captain: "Jo-Anne",         forms: 15, status: "Solid"       },
  { street: "Onyx",         captain: "Maria D'Alves",   forms: 13, status: "Good"        },
  { street: "Westmoreland", captain: "Unassigned",      forms: 13, status: "Steady"      },
  { street: "Ocean",        captain: "Geoff",           forms: 12, status: "In Progress" },
  { street: "Nymphe",       captain: "Maria D'Alves",   forms: 11, status: "In Progress" },
  { street: "Highlands",    captain: "Unassigned",      forms: 11, status: "In Progress" },
  { street: "Orwell",       captain: "Unassigned",      forms: 9,  status: "Good"        },
  { street: "Nottingham",   captain: "Kerstin",         forms: 8,  status: "In Progress" },
  { street: "Leicester",    captain: "Unassigned",      forms: 8,  status: "In Progress" },
  { street: "Panther",      captain: "Paul Arokiam",    forms: 8,  status: "In Progress" },
  { street: "Nile",         captain: "Unassigned",      forms: 7,  status: "In Progress" },
  { street: "Phoenix",      captain: "Unassigned",      forms: 7,  status: "In Progress" },
  { street: "Ernest",       captain: "Unassigned",      forms: 1,  status: "Critical"    },
  { street: "Milner",       captain: "Unassigned",      forms: 1,  status: "Critical"    },
  { street: "Patrol",       captain: "Unassigned",      forms: 1,  status: "Critical"    },
  { street: "Mildura",      captain: "Garren / Feroze", forms: 0,  status: "Critical"    },
  // Earls Court is a complex located on Nile Street, Kensington — tracked separately.
  { street: "Earls Court",  captain: "Unassigned",      forms: 0,  status: "Critical"    },
];

const ACTIVE_SPLIT_NAMES = new Set(["Jason van Wyngaard"]);

/** Split any "A / B" combined captain names into separate rows. Idempotent. */
async function splitCombinedCaptains(): Promise<number> {
  const rows = await db.select().from(streetCaptainsTable);
  let inserted = 0;
  for (const row of rows) {
    if (!row.captain.includes(" / ")) continue;
    const names = row.captain.split(" / ").map(n => n.trim()).filter(Boolean);
    if (names.length < 2) continue;
    const [first, ...rest] = names;
    if (!first) continue;
    await db.update(streetCaptainsTable).set({ captain: first }).where(eq(streetCaptainsTable.id, row.id));
    for (const name of rest) {
      const exists = rows.some(r => r.street === row.street && r.captain === name && r.id !== row.id);
      if (exists) continue;
      await db.insert(streetCaptainsTable).values({
        street: row.street,
        captain: name,
        forms: row.forms,
        status: row.status,
        phone: null,
        email: null,
        motivation: row.motivation ?? null,
        captainStatus: ACTIVE_SPLIT_NAMES.has(name) ? "Active Captain" : row.captainStatus,
      });
      inserted++;
    }
  }
  return inserted;
}

/** Self-healing schema guard — runs before any reads. Idempotent ADD COLUMN IF NOT EXISTS. */
async function ensureSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE street_captains ADD COLUMN IF NOT EXISTS welcomed_at timestamp`);
  await db.execute(sql`ALTER TABLE captain_profiles ADD COLUMN IF NOT EXISTS previous_login_at timestamp`);
  await db.execute(sql`ALTER TABLE captain_profiles ADD COLUMN IF NOT EXISTS pin_sent_at timestamp`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pledges (
      id serial PRIMARY KEY,
      full_name text NOT NULL,
      phone text NOT NULL,
      email text NOT NULL,
      amount integer NOT NULL,
      is_resident boolean NOT NULL DEFAULT false,
      street text,
      house_number text,
      message text,
      commitment_id integer,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE street_captains ADD COLUMN IF NOT EXISTS target_households integer NOT NULL DEFAULT 30`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS captain_resident_contacts (
      id serial PRIMARY KEY,
      captain_profile_id integer NOT NULL,
      commitment_id integer NOT NULL,
      contacted_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS captain_resident_contacts_unique
    ON captain_resident_contacts (captain_profile_id, commitment_id)
  `);
}

/** Ensure Janine Riley (12 Nile St) is on the commitments roster. Idempotent: matches on email+street, won't duplicate. */
async function ensureJanineRileyCommitment(): Promise<void> {
  const email = "janine.riley@me.com";
  const street = "Nile";
  const existing = await db
    .select({ id: commitmentsTable.id })
    .from(commitmentsTable)
    .where(and(eq(commitmentsTable.email, email), eq(commitmentsTable.street, street)))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(commitmentsTable).values({
    fullName: "Janine Riley",
    email,
    phone: "0832355052",
    street,
    houseNumber: "12",
    commitmentType: "monthly",
    imported: true,
    paymentConfirmed: false,
  });
  logger.info({ email, street }, "Inserted missing Janine Riley commitment");
}

/** Seed real household targets per street. Only updates rows still at default (30) so admin edits are preserved. */
const STREET_TARGET_DEFAULTS: Record<string, number> = {
  Derby: 60, Orion: 40, Protea: 40, Osprey: 35, Onyx: 35, Nile: 35,
  Ocean: 30, Nymphe: 30, Westmoreland: 30,
  Highlands: 25, Leicester: 25, Panther: 25, Nottingham: 25, Phoenix: 25, Orwell: 25,
  Mildura: 20, Ernest: 20, Milner: 20, Patrol: 20,
};
async function ensureStreetTargets(): Promise<void> {
  for (const [street, target] of Object.entries(STREET_TARGET_DEFAULTS)) {
    await db
      .update(streetCaptainsTable)
      .set({ targetHouseholds: target })
      .where(and(eq(streetCaptainsTable.street, street), eq(streetCaptainsTable.targetHouseholds, 30)));
  }
}

/** One-time backfill: mark these captains as having had their PIN sent on 2026-05-21.
 *  Idempotent: only sets pin_sent_at when it is currently NULL, so re-sends or admin edits are preserved. */
const PIN_SENT_BACKFILL: Array<{ name: string }> = [
  { name: "Irene Goodwin" },
  { name: "Janine Riley" },
  { name: "Jason van Wyngaard" },
  { name: "Jo-Anne" },
];
async function ensureCaptainPinSentBackfill(): Promise<void> {
  const when = new Date("2026-05-21T12:00:00Z");
  for (const { name } of PIN_SENT_BACKFILL) {
    await db
      .update(captainProfilesTable)
      .set({ pinSentAt: when })
      .where(and(eq(captainProfilesTable.name, name), isNull(captainProfilesTable.pinSentAt)));
  }
}

/** Apply canonical name renames + remove non-captain assist rows. Idempotent. */
async function applyNameNormalizations(): Promise<void> {
  for (const n of NAME_NORMALIZATIONS) {
    await db
      .update(streetCaptainsTable)
      .set({ captain: n.to })
      .where(and(eq(streetCaptainsTable.street, n.street), eq(streetCaptainsTable.captain, n.from)));
  }
  for (const r of REMOVE_CAPTAINS) {
    await db
      .delete(streetCaptainsTable)
      .where(and(eq(streetCaptainsTable.street, r.street), eq(streetCaptainsTable.captain, r.captain)));
  }
}

/** Merge stale captain_profiles into canonical row (preserving phone/pin/pinHash/lastLoginAt),
 *  re-point captain_tokens, then delete the stale row. Idempotent and lockout-safe. */
async function mergeAndRemoveStaleProfiles(): Promise<number> {
  let removed = 0;
  for (const { from, to } of PROFILE_RENAMES) {
    const [stale] = await db.select().from(captainProfilesTable).where(eq(captainProfilesTable.name, from));
    if (!stale) continue;

    let [target] = await db.select().from(captainProfilesTable).where(eq(captainProfilesTable.name, to));
    if (!target) {
      // No canonical row yet — just rename the stale row in place.
      await db.update(captainProfilesTable).set({ name: to }).where(eq(captainProfilesTable.id, stale.id));
      removed++;
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (!target.phone && stale.phone) patch.phone = stale.phone;
    if (!target.pinHash && stale.pinHash) {
      patch.pinHash = stale.pinHash;
      if (stale.pin) patch.pin = stale.pin;
    }
    if (!target.lastLoginAt && stale.lastLoginAt) patch.lastLoginAt = stale.lastLoginAt;
    if (Object.keys(patch).length > 0) {
      await db.update(captainProfilesTable).set(patch).where(eq(captainProfilesTable.id, target.id));
    }
    // Re-point any auth tokens from stale → canonical so sessions survive the merge.
    await db.execute(
      sql`UPDATE captain_tokens SET profile_id = ${target.id} WHERE profile_id = ${stale.id}`,
    );
    await db.delete(captainProfilesTable).where(eq(captainProfilesTable.id, stale.id));
    removed++;
  }
  return removed;
}

/** Ensure a captain_profiles row exists for every assigned street_captains.captain. */
async function syncCaptainProfiles(): Promise<number> {
  const captains = await db.select().from(streetCaptainsTable);
  const profiles = await db.select().from(captainProfilesTable);
  const existing = new Set(profiles.map(p => p.name));
  const needed = new Set<string>();
  for (const c of captains) {
    if (c.captain && c.captain !== "Unassigned") needed.add(c.captain);
  }
  const toInsert = [...needed].filter(n => !existing.has(n));
  if (toInsert.length > 0) {
    await db.insert(captainProfilesTable).values(toInsert.map(name => ({ name })));
  }
  return toInsert.length;
}

/** Normalize a name to lowercase alphanumeric tokens (handles "Jo-Anne" → ["joanne"]). */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

/** Length of shared prefix between two strings. */
function sharedPrefixLen(a: string, b: string): number {
  let i = 0;
  const max = Math.min(a.length, b.length);
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/** Score how well a captain name matches a commitment name, ignoring whitespace/punctuation.
 *  Higher = better. 0 means no match. */
function matchScore(captainName: string, commitmentName: string): number {
  const ct = nameTokens(captainName);
  const mt = nameTokens(commitmentName);
  if (ct.length === 0 || mt.length === 0) return 0;
  // Exact full normalized match
  if (ct.join(" ") === mt.join(" ")) return 1000;
  // Best token-pair shared prefix (require >=4 chars to avoid coincidental false hits like "mar"/"martineit").
  let best = 0;
  for (const a of ct) {
    for (const b of mt) {
      if (a === b) { best = Math.max(best, 50 + a.length); continue; }
      const sp = sharedPrefixLen(a, b);
      if (sp >= 4) best = Math.max(best, sp);
    }
  }
  return best;
}

/** For a captain (name+street), find best matching commitment phone using street + fuzzy name.
 *  Small-street fallback: if a street has ≤2 commitments with a phone, use the first one regardless of name. */
function findFuzzyCommitment(
  captainName: string,
  captainStreet: string,
  commitments: Array<{ fullName: string | null; phone: string | null; email: string | null; street: string | null }>,
): { match: { fullName: string; phone: string | null; email: string | null } | null; score: number; runnerUp: number; candidates: number; via: "exact" | "fuzzy" | "small-street" | "none" } {
  const street = captainStreet.trim().toLowerCase();
  const onStreet = commitments.filter(c => (c.street ?? "").trim().toLowerCase() === street);
  const withPhone = onStreet.filter(c => c.phone && c.phone.trim() && c.phone.trim() !== "-");

  // Phase A: try name-based fuzzy match
  let best: { fullName: string; phone: string | null; email: string | null; score: number } | null = null;
  let second = 0;
  for (const c of onStreet) {
    if (!c.fullName) continue;
    const s = matchScore(captainName, c.fullName);
    if (s <= 0) continue;
    if (!best || s > best.score) {
      if (best) second = Math.max(second, best.score);
      best = { fullName: c.fullName, phone: c.phone, email: c.email, score: s };
    } else if (s > second) {
      second = s;
    }
  }
  if (best && !(best.score < 50 && second >= best.score - 1)) {
    return { match: best, score: best.score, runnerUp: second, candidates: onStreet.length, via: best.score >= 1000 ? "exact" : "fuzzy" };
  }

  // Phase B: small-street fallback — ≤2 commitments with a phone on this street → very likely the captain.
  if (withPhone.length > 0 && withPhone.length <= 2 && withPhone[0]) {
    const c = withPhone[0];
    return {
      match: { fullName: c.fullName ?? "(unknown)", phone: c.phone, email: c.email },
      score: 1, runnerUp: 0, candidates: onStreet.length, via: "small-street",
    };
  }

  return { match: null, score: 0, runnerUp: second, candidates: onStreet.length, via: "none" };
}

export type PhoneBackfillReport = {
  matched: Array<{ name: string; street: string; commitment: string; phone: string | null; via: string }>;
  ambiguous: Array<{ name: string; street: string; topScore: number; runnerUp: number }>;
  unmatched: Array<{ name: string; street: string; candidates: number }>;
  scUpdated: number;
  profilesUpdated: number;
};

/** Backfill phones into street_captains AND captain_profiles using fuzzy street+name match. */
async function backfillPhonesEverywhere(): Promise<PhoneBackfillReport> {
  const commitments = await db.select().from(commitmentsTable);
  const scRows = await db.select().from(streetCaptainsTable);
  const cpRows = await db.select().from(captainProfilesTable);

  const report: PhoneBackfillReport = { matched: [], ambiguous: [], unmatched: [], scUpdated: 0, profilesUpdated: 0 };

  // Phase 1: street_captains (we have street here)
  for (const c of scRows) {
    if (c.captain === "Unassigned" || c.phone) continue;
    const r = findFuzzyCommitment(c.captain, c.street, commitments);
    if (!r.match) {
      report.unmatched.push({ name: c.captain, street: c.street, candidates: r.candidates });
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (r.match.phone) patch.phone = r.match.phone;
    if (r.match.email && !c.email) patch.email = r.match.email;
    if (Object.keys(patch).length > 0) {
      await db.update(streetCaptainsTable).set(patch).where(eq(streetCaptainsTable.id, c.id));
      report.scUpdated++;
      report.matched.push({ name: c.captain, street: c.street, commitment: r.match.fullName, phone: r.match.phone, via: r.via });
    }
  }

  // Phase 2: captain_profiles — propagate phones from street_captains by exact name match
  // (street_captains is the authoritative source after Phase 1).
  const refreshedSc = await db.select().from(streetCaptainsTable);
  const phoneByCaptainName = new Map<string, string>();
  for (const c of refreshedSc) {
    if (c.captain === "Unassigned" || !c.phone) continue;
    const key = c.captain.trim().toLowerCase();
    if (!phoneByCaptainName.has(key)) phoneByCaptainName.set(key, c.phone);
  }
  for (const p of cpRows) {
    if (p.phone) continue;
    const phone = phoneByCaptainName.get(p.name.trim().toLowerCase());
    if (phone) {
      await db.update(captainProfilesTable).set({ phone }).where(eq(captainProfilesTable.id, p.id));
      report.profilesUpdated++;
    }
  }

  return report;
}

/** Idempotent corrections for known bad data. Runs every boot.
 *  - Jason van Wyngaard's number was captured as 0523732412 (typo); correct value is 0823732412.
 *  - Paul Arokiam on Panther erroneously inherited Jason's phone via the small-street fallback;
 *    blank it so the admin can enter Paul's real number. (Stable: rerun is a no-op once Paul has
 *    either no phone or a different phone from Jason.) */
async function correctKnownBadPhones(): Promise<{ jasonFixed: number; paulBlanked: number }> {
  const WRONG = "0523732412";
  const CORRECT = "0823732412";
  let jasonFixed = 0;
  let paulBlanked = 0;

  // 1) Fix Jason wherever the wrong number still exists.
  const cFix = await db.update(commitmentsTable)
    .set({ phone: CORRECT })
    .where(and(eq(commitmentsTable.phone, WRONG), sql`lower(${commitmentsTable.fullName}) like '%jason%'`))
    .returning({ id: commitmentsTable.id });
  jasonFixed += cFix.length;

  const pFix = await db.update(captainProfilesTable)
    .set({ phone: CORRECT })
    .where(and(eq(captainProfilesTable.phone, WRONG), sql`lower(${captainProfilesTable.name}) like '%jason%'`))
    .returning({ id: captainProfilesTable.id });
  jasonFixed += pFix.length;

  const sFix = await db.update(streetCaptainsTable)
    .set({ phone: CORRECT })
    .where(and(eq(streetCaptainsTable.phone, WRONG), sql`lower(${streetCaptainsTable.captain}) like '%jason%'`))
    .returning({ id: streetCaptainsTable.id });
  jasonFixed += sFix.length;

  // 2) Blank Paul Arokiam's phone IF it equals either the old wrong value or the (now correct) Jason number.
  //    This counters the small-street fallback that copies Jason's commitment phone to Paul on Panther.
  const paulBadValues = [WRONG, CORRECT];
  for (const v of paulBadValues) {
    const pp = await db.update(captainProfilesTable)
      .set({ phone: null })
      .where(and(eq(captainProfilesTable.phone, v), sql`lower(${captainProfilesTable.name}) like '%paul arokiam%'`))
      .returning({ id: captainProfilesTable.id });
    paulBlanked += pp.length;

    const ps = await db.update(streetCaptainsTable)
      .set({ phone: null })
      .where(and(eq(streetCaptainsTable.phone, v), sql`lower(${streetCaptainsTable.captain}) like '%paul arokiam%'`))
      .returning({ id: streetCaptainsTable.id });
    paulBlanked += ps.length;
  }

  return { jasonFixed, paulBlanked };
}

/**
 * Idempotent dedupe: for any street where multiple captain rows exist AND at least one of them
 * is "empty" (Unassigned or blank captain name), delete the empty row(s) — keep the named ones.
 * Legitimate co-captain streets (all rows have real names) are untouched.
 */
async function dedupeEmptyCaptainRows(): Promise<Array<{ id: number; street: string; captain: string }>> {
  const all = await db.select({
    id: streetCaptainsTable.id,
    street: streetCaptainsTable.street,
    captain: streetCaptainsTable.captain,
  }).from(streetCaptainsTable);

  const byStreet = new Map<string, typeof all>();
  for (const r of all) {
    const k = r.street.toLowerCase();
    const arr = byStreet.get(k) ?? [];
    arr.push(r);
    byStreet.set(k, arr);
  }

  const toDelete: Array<{ id: number; street: string; captain: string }> = [];
  for (const rows of byStreet.values()) {
    if (rows.length < 2) continue;
    const named = rows.filter(r => r.captain && r.captain.trim() && r.captain.trim().toLowerCase() !== "unassigned");
    const empty = rows.filter(r => !r.captain || !r.captain.trim() || r.captain.trim().toLowerCase() === "unassigned");
    if (named.length >= 1 && empty.length >= 1) {
      toDelete.push(...empty);
    }
  }

  for (const r of toDelete) {
    await db.delete(streetCaptainsTable).where(eq(streetCaptainsTable.id, r.id));
  }
  return toDelete;
}

export async function seedIfEmpty(): Promise<void> {
  try {
    await ensureSchema();
    logger.info("Schema guards applied");
  } catch (err) {
    logger.error({ err }, "Schema guard FAILED — captain queries may break until resolved");
  }

  try {
    const [statsRow] = await db.select({ n: count() }).from(siteStatsTable);
    if ((statsRow?.n ?? 0) === 0) {
      await db.insert(siteStatsTable).values({
        committedHouseholds: 191,
        monthlyContributions: 47750,
        targetHouseholds: 680,
        fundingPercent: 28,
      });
      logger.info("Seeded site_stats");
    }

    const [captainsRow] = await db.select({ n: count() }).from(streetCaptainsTable);
    if ((captainsRow?.n ?? 0) === 0) {
      await db.insert(streetCaptainsTable).values(SEED_CAPTAINS);
      logger.info({ rows: SEED_CAPTAINS.length }, "Seeded street_captains");
    }

    // Self-healing migrations — idempotent, run every boot.
    const splits = await splitCombinedCaptains();
    if (splits > 0) logger.info({ inserted: splits }, "Auto-split combined captains");

    await applyNameNormalizations();

    const staleRemoved = await mergeAndRemoveStaleProfiles();
    if (staleRemoved > 0) logger.info({ merged: staleRemoved }, "Merged stale captain_profiles into canonical names");

    const profilesAdded = await syncCaptainProfiles();
    if (profilesAdded > 0) logger.info({ added: profilesAdded }, "Synced captain_profiles from street_captains");

    const phones = await backfillPhonesEverywhere();
    logger.info(
      { scUpdated: phones.scUpdated, profilesUpdated: phones.profilesUpdated, ambiguous: phones.ambiguous.length, unmatched: phones.unmatched.length },
      "Phone backfill complete",
    );
    for (const m of phones.matched) {
      logger.info({ captain: m.name, street: m.street, commitment: m.commitment, phone: m.phone }, "phone matched");
    }
    for (const u of phones.unmatched) {
      logger.info({ captain: u.name, street: u.street, candidates: u.candidates }, "phone NOT matched");
    }
    for (const a of phones.ambiguous) {
      logger.info(a, "phone match ambiguous — skipped");
    }

    // Ensure Janine Riley's commitment for Nile Street is on the roster (idempotent).
    try { await ensureJanineRileyCommitment(); } catch (err) { logger.warn({ err }, "Janine commitment ensure failed"); }

    // Seed per-street household targets (only if still at the prior default of 30 — never overwrites admin edits).
    try { await ensureStreetTargets(); } catch (err) { logger.warn({ err }, "Street target seeding failed"); }

    // Backfill pin_sent_at for captains whose PINs were sent manually before the button persisted state.
    try { await ensureCaptainPinSentBackfill(); } catch (err) { logger.warn({ err }, "PIN-sent backfill failed"); }

    // Remove duplicate captain rows: if a street has an Unassigned/empty row AND a named row,
    // delete the Unassigned one. Co-captain streets (multiple named rows) are preserved.
    try {
      const removed = await dedupeEmptyCaptainRows();
      if (removed.length > 0) {
        logger.info({ removed }, "Removed duplicate Unassigned captain rows");
      }
    } catch (err) { logger.warn({ err }, "Captain dedupe failed"); }

    // Run AFTER backfill so this overrides any small-street re-fill of Paul's phone.
    const corrections = await correctKnownBadPhones();
    if (corrections.jasonFixed > 0 || corrections.paulBlanked > 0) {
      logger.info(corrections, "Applied known-bad-phone corrections (Jason fix + Paul blank)");
    }
  } catch (err) {
    logger.warn({ err }, "Seed skipped — DB may not be ready yet");
  }
}
