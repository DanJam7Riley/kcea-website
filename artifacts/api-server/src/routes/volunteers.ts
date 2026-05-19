import { Router } from "express";
import nodemailer from "nodemailer";
import { db, volunteersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

async function sendVolunteerEmail(fullName: string, street: string) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return; // SMTP not configured — skip silently
  }

  try {
    const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    await transporter.sendMail({
      from: user,
      to: "kcea.kensington@gmail.com",
      subject: `New Volunteer — ${fullName} — ${street}`,
      text: `A new volunteer has signed up to captain a street.\n\nName: ${fullName}\nStreet: ${street}\n\nLog in to the admin dashboard to see full details.`,
    });
  } catch {
    // email failure should never block the response
  }
}

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

    void sendVolunteerEmail(fullName, street);

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
