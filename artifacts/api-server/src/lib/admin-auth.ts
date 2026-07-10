import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// No hardcoded admin credentials. Every value below must come from the
// environment — if any are missing, the server fails to start rather than
// silently falling back to a default that could be guessed.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it before starting ` +
        "the server — there is no default admin credential.",
    );
  }
  return value;
}

export const PRIMARY_USERNAME = requireEnv("ADMIN_USERNAME");
export const SECONDARY_USERNAME = requireEnv("ADMIN_USERNAME_2");

const primaryPassword = requireEnv("ADMIN_PASSWORD");
const envSecondaryPassword = requireEnv("ADMIN_PASSWORD_2");

export function getPrimaryPassword(): string {
  return primaryPassword;
}

let cachedSecondary: string | null = null;

function fallbackSecondary(): string {
  return envSecondaryPassword;
}

export function getSecondaryPasswordSync(): string {
  return cachedSecondary ?? fallbackSecondary();
}

export function setSecondaryPasswordCache(pw: string): void {
  cachedSecondary = pw;
}

export async function loadSecondaryPassword(): Promise<string> {
  try {
    const rows = await db
      .select({ adminPassword2: siteSettingsTable.adminPassword2 })
      .from(siteSettingsTable)
      .limit(1);
    const dbVal = rows[0]?.adminPassword2;
    cachedSecondary = dbVal && dbVal.trim() ? dbVal : fallbackSecondary();
  } catch {
    cachedSecondary = fallbackSecondary();
  }
  return cachedSecondary;
}

export async function persistSecondaryPassword(newPw: string): Promise<void> {
  const trimmed = newPw.trim();
  if (!trimmed) throw new Error("Secondary admin password cannot be empty.");
  const rows = await db.select({ id: siteSettingsTable.id }).from(siteSettingsTable).limit(1);
  if (rows.length === 0) {
    await db.insert(siteSettingsTable).values({ adminPassword2: trimmed });
  } else {
    await db
      .update(siteSettingsTable)
      .set({ adminPassword2: trimmed, updatedAt: new Date() })
      .where(eq(siteSettingsTable.id, rows[0]!.id));
  }
  setSecondaryPasswordCache(trimmed);
}

export type AdminRole = "primary" | "secondary";

type HeaderBag = Record<string, string | string[] | undefined> | Record<string, unknown>;

function headerStr(headers: HeaderBag, key: string): string {
  const v = (headers as Record<string, unknown>)[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

/**
 * Resolve the admin role from request headers. Validates the username/password
 * pair: a primary username paired with the secondary password (or vice versa)
 * is rejected. Username header is optional — if absent, the password is matched
 * against either credential set so existing tooling (curl scripts, internal
 * jobs) keeps working until they're updated to send `x-admin-username`.
 */
export function adminRoleFromHeaders(headers: HeaderBag): AdminRole | null {
  const u = headerStr(headers, "x-admin-username").trim();
  const p = headerStr(headers, "x-admin-password");
  if (!p) return null;
  const primaryPw = getPrimaryPassword();
  const secondaryPw = getSecondaryPasswordSync();
  if (u === "") {
    if (p === primaryPw) return "primary";
    if (p === secondaryPw) return "secondary";
    return null;
  }
  if (u === PRIMARY_USERNAME && p === primaryPw) return "primary";
  if (u === SECONDARY_USERNAME && p === secondaryPw) return "secondary";
  return null;
}

export function isAdminReq(headers: HeaderBag): boolean {
  return adminRoleFromHeaders(headers) !== null;
}

export function isPrimaryReq(headers: HeaderBag): boolean {
  return adminRoleFromHeaders(headers) === "primary";
}
