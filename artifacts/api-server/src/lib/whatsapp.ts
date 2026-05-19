import twilio from "twilio";
import { getTwilioCredentials } from "./settings";

export async function sendWhatsApp(body: string, to: string): Promise<void> {
  const { accountSid, authToken, from } = await getTwilioCredentials();

  if (!accountSid || !authToken || !to) {
    return;
  }

  const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const fromFormatted = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

  const client = twilio(accountSid, authToken);
  await client.messages.create({ from: fromFormatted, to: toFormatted, body });
}

export function pinMessage(name: string, pin: string): string {
  return `Hi ${name}, your KCEA Captain Portal PIN is: ${pin}. Login at: attached-assets-janineriley.replit.app/captain-login`;
}
