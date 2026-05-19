import { Router } from "express";
import { db, volunteersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { sendWhatsApp, volunteerMessage } from "../lib/whatsapp";
import { getNotifyNumber } from "../lib/settings";

const router = Router();

router.post("/volunteers", async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const street = typeof body.street === "string" ? body.street.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const motivation = typeof body.motivation === "string" ? body.motivation.trim() : undefined;

  if (!fullName || !street || !phone || !email) {
    res.status(400).json({ error: "Name, street, phone and email are required" });
    return;
  }

  try {
    const [created] = await db
      .insert(volunteersTable)
      .values({ fullName, street, phone, email, motivation: motivation || null })
      .returning();

    void getNotifyNumber().then(to => sendWhatsApp(volunteerMessage(fullName, street, phone), to)).catch(() => {});

    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save volunteer" });
  }
});

router.get("/volunteers", async (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(volunteersTable)
      .orderBy(desc(volunteersTable.submittedAt));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch volunteers" });
  }
});

router.delete("/volunteers/:id", async (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
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
      .delete(volunteersTable)
      .where(eq(volunteersTable.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Volunteer not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete volunteer" });
  }
});

export default router;
