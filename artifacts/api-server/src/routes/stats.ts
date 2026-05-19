import { Router } from "express";
import { db, siteStatsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const DEFAULT_STATS = {
  committedHouseholds: 191,
  monthlyContributions: 47750,
  targetHouseholds: 680,
  fundingPercent: 28,
};

async function getOrCreateStats() {
  const rows = await db.select().from(siteStatsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db
    .insert(siteStatsTable)
    .values(DEFAULT_STATS)
    .returning();
  return created;
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
    const stats = await getOrCreateStats();
    res.json(stats);
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
  const patch: Partial<typeof DEFAULT_STATS> = {};

  if (typeof body.committedHouseholds === "number") patch.committedHouseholds = Math.max(0, Math.floor(body.committedHouseholds));
  if (typeof body.monthlyContributions === "number") patch.monthlyContributions = Math.max(0, Math.floor(body.monthlyContributions));
  if (typeof body.targetHouseholds === "number") patch.targetHouseholds = Math.max(1, Math.floor(body.targetHouseholds));
  if (typeof body.fundingPercent === "number") patch.fundingPercent = Math.min(100, Math.max(0, Math.floor(body.fundingPercent)));

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid fields provided" });
    return;
  }

  try {
    const stats = await getOrCreateStats();
    const [updated] = await db
      .update(siteStatsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(siteStatsTable.id, stats.id))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update stats" });
  }
});

export default router;
