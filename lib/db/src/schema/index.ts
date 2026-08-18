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
  // ── Legacy consent-form confirmation (added 2026-07-30) ──────────
  // Rows created by the bulk "legacy consent form" CSV import (paper forms
  // signed 2025, never captured on the live site) start with both of these
  // NULL. `identityConfirmedAt` is set the moment the resident clicks the
  // one-click confirm link in their email — that's the actual consent event
  // for taking on the payment obligation, distinct from `imported` (which
  // just means "came from a CSV, not the public form"). Organic online
  // signups never touch these columns; they stay NULL forever for those
  // rows and that's fine — the columns only mean something for the
  // legacy-import batch.
  identityConfirmedAt: timestamp("identity_confirmed_at"),
  legacyConfirmEmailSentAt: timestamp("legacy_confirm_email_sent_at"),
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
  email: text("email"),
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
  // How much of this pledge has actually come in, distinct from the
  // pledged `amount` — populated by allocating a real bank transaction to
  // this pledge (see bank-transactions.ts). Added 2026-08-18 so large
  // lump-sum payments that turn out to be pledges (not the monthly R250
  // levy) have somewhere to go besides being force-fit into invoices.
  amountReceived: integer("amount_received").notNull().default(0),
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

// ── Invoicing ──────────────────────────────────────────────────
// Minimal invoicing: one invoice per household, made up of line items.
// Numbering format: KCEA-{year}-{3-digit sequence}, e.g. KCEA-2026-001.
// "createdBy" records which admin login generated the invoice (digital
// sign-off — no physical signature field, per KCEA's own instruction).
export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  commitmentId: integer("commitment_id").references(() => commitmentsTable.id),
  billToName: text("bill_to_name").notNull(),
  billToStreet: text("bill_to_street"),
  billToHouseNumber: text("bill_to_house_number"),
  billToEmail: text("bill_to_email"),
  invoiceDate: timestamp("invoice_date").notNull().defaultNow(),
  dueDate: timestamp("due_date").notNull(),
  status: text("status").notNull().default("unpaid"), // draft | unpaid | partial | paid | overdue | cancelled
  subtotal: integer("subtotal").notNull().default(0),
  total: integer("total").notNull().default(0),
  notes: text("notes"),
  createdBy: text("created_by"),
  emailSentAt: timestamp("email_sent_at"),
  // How many calendar months this invoice covers, starting at invoiceDate's
  // month (added for multi-month invoices, e.g. a resident paying 6 months
  // up front in one invoice). Defaults to 1 for every existing/normal invoice.
  // bulk-generate's "already invoiced this month" check honours this so a
  // multi-month invoice can't be double-billed by the normal monthly run.
  coversMonths: integer("covers_months").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type Invoice = typeof invoicesTable.$inferSelect;

export const invoiceLineItemsTable = pgTable("invoice_line_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoicesTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitAmount: integer("unit_amount").notNull(),
  amount: integer("amount").notNull(),
});
export type InvoiceLineItem = typeof invoiceLineItemsTable.$inferSelect;

