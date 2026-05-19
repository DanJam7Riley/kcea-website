import twilio from "twilio";

export async function sendWhatsApp(body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";
  const to = process.env.NOTIFY_WHATSAPP_NUMBER;

  if (!accountSid || !authToken || !to) {
    return; // not configured — skip silently
  }

  const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  const client = twilio(accountSid, authToken);
  await client.messages.create({ from, to: toFormatted, body });
}

export function commitmentMessage(
  fullName: string,
  street: string,
  houseNumber: string,
  phone: string,
  commitmentType: string,
): string {
  const typeLabel = commitmentType === "onceoff" ? "R3,000 once-off" : "R250/month";
  const date = new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  return `New KCEA Commitment ✔️\nName: ${fullName}\nStreet: ${street} No. ${houseNumber}\nPhone: ${phone}\nCommitment: ${typeLabel}\nDate: ${date}`;
}

export function volunteerMessage(fullName: string, street: string, phone: string): string {
  return `New Captain Volunteer ★\nName: ${fullName}\nStreet: ${street}\nPhone: ${phone}`;
}

export function testMessage(): string {
  return `KCEA admin notification test ✔️\nIf you received this, WhatsApp notifications are working correctly.`;
}
