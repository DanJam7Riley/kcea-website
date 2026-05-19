import { Router } from "express";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateSettings } from "../lib/settings";

const router = Router();
const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD ?? "kcea2026";

router.get("/settings", async (req, res) => {
  const pw = req.headers["x-admin-password"] as string;
  if (!pw || pw !== ADMIN_PASSWORD()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const settings = await getOrCreateSettings();
    res.json(settings);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res) => {
  const pw = req.headers["x-admin-password"] as string;
  if (!pw || pw !== ADMIN_PASSWORD()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof body.twilioAccountSid === "string") {
    patch.twilioAccountSid = body.twilioAccountSid.trim() || null;
  }
  if (typeof body.twilioAuthToken === "string") {
    patch.twilioAuthToken = body.twilioAuthToken.trim() || null;
  }
  if (typeof body.twilioWhatsappFrom === "string") {
    patch.twilioWhatsappFrom = body.twilioWhatsappFrom.trim() || null;
  }
  if (typeof body.notifyWhatsapp === "string") {
    patch.notifyWhatsapp = body.notifyWhatsapp.trim() || null;
  }

  try {
    const existing = await getOrCreateSettings();
    const [updated] = await db
      .update(siteSettingsTable)
      .set(patch)
      .where(eq(siteSettingsTable.id, existing.id))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
