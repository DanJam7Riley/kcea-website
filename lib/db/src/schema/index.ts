import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const siteStatsTable = pgTable("site_stats", {
  id: serial("id").primaryKey(),
  committedHouseholds: integer("committed_households").notNull().default(178),
  monthlyContributions: integer("monthly_contributions").notNull().default(44500),
  targetHouseholds: integer("target_households").notNull().default(680),
  fundingPercent: integer("funding_percent").notNull().default(22),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const streetCaptainsTable = pgTable("street_captains", {
  id: serial("id").primaryKey(),
  street: text("street").notNull().unique(),
  captain: text("captain").notNull(),
  forms: integer("forms").notNull().default(0),
  status: text("status").notNull(),
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
