import { Router } from "express";
import { db, siteStatsTable, commitmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const DEFAULT_TARGET = 680;

async function getOrCreateSettings() {
  const rows = await db.select().from(siteStatsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db
    .insert(siteStatsTable)
    .values({ committedHouseholds: 0, monthlyContributions: 0, targetHouseholds: DEFAULT_TARGET, fundingPercent: 0 })
    .returning();
  return created;
}

async function calcStats(targetHouseholds: number) {
  const all = await db.select({ commitmentType: commitmentsTable.commitmentType }).from(commitmentsTable);
  const committedHouseholds = all.length;
  const monthlyContributions = all.filter(c => c.commitmentType === "monthly").length * 250;
  const fundingPercent = targetHouseholds > 0
    ? Math.min(100, Math.round((committedHouseholds / targetHouseholds) * 100))
    : 0;
  return { committedHouseholds, monthlyContributions, targetHouseholds, fundingPercent };
}

router.post("/admin/verify", (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ ok: true });
});

router.get("/stats", async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json(await calcStats(settings.targetHouseholds ?? DEFAULT_TARGET));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.put("/stats", async (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const patch: Partial<{ targetHouseholds: number }> = {};
  if (typeof body.targetHouseholds === "number") patch.targetHouseholds = Math.max(1, Math.floor(body.targetHouseholds));

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  try {
    const settings = await getOrCreateSettings();
    await db.update(siteStatsTable).set({ ...patch, updatedAt: new Date() }).where(eq(siteStatsTable.id, settings.id));
    const newTarget = patch.targetHouseholds ?? settings.targetHouseholds ?? DEFAULT_TARGET;
    res.json(await calcStats(newTarget));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update stats" });
  }
});

export default router;
