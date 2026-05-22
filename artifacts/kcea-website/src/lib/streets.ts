// Canonical KCEA street list + helpers shared by the public commitment form,
// the resident self-service "Update My Details" page, and the admin panel.

export interface StreetOption {
  value: string;
  label: string;
}

export const STREET_OPTIONS: StreetOption[] = [
  { value: "Derby",        label: "Derby" },
  { value: "Earls Court",  label: "Earls Court (complex on Nile St)" },
  { value: "Ernest",       label: "Ernest" },
  { value: "Highlands",    label: "Highlands" },
  { value: "Leicester",    label: "Leicester" },
  { value: "Mildura",      label: "Mildura" },
  { value: "Milner",       label: "Milner" },
  { value: "Nile",         label: "Nile" },
  { value: "Nottingham",   label: "Nottingham" },
  { value: "Nymphe",       label: "Nymphe" },
  { value: "Ocean",        label: "Ocean" },
  { value: "Onyx",         label: "Onyx" },
  { value: "Orion",        label: "Orion" },
  { value: "Orwell",       label: "Orwell" },
  { value: "Osprey",       label: "Osprey" },
  { value: "Panther",      label: "Panther" },
  { value: "Patrol",       label: "Patrol" },
  { value: "Phoenix",      label: "Phoenix" },
  { value: "Protea",       label: "Protea" },
  { value: "Westmoreland", label: "Westmoreland" },
];

export const STREET_VALUES = STREET_OPTIONS.map(o => o.value);

// Common "road-type" suffix words that residents add to a bare street name
// (e.g. "Nile" vs "Nile Street"). Stripping these makes the smart-match
// tolerant to phrasing differences.
const SUFFIX_WORDS = new Set([
  "street", "st",
  "road", "rd",
  "avenue", "ave", "av",
  "drive", "dr",
  "crescent", "cres",
  "way",
  "close", "cl",
  "lane", "ln",
  "place", "pl",
  "boulevard", "blvd",
  "court", "ct",
]);

function stripRoadSuffix(s: string): string {
  const cleaned = (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!cleaned) return "";
  const parts = cleaned.split(" ");
  // Don't strip if the *whole* canonical name is e.g. "Earls Court" — we only
  // strip when there's more than one token AND the last token is a suffix.
  if (parts.length > 1 && SUFFIX_WORDS.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(" ");
}

// Normalise a street name for storage: trim, collapse whitespace, title-case.
//   "MILDURA"      -> "Mildura"
//   "  nile  st"   -> "Nile St"
//   "earls court"  -> "Earls Court"
export function normaliseStreet(raw: string): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Smart match: given a user-typed street name and the canonical list, return
// the canonical option if the input clearly refers to it (case-insensitive,
// tolerant of road-type suffixes). Returns null when the input already
// matches the canonical form exactly, or when no close match exists.
export function suggestStreet(input: string, options: string[] = STREET_VALUES): string | null {
  const cleanedInput = (input ?? "").trim();
  if (!cleanedInput) return null;
  const stripped = stripRoadSuffix(cleanedInput);
  if (!stripped) return null;

  for (const opt of options) {
    if (opt.toLowerCase() === cleanedInput.toLowerCase()) return null; // already canonical
    const optStripped = stripRoadSuffix(opt);
    if (optStripped && optStripped === stripped) return opt;
  }
  return null;
}

// A record needs a follow-up about its street when the field is blank or
// still holds the legacy "Other" placeholder.
export function needsStreetInfo(street: string | null | undefined): boolean {
  const s = (street ?? "").trim().toLowerCase();
  return s === "" || s === "other";
}

// Street commitment status is purely derived from % of target households
// committed — admins can no longer set this manually, so the label always
// reflects real progress.
//   0–25% → Critical
//   26–50% → In Progress
//   51–75% → Good
//   76–90% → Strong
//   91–100% → Excellent
export type StreetStatus = "Critical" | "In Progress" | "Good" | "Strong" | "Excellent";

export function computeStreetStatus(committed: number, target: number): StreetStatus {
  if (!target || target <= 0) return "Critical";
  const pct = Math.min(100, Math.max(0, (committed / target) * 100));
  if (pct <= 25) return "Critical";
  if (pct <= 50) return "In Progress";
  if (pct <= 75) return "Good";
  if (pct <= 90) return "Strong";
  return "Excellent";
}

export function getStreetStatusClass(status: StreetStatus): string {
  switch (status) {
    case "Excellent": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "Strong":    return "bg-green-500/20 text-green-400 border-green-500/30";
    case "Good":      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "In Progress": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "Critical":  return "bg-red-500/20 text-red-400 border-red-500/30";
  }
}
