import { Router } from "express";
import { sendWhatsApp, testMessage } from "../lib/whatsapp";

const router = Router();

router.post("/notify/test", async (req, res) => {
  const password = req.headers["x-admin-password"] as string;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "kcea2026";
  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const to = process.env.NOTIFY_WHATSAPP_NUMBER;

  if (!accountSid || !authToken || !to) {
    res.status(400).json({
      error: "WhatsApp not configured",
      missing: [
        ...(!accountSid ? ["TWILIO_ACCOUNT_SID"] : []),
        ...(!authToken ? ["TWILIO_AUTH_TOKEN"] : []),
        ...(!to ? ["NOTIFY_WHATSAPP_NUMBER"] : []),
      ],
    });
    return;
  }

  try {
    await sendWhatsApp(testMessage());
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: "Failed to send test message", detail: message });
  }
});

export default router;
