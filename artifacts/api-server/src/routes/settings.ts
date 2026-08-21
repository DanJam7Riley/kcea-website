import { Router } from "express";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateSettings } from "../lib/settings";
import {
  isAdminReq,
  isPrimaryReq,
  getSecondaryPasswordSync,
  persistSecondaryPassword,
  SECONDARY_USERNAME,
  getTertiaryPasswordSync,
  persistTertiaryPassword,
  TERTIARY_USERNAME,
} from "../lib/admin-auth";

const router = Router();

router.get("/settings", async (req, res) => {
  if (!isAdminReq(req.headers)) {
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

// PRIMARY-ADMIN ONLY: view + update the secondary admin password (and surface the
// configured secondary username so the UI can show what to log in with).
router.get("/admin/secondary", (req, res) => {
  if (!isPrimaryReq(req.headers)) {
    res.status(403).json({ error: "Primary admin only" });
    return;
  }
  res.json({ username: SECONDARY_USERNAME, password: getSecondaryPasswordSync() });
});

router.put("/admin/secondary", async (req, res) => {
  if (!isPrimaryReq(req.headers)) {
    res.status(403).json({ error: "Primary admin only" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const newPw = typeof body.password === "string" ? body.password.trim() : "";
  if (newPw.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }
  try {
    await persistSecondaryPassword(newPw);
    res.json({ ok: true, username: SECONDARY_USERNAME, password: getSecondaryPasswordSync() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update secondary admin password" });
  }
});

// PRIMARY-ADMIN ONLY: view + update the third admin password, same pattern as secondary.
router.get("/admin/tertiary", (req, res) => {
  if (!isPrimaryReq(req.headers)) {
    res.status(403).json({ error: "Primary admin only" });
    return;
  }
  res.json({ username: TERTIARY_USERNAME, password: getTertiaryPasswordSync() });
});

router.put("/admin/tertiary", async (req, res) => {
  if (!isPrimaryReq(req.headers)) {
    res.status(403).json({ error: "Primary admin only" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const newPw = typeof body.password === "string" ? body.password.trim() : "";
  if (newPw.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }
  try {
    await persistTertiaryPassword(newPw);
    res.json({ ok: true, username: TERTIARY_USERNAME, password: getTertiaryPasswordSync() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update third admin password" });
  }
});

router.put("/settings", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };

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
