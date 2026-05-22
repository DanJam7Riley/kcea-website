import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULT_PRIMARY_PASSWORD = "kcea2026";
const DEFAULT_SECONDARY_PASSWORD = "kcea2026b";

export const PRIMARY_USERNAME = process.env.ADMIN_USERNAME ?? "kcea-admin";
export const SECONDARY_USERNAME = process.env.ADMIN_USERNAME_2 ?? "kcea-admin2";

export function getPrimaryPassword(): string {
  return process.env.ADMIN_PASSWORD ?? DEFAULT_PRIMARY_PASSWORD;
}

let cachedSecondary: string | null = null;

function fallbackSecondary(): string {
  return process.env.ADMIN_PASSWORD_2 ?? DEFAULT_SECONDARY_PASSWORD;
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
