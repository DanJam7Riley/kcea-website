import { db, siteStatsTable, streetCaptainsTable } from "@workspace/db";
import { count } from "drizzle-orm";
import { logger } from "./lib/logger";

const SEED_CAPTAINS = [
  { street: "Derby",        captain: "Carina",          forms: 30, status: "Strong"      },
  { street: "Orion",        captain: "Ingrid",           forms: 19, status: "Strong"      },
  { street: "Protea",       captain: "Priscilla",        forms: 17, status: "Good"        },
  { street: "Osprey",       captain: "Jo-Anne",          forms: 15, status: "Solid"       },
  { street: "Onyx",         captain: "Maria D'Alves",    forms: 13, status: "Good"        },
  { street: "Westmoreland", captain: "Unassigned",       forms: 13, status: "Steady"      },
  { street: "Ocean",        captain: "Geoff",            forms: 12, status: "In Progress" },
  { street: "Nymphe",       captain: "Maria D'Alves",    forms: 11, status: "In Progress" },
  { street: "Highlands",    captain: "Unassigned",       forms: 11, status: "In Progress" },
  { street: "Orwell",       captain: "Unassigned",       forms: 9,  status: "Good"        },
  { street: "Nottingham",   captain: "Kerstin",          forms: 8,  status: "In Progress" },
  { street: "Leicester",    captain: "Unassigned",       forms: 8,  status: "In Progress" },
  { street: "Panther",      captain: "Paul Arokiam",     forms: 8,  status: "In Progress" },
  { street: "Nile",         captain: "Unassigned",       forms: 7,  status: "In Progress" },
  { street: "Phoenix",      captain: "Unassigned",       forms: 7,  status: "In Progress" },
  { street: "Ernest",       captain: "Unassigned",       forms: 1,  status: "Critical"    },
  { street: "Milner",       captain: "Unassigned",       forms: 1,  status: "Critical"    },
  { street: "Patrol",       captain: "Unassigned",       forms: 1,  status: "Critical"    },
  { street: "Mildura",      captain: "Garren / Feroze",  forms: 0,  status: "Critical"    },
];

export async function seedIfEmpty(): Promise<void> {
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
  } catch (err) {
    logger.warn({ err }, "Seed skipped — DB may not be ready yet");
  }
}
