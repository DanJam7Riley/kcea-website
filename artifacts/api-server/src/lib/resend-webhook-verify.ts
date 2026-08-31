import { createHmac, timingSafeEqual } from "node:crypto";

// Resend signs webhooks using the Svix scheme (https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests):
// the signing secret from the Resend dashboard has a "whsec_" prefix over a
// base64 payload; the signed content is "{svix-id}.{svix-timestamp}.{rawBody}",
// HMAC-SHA256'd with that decoded secret, base64-encoded, compared against one
// of the (space-separated, "v1,"-prefixed) values in the svix-signature header.
// Implemented directly with node:crypto rather than pulling in the svix
// package for one function.
export function verifyResendWebhookSignature(params: {
  rawBody: Buffer;
  svixId: string | undefined;
  svixTimestamp: string | undefined;
  svixSignature: string | undefined;
  secret: string;
}): boolean {
  const { rawBody, svixId, svixTimestamp, svixSignature, secret } = params;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject stale signatures — 5 minute tolerance, same as Svix's own guidance.
  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > 5 * 60) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = Buffer.concat([Buffer.from(`${svixId}.${svixTimestamp}.`), rawBody]);
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  const candidates = svixSignature.split(" ").map(v => v.startsWith("v1,") ? v.slice(3) : v);
  return candidates.some(candidate => {
    try {
      const a = Buffer.from(candidate, "base64");
      const b = Buffer.from(expected, "base64");
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}
