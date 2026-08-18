// Communication log — a record of what's actually been sent to a resident
// (invoice emails, test sends, statements). Admin-only read; rows are
// written from wherever a real send happens (see logCommunication, called
// from invoices.ts's send-all/send-test routes).
import { Router } from "express";
import { db, communicationLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { isAdminReq } from "../lib/admin-auth";

const router = Router();

export async function logCommunication(params: {
  commitmentId: number;
  channel?: string;
  type: string;
  subject: string;
  recipient?: string;
}): Promise<void> {
  await db.insert(communicationLogTable).values({
    commitmentId: params.commitmentId,
    channel: params.channel ?? "email",
    type: params.type,
    subject: params.subject,
    recipient: params.recipient ?? null,
  });
}

router.get("/commitments/:id/communications", async (req, res) => {
  if (!isAdminReq(req.headers)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(communicationLogTable)
      .where(eq(communicationLogTable.commitmentId, id))
      .orderBy(desc(communicationLogTable.sentAt));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch communications" });
  }
});

export default router;
