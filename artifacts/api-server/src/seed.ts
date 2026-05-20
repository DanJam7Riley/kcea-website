import { db, siteStatsTable, streetCaptainsTable, commitmentsTable } from "@workspace/db";
import { count, eq, isNull, or, sql } from "drizzle-orm";
import { logger } from "./lib/logger";

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

/** Backfill captain phone/email from matching commitment by name + street. Idempotent. */
async function backfillCaptainPhones(): Promise<number> {
  const captains = await db
    .select()
    .from(streetCaptainsTable)
    .where(or(isNull(streetCaptainsTable.phone), eq(streetCaptainsTable.phone, "")));
  let updated = 0;
  for (const c of captains) {
    if (c.captain === "Unassigned") continue;
    const matches = await db
      .select()
      .from(commitmentsTable)
      .where(
        sql`LOWER(${commitmentsTable.fullName}) = LOWER(${c.captain}) AND LOWER(${commitmentsTable.street}) = LOWER(${c.street})`,
      )
      .limit(1);
    const m = matches[0];
    if (!m) continue;
    const patch: Record<string, unknown> = {};
    if (m.phone && m.phone !== "Unknown") patch.phone = m.phone;
    if (m.email && m.email !== "Unknown" && !c.email) patch.email = m.email;
    if (Object.keys(patch).length > 0) {
      await db.update(streetCaptainsTable).set(patch).where(eq(streetCaptainsTable.id, c.id));
      updated++;
    }
  }
  return updated;
}

/** Self-healing schema guard — runs before any reads. Idempotent ADD COLUMN IF NOT EXISTS. */
async function ensureSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE street_captains ADD COLUMN IF NOT EXISTS welcomed_at timestamp`);
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

    const phones = await backfillCaptainPhones();
    if (phones > 0) logger.info({ updated: phones }, "Backfilled captain phones from commitments");
  } catch (err) {
    logger.warn({ err }, "Seed skipped — DB may not be ready yet");
  }
}
