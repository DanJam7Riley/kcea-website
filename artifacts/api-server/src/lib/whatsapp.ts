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

export function adminCommitmentMsg(name: string, street: string, houseNumber: string, phone: string): string {
  return `New commitment: ${name} - ${street}, ${houseNumber}. Phone: ${phone}. Submitted via website.`;
}

export function adminCaptainApplicationMsg(name: string, street: string, phone: string, email: string): string {
  return `New captain application: ${name} wants to captain ${street}. Phone: ${phone}. Email: ${email}. Log in to admin to approve.`;
}

export function adminIncompleteRecordMsg(street: string, houseNumber: string, missingFields: string[]): string {
  return `Incomplete record: ${street}, ${houseNumber} is missing ${missingFields.join(" and ")}. Check admin Incomplete Records tab.`;
}