// ── Payments ───────────────────────────────────────────────────
// One row per recorded payment against an invoice. An invoice's status is
// derived from the sum of its payments vs its total (see invoices.ts):
// unpaid (0 paid) → partial (0 < paid < total) → paid (paid >= total).
// "source" distinguishes a payment typed in by hand from one created by
// confirming a matched row in a bank-statement CSV import, for audit
// purposes — both write identical rows otherwise.
// invoiceId is nullable: a payment allocated directly to a household (not a
// specific invoice) — "credit" — has invoiceId null and commitmentId set
// instead. Added 2026-08-18 so an admin can allocate a bank transaction to a
// resident when there's no open invoice to attach it to yet, and have it
// auto-apply the next time an invoice is generated for that household (see
// applyAvailableCredit in invoices.ts) instead of sitting unallocated.
export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "cascade" }),
  commitmentId: integer("commitment_id").references(() => commitmentsTable.id),
  amount: integer("amount").notNull(),
  paymentDate: timestamp("payment_date").notNull().defaultNow(),
  method: text("method").notNull().default("EFT"),
  reference: text("reference"),
  notes: text("notes"),
  source: text("source").notNull().default("manual"), // manual | bank_import
  recordedBy: text("recorded_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Payment = typeof paymentsTable.$inferSelect;

// ── Bank Transactions ────────────────────────────────────────────
// A permanent record of every credit line imported from a bank statement
// (CSV), independent of whether it's been matched to a household yet —
// unlike the earlier one-time "preview then confirm" import flow, these
// rows persist so an admin can come back later and allocate anything left
// unmatched. Modelled on Slipstream's swool.io Bank Transactions page.
// "status": unallocated | allocated | ignored.
// "suggestedCommitmentId" is the matcher's best guess (street + house
// number found in the description) — shown to pre-fill the allocate form,
// but never auto-trusted unless there's also an open invoice to attach to
// (see bank-transactions.ts import logic).
export const bankTransactionsTable = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  transactionDate: timestamp("transaction_date").notNull(),
  description: text("description").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("unallocated"),
  suggestedCommitmentId: integer("suggested_commitment_id").references(() => commitmentsTable.id),
  commitmentId: integer("commitment_id").references(() => commitmentsTable.id),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id),
  paymentId: integer("payment_id").references(() => paymentsTable.id),
  // Set instead of invoiceId/paymentId when this transaction turns out to be
  // a pledge contribution rather than a regular household invoice payment.
  pledgeId: integer("pledge_id").references(() => pledgesTable.id),
  source: text("source").notNull().default("csv_import"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type BankTransaction = typeof bankTransactionsTable.$inferSelect;

// ── Communication log ────────────────────────────────────────────
// One row per outbound message actually sent to a resident (invoice email,
// test send, statement email) — added 2026-08-18 so the resident detail
// page can show what's actually gone out, instead of admin having to guess
// whether an invoice was already emailed to someone.
export const communicationLogTable = pgTable("communication_log", {
  id: serial("id").primaryKey(),
  commitmentId: integer("commitment_id")
    .notNull()
    .references(() => commitmentsTable.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("email"), // email | whatsapp
  type: text("type").notNull(), // invoice | invoice_test | statement | legacy_confirm | other
  subject: text("subject").notNull(),
  recipient: text("recipient"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});
export type CommunicationLogEntry = typeof communicationLogTable.$inferSelect;

// ── Expenses ──────────────────────────────────────────────────────
// Lightweight expense tracking — added 2026-08-18. KCEA has real outgoing
// costs (bank fees, the Traffic Impact Study deposit, application/city
// fees, and eventually ongoing security/insurance/maintenance) alongside
// the resident-payment income already tracked. This is NOT double-entry
// bookkeeping (no ledger/journal/trial balance) — just enough to answer
// "what have we spent and on what". Full accounting belongs in real
// accounting software once KCEA reaches steady-state operations.
export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  expenseDate: timestamp("expense_date").notNull().defaultNow(),
  category: text("category").notNull(),
  amount: integer("amount").notNull(),
  description: text("description").notNull(),
  reference: text("reference"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Expense = typeof expensesTable.$inferSelect;

// ── Bank payer references ────────────────────────────────────────
// A learned mapping from a normalized bank-statement description to the
// household an admin manually matched it to. Added 2026-08-18 in response
// to the "155 unallocated" investigation: many unallocated rows have a bank
// description with no parseable street/house (e.g. "CAPITEC D VILJOEN")
// but the same payer's description text repeats verbatim on their next
// EFT/debit order. Once an admin allocates one such transaction by hand
// (see bank-transactions.ts allocate route), the description is
// remembered here so future imports of the same payer auto-allocate
// instead of landing back in the unallocated queue every time.
// "descriptionKey" is the normalized (lowercased, whitespace-collapsed)
// full description text — deliberately exact-match, not fuzzy, so a wrong
// guess can't silently misfile a different household's payment.
export const bankPayerReferencesTable = pgTable("bank_payer_references", {
  id: serial("id").primaryKey(),
  descriptionKey: text("description_key").notNull().unique(),
  commitmentId: integer("commitment_id")
    .notNull()
    .references(() => commitmentsTable.id),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type BankPayerReference = typeof bankPayerReferencesTable.$inferSelect;