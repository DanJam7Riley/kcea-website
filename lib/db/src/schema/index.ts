import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const siteStatsTable = pgTable("site_stats", {
  id: serial("id").primaryKey(),
  committedHouseholds: integer("committed_households").notNull().default(191),
  monthlyContributions: integer("monthly_contributions").notNull().default(47750),
  targetHouseholds: integer("target_households").notNull().default(680),
  fundingPercent: integer("funding_percent").notNull().default(28),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const streetCaptainsTable = pgTable("street_captains", {
  id: serial("id").primaryKey(),
  street: text("street").notNull(),
  captain: text("captain").notNull(),
  forms: integer("forms").notNull().default(0),
  targetHouseholds: integer("target_households").notNull().default(30),
  status: text("status").notNull(),
  phone: text("phone"),
  email: text("email"),
  motivation: text("motivation"),
  captainStatus: text("captain_status").notNull().default("Active Captain"),
  welcomedAt: timestamp("welcomed_at"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
});

export const commitmentsTable = pgTable("commitments", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  street: text("street").notNull(),
  houseNumber: text("house_number").notNull(),
  commitmentType: text("commitment_type").notNull(),
  notes: text("notes"),
  imported: boolean("imported").notNull().default(false),
  paymentConfirmed: boolean("payment_confirmed").notNull().default(false),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
});

export const insertSiteStatsSchema = createInsertSchema(siteStatsTable).omit({ id: true, updatedAt: true });
export const updateSiteStatsSchema = insertSiteStatsSchema.partial();
export type SiteStats = typeof siteStatsTable.$inferSelect;

export const insertStreetCaptainSchema = createInsertSchema(streetCaptainsTable).omit({ id: true });
export const updateStreetCaptainSchema = insertStreetCaptainSchema.partial();
export type StreetCaptain = typeof streetCaptainsTable.$inferSelect;
export type InsertStreetCaptain = z.infer<typeof insertStreetCaptainSchema>;

export const insertCommitmentSchema = createInsertSchema(commitmentsTable).omit({ id: true, submittedAt: true });
export type Commitment = typeof commitmentsTable.$inferSelect;
export type InsertCommitment = z.infer<typeof insertCommitmentSchema>;

export const volunteersTable = pgTable("volunteers", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  street: text("street").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  motivation: text("motivation"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
});

export const insertVolunteerSchema = createInsertSchema(volunteersTable).omit({ id: true, submittedAt: true });
export type Volunteer = typeof volunteersTable.$inferSelect;
export type InsertVolunteer = z.infer<typeof insertVolunteerSchema>;

// ── Captain Portal ─────────────────────────────────────────────
export const captainProfilesTable = pgTable("captain_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  pin: text("pin"),
  pinHash: text("pin_hash"),
  lastLoginAt: timestamp("last_login_at"),
  previousLoginAt: timestamp("previous_login_at"),
  pinSentAt: timestamp("pin_sent_at"),
});

export const siteSettingsTable = pgTable("site_settings", {
  id: serial("id").primaryKey(),
  notifyWhatsapp: text("notify_whatsapp"),
  adminPassword2: text("admin_password_2"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type SiteSettings = typeof siteSettingsTable.$inferSelect;
export type CaptainProfile = typeof captainProfilesTable.$inferSelect;

export const captainResidentContactsTable = pgTable("captain_resident_contacts", {
  id: serial("id").primaryKey(),
  captainProfileId: integer("captain_profile_id").notNull(),
  commitmentId: integer("commitment_id").notNull(),
  contactedAt: timestamp("contacted_at").notNull().defaultNow(),
});

export const captainTokensTable = pgTable("captain_tokens", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const propertyNotesTable = pgTable("property_notes", {
  id: serial("id").primaryKey(),
  street: text("street").notNull(),
  houseNumber: text("house_number").notNull(),
  profileId: integer("profile_id").notNull(),
  captainName: text("captain_name").notNull(),
  note: text("note").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type PropertyNote = typeof propertyNotesTable.$inferSelect;

export const pledgesTable = pgTable("pledges", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  amount: integer("amount").notNull(),
  isResident: boolean("is_resident").notNull().default(false),
  street: text("street"),
  houseNumber: text("house_number"),
  message: text("message"),
  commitmentId: integer("commitment_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPledgeSchema = createInsertSchema(pledgesTable).omit({ id: true, createdAt: true, commitmentId: true });
export type Pledge = typeof pledgesTable.$inferSelect;
export type InsertPledge = z.infer<typeof insertPledgeSchema>;

// OTP codes for the public "Update My Details" self-service flow.
// One row per requested code; we mark `consumedAt` once it has been
// successfully redeemed and rely on `expiresAt` for the 10-minute window.
export const otpCodesTable = pgTable("otp_codes", {
  id: serial("id").primaryKey(),
  emailKey: text("email_key").notNull(),
  commitmentId: integer("commitment_id").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type OtpCode = typeof otpCodesTable.$inferSelect;

export const streetHousesTable = pgTable("street_houses", {
  id: serial("id").primaryKey(),
  street: text("street").notNull(),
  houseNumber: text("house_number").notNull(),
});
export type StreetHouse = typeof streetHousesTable.$inferSelect;

// Captain → street assignments. One row per street a resident captains, so a
// single resident can have multiple active rows. Soft-deleted via isActive=false
// (we never hard-delete, to keep an audit trail of past assignments).
export const captainAssignmentsTable = pgTable("captain_assignments", {
  id: serial("id").primaryKey(),
  residentId: integer("resident_id")
    .notNull()
    .references(() => commitmentsTable.id, { onDelete: "cascade" }),
  streetName: text("street_name").notNull(),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
});
export type CaptainAssignment = typeof captainAssignmentsTable.$inferSelect;
