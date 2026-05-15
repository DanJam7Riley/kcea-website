import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
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

export const insertSiteStatsSchema = createInsertSchema(siteStatsTable).omit({ id: true, updatedAt: true });
export const updateSiteStatsSchema = insertSiteStatsSchema.partial();
export type SiteStats = typeof siteStatsTable.$inferSelect;

export const insertStreetCaptainSchema = createInsertSchema(streetCaptainsTable).omit({ id: true });
export const updateStreetCaptainSchema = insertStreetCaptainSchema.partial();
export type StreetCaptain = typeof streetCaptainsTable.$inferSelect;
export type InsertStreetCaptain = z.infer<typeof insertStreetCaptainSchema>;
