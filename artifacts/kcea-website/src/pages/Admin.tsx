import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Save, LogIn, AlertTriangle, CheckCircle, Check, Key, Pencil,
  Trash2, Download, Upload, Users, UserPlus, ClipboardList, BarChart3, Search, MessageSquare, RefreshCw, Phone, ExternalLink, Settings as SettingsIcon, Heart, Mail, X, FileText, Plus, Printer, Landmark, EyeOff, Eye, Receipt
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { computeStreetStatus, getStreetStatusClass, STREET_OPTIONS } from "@/lib/streets";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const TABS = ["submissions", "stats", "captains", "manage-captains", "incomplete", "captain-mgmt", "pledges", "invoices", "bank-transactions", "expenses", "settings"] as const;
type Tab = typeof TABS[number];

interface PledgeRow {
  id: number;
  fullName: string;
  phone: string;
  email: string;
  amount: number;
  isResident: boolean;
  street: string | null;
  houseNumber: string | null;
  message: string | null;
  commitmentId: number | null;
  amountReceived: number;
  createdAt: string;
}

interface InvoiceLineItem {
  id: number;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  commitmentId: number | null;
  billToName: string;
  billToStreet: string | null;
  billToHouseNumber: string | null;
  billToEmail: string | null;
  invoiceDate: string;
  dueDate: string;
  status: string;
  subtotal: number;
  total: number;
  notes: string | null;
  createdBy: string | null;
  emailSentAt: string | null;
  createdAt: string;
  lineItems?: InvoiceLineItem[];
  amountPaid?: number;
  payments?: PaymentRow[];
}

interface PaymentRow {
  id: number;
  invoiceId: number;
  amount: number;
  paymentDate: string;
  method: string;
  reference: string | null;
  notes: string | null;
  source: string;
  recordedBy: string | null;
}

interface IncompleteCommitment {
  id: number;
  kind?: "commitment" | "profile" | "no-captain";
  fullName: string;
  email: string | null;
  phone: string;
  street: string;
  houseNumber: string;
  commitmentType: string;
  submittedAt: string;
  missingFields: string[];
  updateToken?: string;
}

const UPDATE_BASE_URL = "https://attached-assets-janineriley.replit.app";
const CAPTAIN_PORTAL_URL = "https://kcea.co.za/captain-login";

function buildCaptainWelcomeMsg(
  name: string,
  street: string,
  phone: string,
  pin: string | null | undefined,
  adminWhatsapp: string,
): string {
  const pinPart = pin ? `PIN: ${pin}` : "PIN: Your PIN will be sent shortly";
  return `Hi ${name}, your KCEA Captain Portal login details for ${street}: ${CAPTAIN_PORTAL_URL} | Phone: ${phone} | ${pinPart}. Keep your PIN private. Questions? WhatsApp ${adminWhatsapp}.`;
}

function makeUpdateLink(id: number, token: string): string {
  return `${UPDATE_BASE_URL}/update?id=${id}&t=${token}`;
}

function makeIncompleteWaUrl(phone: string, name: string, street: string, id: number, token: string): string | null {
  const digits = phone.replace(/[\s()\-+]/g, "");
  if (!digits || digits.length < 7) return null;
  const normalized = digits.startsWith("0") ? "27" + digits.slice(1) : digits;
  if (!/^\d{10,15}$/.test(normalized)) return null;
  const firstName = (name || "there").split(/\s+/)[0] || "there";
  const streetLabel = street ? ` for ${street}` : "";
  const msg = `Hi ${firstName}, we have your commitment on record${streetLabel} but are missing some details. Please update your info here: ${makeUpdateLink(id, token)}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`;
}

function makeResidentWaUrl(phone: string, message: string): string | null {
  const digits = phone.replace(/[\s()\-+]/g, "");
  if (!digits || digits.length < 7) return null;
  const normalized = digits.startsWith("0") ? "27" + digits.slice(1) : digits;
  if (!/^\d{10,15}$/.test(normalized)) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

interface SiteStats {
  committedHouseholds: number;
  monthlyContributions: number;
  targetHouseholds: number;
  fundingPercent: number;
}

interface StreetCaptain {
  id: number;
  street: string;
  captain: string;
  forms: number;
  targetHouseholds?: number;
  status: string;
  phone: string | null;
  email: string | null;
  motivation: string | null;
  captainStatus: string;
  welcomedAt: string | null;
  submittedAt: string;
  pin: string | null;
}

interface Commitment {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  street: string;
  houseNumber: string;
  commitmentType: string;
  imported: boolean;
  paymentConfirmed: boolean;
  submittedAt: string;
  notes?: string | null;
}

interface ImportResult {
  added: number;
  skipped: number;
  duplicates?: number;
}

interface CaptainProfile {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  pin: string | null;
  pinHash: string | null;
  lastLoginAt: string | null;
  pinSentAt: string | null;
}


interface CaptainNote {
  id: number;
  street: string;
  houseNumber: string;
  captainName: string;
  note: string;
  updatedAt: string;
}

interface CaptainAssignmentRow {
  residentId: number;
  fullName: string;
  phone: string;
  email: string;
  streets: string[];
  assignmentIds: number[];
  pinSet: boolean;
}


function TypeBadge({ type }: { type: string }) {
  return type === "onceoff"
    ? <Badge className="bg-primary/20 text-primary border-primary/20 text-xs" variant="outline">Once-off</Badge>
    : <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/20 text-xs" variant="outline">Monthly</Badge>;
}

// ── Resident detail page ─────────────────────────────────────────────
// Full-width view (not a cramped popup) with four tabs, modelled on
// Slipstream's swool.io tabbed customer page — Profile / Account /
// Communications / Notes. Reuses the existing resident statement endpoint
// (admin auth bypasses its public token check) rather than a new one.
interface ResidentStatementLineItem { description: string; quantity: number; unitAmount: number; amount: number }
interface ResidentStatementPayment { amount: number; paymentDate: string; method: string; reference: string | null }
interface ResidentStatementInvoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  total: number;
  amountPaid: number;
  balance: number;
  lineItems: ResidentStatementLineItem[];
  payments: ResidentStatementPayment[];
}
interface ResidentStatement {
  commitment: { id: number; fullName: string; street: string; houseNumber: string; commitmentType: string };
  invoices: ResidentStatementInvoice[];
  totalOutstanding: number;
  invoiceCount: number;
}
interface CommunicationLogRow {
  id: number;
  channel: string;
  type: string;
  subject: string;
  recipient: string | null;
  sentAt: string;
}

function ResidentDetailPanel({
  residentId,
  contact,
  statement,
  statementLoading,
  authHeaders,
  onBack,
  onEdit,
  onOpenMultiMonth,
  onSaveNotes,
  savingNotes,
  invoiceStatusBadgeClass,
}: {
  residentId: number;
  contact: Commitment | null;
  statement: ResidentStatement | undefined;
  statementLoading: boolean;
  authHeaders: Record<string, string>;
  onBack: () => void;
  onEdit: () => void;
  onOpenMultiMonth: () => void;
  onSaveNotes: (id: number, notes: string) => void;
  savingNotes: boolean;
  invoiceStatusBadgeClass: (status: string) => string;
}) {
  const [detailTab, setDetailTab] = useState<"profile" | "account" | "communications" | "notes">("profile");
  const [notesDraft, setNotesDraft] = useState(contact?.notes ?? "");

  // ── Single invoice, generated straight from this profile ─────────────
  // Reuses the same bulk-generate / onceoff-generate endpoints the bulk
  // dialogs use, just scoped to this one commitmentId — no need for a
  // dedicated single-invoice route.
  const qc = useQueryClient();
  const [invoiceMonth, setInvoiceMonth] = useState<"current" | "last">("current");
  const [invoiceFeedback, setInvoiceFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const generateSingleInvoice = useMutation({
    mutationFn: async () => {
      const isOnceoff = contact?.commitmentType === "onceoff";
      const body: Record<string, unknown> = { commitmentIds: [residentId] };
      if (!isOnceoff && invoiceMonth === "last") {
        const now = new Date();
        const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        body.month = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}`;
      }
      const r = await fetch(`${BASE}/api/invoices/${isOnceoff ? "onceoff-generate" : "bulk-generate"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to generate invoice");
      return r.json() as Promise<{ created: string[]; skipped: { commitmentId: number; reason: string }[]; createdCount: number; skippedCount: number }>;
    },
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: ["resident-statement", residentId] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoices-bulk-preview"] });
      qc.invalidateQueries({ queryKey: ["invoices-onceoff-preview"] });
      if (data.createdCount === 0) {
        setInvoiceFeedback({ kind: "error", text: data.skipped[0]?.reason ?? "Skipped — nothing to invoice." });
      } else {
        setInvoiceFeedback({ kind: "success", text: `Invoice ${data.created[0]} created.` });
      }
    },
    onError: (err: unknown) => setInvoiceFeedback({ kind: "error", text: err instanceof Error ? err.message : "Failed to generate invoice" }),
  });

  useEffect(() => {
    setNotesDraft(contact?.notes ?? "");
  }, [contact?.id, contact?.notes]);

  const { data: communications = [], isLoading: commsLoading } = useQuery<CommunicationLogRow[]>({
    queryKey: ["resident-communications", residentId],
    queryFn: () => fetch(`${BASE}/api/commitments/${residentId}/communications`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    }),
    enabled: detailTab === "communications",
  });

  const tabs: { key: typeof detailTab; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "account", label: "Account" },
    { key: "communications", label: "Communications" },
    { key: "notes", label: "Notes" },
  ];

  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4 flex-wrap">
        <div>
          <button type="button" onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-1">
            ← Back to Residents
          </button>
          <CardTitle className="text-xl">{contact?.fullName ?? statement?.commitment.fullName ?? "Resident"}</CardTitle>
        </div>
        <div className="flex items-center gap-3">
          {statement && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{statement.totalOutstanding < 0 ? "Credit balance" : "Balance"}</p>
              <p className={`text-lg font-bold ${statement.totalOutstanding > 0 ? "text-red-400" : "text-green-400"}`}>
                {statement.totalOutstanding < 0
                  ? `R${Math.abs(statement.totalOutstanding).toLocaleString("en-ZA")} in credit`
                  : `R${statement.totalOutstanding.toLocaleString("en-ZA")}`}
              </p>
            </div>
          )}
          {contact?.commitmentType === "monthly" && (
            <>
              <select
                className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                value={invoiceMonth}
                onChange={e => setInvoiceMonth(e.target.value as "current" | "last")}
                data-testid="resident-invoice-month"
              >
                <option value="current">This month</option>
                <option value="last">Last month</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={generateSingleInvoice.isPending}
                onClick={() => { setInvoiceFeedback(null); generateSingleInvoice.mutate(); }}
                data-testid="resident-generate-invoice"
              >
                <FileText className="h-3.5 w-3.5" /> {generateSingleInvoice.isPending ? "Generating…" : "Generate invoice"}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onOpenMultiMonth} data-testid="resident-multi-month-invoice">
                <FileText className="h-3.5 w-3.5" /> Multi-month invoice
              </Button>
            </>
          )}
          {contact?.commitmentType === "onceoff" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={generateSingleInvoice.isPending}
              onClick={() => { setInvoiceFeedback(null); generateSingleInvoice.mutate(); }}
              data-testid="resident-generate-invoice"
            >
              <FileText className="h-3.5 w-3.5" /> {generateSingleInvoice.isPending ? "Generating…" : "Generate invoice"}
            </Button>
          )}
          <Button size="sm" onClick={onEdit} className="gap-1.5"><Pencil className="h-3.5 w-3.5" /> Edit</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {invoiceFeedback && (
          <p className={`text-sm ${invoiceFeedback.kind === "success" ? "text-green-400" : "text-red-400"}`} data-testid="resident-invoice-feedback">
            {invoiceFeedback.text}
          </p>
        )}
        <div className="flex gap-1 border-b border-border">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setDetailTab(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                detailTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`resident-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {detailTab === "profile" && (
          <div className="rounded-lg border border-border bg-background/50 p-4 space-y-2 text-sm max-w-md">
            {contact?.phone && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {contact.phone}</p>}
            {contact?.email && <p className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {contact.email}</p>}
            {statement && (
              <p className="text-muted-foreground">
                {statement.commitment.street} No. {statement.commitment.houseNumber}
                {" · "}{statement.commitment.commitmentType === "onceoff" ? "Once-off R3,000" : "Monthly R250"}
              </p>
            )}
            {contact?.submittedAt && (
              <p className="text-xs text-muted-foreground">
                Registered {new Date(contact.submittedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            )}
            <p className="text-xs text-muted-foreground pt-1">Click "Edit" above to change contact details.</p>
          </div>
        )}

        {detailTab === "account" && (
          statementLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : !statement || statement.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No invoices on file yet.</p>
          ) : (
            <div className="space-y-2">
              {[...statement.invoices].reverse().map(inv => (
                <div key={inv.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold">{inv.invoiceNumber}</span>
                    <Badge className={`${invoiceStatusBadgeClass(inv.status)} text-xs`} variant="outline">{inv.status}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-1 flex-wrap gap-1">
                    <span>Invoiced {new Date(inv.invoiceDate).toLocaleDateString("en-ZA")} · Due {new Date(inv.dueDate).toLocaleDateString("en-ZA")}</span>
                    <span>R{inv.total.toLocaleString("en-ZA")}{inv.amountPaid > 0 ? ` (R${inv.amountPaid.toLocaleString("en-ZA")} paid)` : ""}</span>
                  </div>
                  {inv.payments.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {inv.payments.map((p, i) => (
                        <p key={i} className="text-xs text-green-400">
                          R{p.amount.toLocaleString("en-ZA")} · {p.method} · {new Date(p.paymentDate).toLocaleDateString("en-ZA")}
                          {p.reference ? ` · ${p.reference}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {detailTab === "communications" && (
          commsLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : communications.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nothing sent to this resident yet.</p>
          ) : (
            <div className="space-y-2">
              {communications.map(c => (
                <div key={c.id} className="rounded-lg border border-border p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-medium">{c.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.channel} · {c.type}{c.recipient ? ` · ${c.recipient}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(c.sentAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          )
        )}

        {detailTab === "notes" && (
          <div className="space-y-2 max-w-lg">
            <Textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder="Admin notes about this resident — not visible to the resident."
              className="min-h-32"
              data-testid="resident-notes-textarea"
            />
            <Button
              size="sm"
              disabled={savingNotes || notesDraft === (contact?.notes ?? "")}
              onClick={() => onSaveNotes(residentId, notesDraft)}
              data-testid="save-resident-notes"
            >
              {savingNotes ? "Saving…" : "Save note"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authRole, setAuthRole] = useState<"primary" | "secondary" | null>(null);
  const [authError, setAuthError] = useState("");
  const [secondaryPwView, setSecondaryPwView] = useState<{ username: string; password: string } | null>(null);
  const [secondaryPwEdit, setSecondaryPwEdit] = useState("");
  const [secondaryPwSaved, setSecondaryPwSaved] = useState(false);
  const [secondaryPwError, setSecondaryPwError] = useState("");
  const [showSecondaryPw, setShowSecondaryPw] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("submissions");

  // ── Resident detail popup ─────────────────────────────────────────
  // Click-through from the Residents list — same pattern as Slipstream's
  // "Account Holder" popup: contact info, balance, and transaction history
  // in one place. Reuses the existing resident statement endpoint (admin
  // auth bypasses the token check there).
  const [viewingResidentId, setViewingResidentId] = useState<number | null>(null);
  const { data: residentStatement, isLoading: residentStatementLoading } = useQuery<ResidentStatement>({
    queryKey: ["resident-statement", viewingResidentId],
    queryFn: () => fetch(`${BASE}/api/commitments/${viewingResidentId}/statement`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to load");
      return r.json();
    }),
    enabled: authed && viewingResidentId !== null,
  });
  const [search, setSearch] = useState("");

  const [statsSaved, setStatsSaved] = useState(false);
  const [statsForm, setStatsForm] = useState<Partial<SiteStats>>({});
  const [captainEdits, setCaptainEdits] = useState<Record<number, Partial<StreetCaptain>>>({});
  const [savedCaptains, setSavedCaptains] = useState<Set<number>>(new Set());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [pinEdits, setPinEdits] = useState<Record<number, string>>({});
  const [phoneEdits, setPhoneEdits] = useState<Record<number, string>>({});
  const [emailEdits, setEmailEdits] = useState<Record<number, string>>({});
  const [savedProfiles, setSavedProfiles] = useState<Set<number>>(new Set());
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfilePhone, setNewProfilePhone] = useState("");
  const [newProfileEmail, setNewProfileEmail] = useState("");
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [setPinLoading, setSetPinLoading] = useState<Set<number>>(new Set());
  const [setPinResult, setSetPinResult] = useState<Record<number, { pin: string; sent: boolean }>>({});
  const [editingCommitment, setEditingCommitment] = useState<Commitment | null>(null);
  const [editForm, setEditForm] = useState<Partial<Commitment>>({});
  const [editError, setEditError] = useState("");
  const [editSavedId, setEditSavedId] = useState<number | null>(null);

  function openEditCommitment(c: Commitment) {
    setEditingCommitment(c);
    setEditForm({
      fullName: c.fullName,
      street: c.street,
      houseNumber: c.houseNumber,
      email: c.email,
      phone: c.phone,
      commitmentType: c.commitmentType,
      submittedAt: c.submittedAt,
      imported: c.imported,
      paymentConfirmed: c.paymentConfirmed,
    });
    setEditError("");
  }

  function saveEditCommitment() {
    if (!editingCommitment) return;
    const name = (editForm.fullName ?? "").trim();
    const street = (editForm.street ?? "").trim();
    if (!name) { setEditError("Name is required."); return; }
    if (!street) { setEditError("Street is required."); return; }
    const id = editingCommitment.id;
    // Convert the datetime-local string back to an ISO timestamp the server can parse.
    const submitted = editForm.submittedAt ? new Date(editForm.submittedAt).toISOString() : undefined;
    updateCommitment.mutate(
      { id, patch: { ...editForm, fullName: name, street, ...(submitted ? { submittedAt: submitted } : {}) } },
      {
        onSuccess: () => {
          setEditingCommitment(null);
          setEditSavedId(id);
          setTimeout(() => setEditSavedId(prev => (prev === id ? null : prev)), 3000);
        },
        onError: (err: unknown) => setEditError(err instanceof Error ? err.message : "Update failed"),
      },
    );
  }
  const fileInputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();

  const authHeaders = { "x-admin-username": username.trim(), "x-admin-password": password };

  useEffect(() => {
    if (!authed || authRole !== "primary") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/admin/secondary`, { headers: authHeaders });
        if (!res.ok) return;
        const data = await res.json() as { username: string; password: string };
        if (!cancelled) setSecondaryPwView({ username: data.username, password: data.password });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, authRole]);

  const { data: stats, isLoading: statsLoading } = useQuery<SiteStats>({
    queryKey: ["stats"],
    queryFn: () => fetch(`${BASE}/api/stats`).then(r => r.json()),
    enabled: authed,
  });

  const { data: captains = [], isLoading: captainsLoading } = useQuery<StreetCaptain[]>({
    queryKey: ["captains"],
    queryFn: () => fetch(`${BASE}/api/captains`, { headers: authHeaders }).then(r => r.json()),
    enabled: authed,
  });

  // Duplicate detection — flag any captain row whose name or street appears more than once.
  // Streets with co-captains will legitimately show up here; the banner explains why so admins
  // can decide whether to merge/delete.
  const { dupCaptainIds, dupCount } = useMemo(() => {
    const nameCounts = new Map<string, number>();
    const streetCounts = new Map<string, number>();
    for (const c of captains) {
      const n = (c.captain || "").trim().toLowerCase();
      const s = (c.street || "").trim().toLowerCase();
      if (n && n !== "unassigned") nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
      if (s) streetCounts.set(s, (streetCounts.get(s) ?? 0) + 1);
    }
    const ids = new Set<number>();
    for (const c of captains) {
      const n = (c.captain || "").trim().toLowerCase();
      const s = (c.street || "").trim().toLowerCase();
      const nameDup = n && n !== "unassigned" && (nameCounts.get(n) ?? 0) > 1;
      const streetDup = s && (streetCounts.get(s) ?? 0) > 1;
      if (nameDup || streetDup) ids.add(c.id);
    }
    return { dupCaptainIds: ids, dupCount: ids.size };
  }, [captains]);

  const [captainSearch, setCaptainSearch] = useState("");
  const [captainStatusFilter, setCaptainStatusFilter] = useState<"all" | "Active Captain" | "Pending / New Volunteer" | "Unassigned">("all");
  const filteredCaptains = useMemo(() => {
    const q = captainSearch.trim().toLowerCase();
    return captains
      .filter(c => {
        if (captainStatusFilter !== "all") {
          if (captainStatusFilter === "Unassigned") {
            const isUnassigned = !c.captain || c.captain.trim().toLowerCase() === "unassigned";
            if (!isUnassigned) return false;
          } else if (c.captainStatus !== captainStatusFilter) {
            return false;
          }
        }
        if (!q) return true;
        const hay = [c.captain, c.street, c.phone, c.email].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      // Permanent A→Z sort by street so the list always reads in alphabetical
      // order, including any newly added streets. Falls back to captain name
      // for two rows on the same street.
      .slice()
      .sort((a, b) => {
        const s = (a.street ?? "").localeCompare(b.street ?? "", undefined, { sensitivity: "base" });
        if (s !== 0) return s;
        return (a.captain ?? "").localeCompare(b.captain ?? "", undefined, { sensitivity: "base" });
      });
  }, [captains, captainSearch, captainStatusFilter]);
  const filtersActive = captainSearch.trim() !== "" || captainStatusFilter !== "all";

  const knownStreets = useMemo(() => {
    const set = new Set<string>();
    for (const c of captains) set.add(c.street.trim().toLowerCase());
    return set;
  }, [captains]);
  // Admin-side dismissed "new street" flags, persisted in localStorage so
  // an admin doesn't have to re-dismiss the same typo on every page load.
  // Stored as lowercased trimmed street names.
  const DISMISSED_KEY = "kcea_admin_dismissed_new_streets";
  const [dismissedNewStreets, setDismissedNewStreets] = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(DISMISSED_KEY) : null;
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.map((s: unknown) => String(s).trim().toLowerCase()) : []);
    } catch {
      return new Set();
    }
  });
  const persistDismissed = (next: Set<string>) => {
    setDismissedNewStreets(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // ignore quota / private-mode failures
    }
  };
  const isNewStreet = (street: string) => {
    const s = (street ?? "").trim().toLowerCase();
    return s.length > 0 && !knownStreets.has(s) && !dismissedNewStreets.has(s);
  };
  const streetsForCaptainName = (name: string): string[] => {
    const n = (name ?? "").trim().toLowerCase();
    if (!n) return [];
    return captains
      .filter(c => (c.captain ?? "").trim().toLowerCase() === n)
      .map(c => c.street);
  };

  const { data: commitments = [], isLoading: commitmentsLoading } = useQuery<Commitment[]>({
    queryKey: ["commitments"],
    queryFn: () =>
      fetch(`${BASE}/api/commitments`, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      }),
    enabled: authed,
  });
  const viewingResidentContact = commitments.find(c => c.id === viewingResidentId) ?? null;

  const { data: pledges = [], isLoading: pledgesLoading } = useQuery<PledgeRow[]>({
    queryKey: ["pledges"],
    queryFn: () =>
      fetch(`${BASE}/api/pledges`, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      }),
    enabled: authed && activeTab === "pledges",
  });

  const deletePledge = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/pledges/${id}`, { method: "DELETE", headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pledges"] });
      qc.invalidateQueries({ queryKey: ["pledge-total"] });
    },
  });

  // ── Expenses ───────────────────────────────────────────────────────
  // Lightweight tracking (not double-entry bookkeeping) — see expenses.ts.
  interface ExpenseRow { id: number; expenseDate: string; category: string; amount: number; description: string; reference: string | null; createdBy: string | null }
  const { data: expensesData, isLoading: expensesLoading } = useQuery<{ expenses: ExpenseRow[]; total: number }>({
    queryKey: ["expenses"],
    queryFn: () => fetch(`${BASE}/api/expenses`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error("Unauthorized");
      return r.json();
    }),
    enabled: authed && activeTab === "expenses",
  });
  const expenses = expensesData?.expenses ?? [];

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expenseCategory, setExpenseCategory] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseReference, setExpenseReference] = useState("");

  const createExpense = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/expenses`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          expenseDate: new Date(expenseDate).toISOString(),
          category: expenseCategory,
          amount: Number(expenseAmount),
          description: expenseDescription,
          reference: expenseReference || undefined,
        }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to record expense");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setShowAddExpense(false);
      setExpenseCategory("");
      setExpenseAmount("");
      setExpenseDescription("");
      setExpenseReference("");
    },
  });

  const deleteExpense = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/expenses/${id}`, { method: "DELETE", headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Failed to delete expense");
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expenses"] }),
  });

  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>("");
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [newInvoiceBillToName, setNewInvoiceBillToName] = useState("");
  const [newInvoiceStreet, setNewInvoiceStreet] = useState("");
  const [newInvoiceHouseNumber, setNewInvoiceHouseNumber] = useState("");
  const [newInvoiceEmail, setNewInvoiceEmail] = useState("");
  const [newInvoiceDueInDays, setNewInvoiceDueInDays] = useState(15);
  const [newInvoiceLineItems, setNewInvoiceLineItems] = useState<{ description: string; quantity: number; unitAmount: number }[]>([
    { description: "Monthly household contribution", quantity: 1, unitAmount: 250 },
  ]);

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<InvoiceRow[]>({
    queryKey: ["invoices", invoiceSearch, invoiceStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (invoiceSearch) params.set("q", invoiceSearch);
      if (invoiceStatusFilter) params.set("status", invoiceStatusFilter);
      return fetch(`${BASE}/api/invoices?${params.toString()}`, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      });
    },
    enabled: authed && activeTab === "invoices",
  });

  const createInvoice = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/invoices`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          billToName: newInvoiceBillToName,
          billToStreet: newInvoiceStreet || undefined,
          billToHouseNumber: newInvoiceHouseNumber || undefined,
          billToEmail: newInvoiceEmail || undefined,
          dueInDays: newInvoiceDueInDays,
          lineItems: newInvoiceLineItems,
        }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to create invoice");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setShowCreateInvoice(false);
      setNewInvoiceBillToName("");
      setNewInvoiceStreet("");
      setNewInvoiceHouseNumber("");
      setNewInvoiceEmail("");
      setNewInvoiceDueInDays(15);
      setNewInvoiceLineItems([{ description: "Monthly household contribution", quantity: 1, unitAmount: 250 }]);
    },
  });

  const updateInvoiceStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      fetch(`${BASE}/api/invoices/${id}/status`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });

  const deleteInvoice = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/invoices/${id}`, { method: "DELETE", headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to delete invoice");
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });

  // ── Record a payment ─────────────────────────────────────────────
  // "paid"/"partial" are never set by hand — they're derived from recorded
  // payments (see recomputeInvoiceStatus in invoices.ts). This dialog is the
  // only way an invoice moves to paid/partial.
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [recordPaymentInvoice, setRecordPaymentInvoice] = useState<InvoiceRow | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("EFT");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  function openRecordPayment(inv: InvoiceRow) {
    setRecordPaymentInvoice(inv);
    const balance = inv.total - (inv.amountPaid ?? 0);
    setPaymentAmount(balance > 0 ? String(balance) : "");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentMethod("EFT");
    setPaymentReference([inv.billToHouseNumber, inv.billToStreet].filter(Boolean).join(" "));
    setPaymentNotes("");
    setShowRecordPayment(true);
  }

  const recordPayment = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/payments`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: recordPaymentInvoice!.id,
          amount: Math.round(Number(paymentAmount)),
          paymentDate: new Date(paymentDate).toISOString(),
          method: paymentMethod,
          reference: paymentReference || undefined,
          notes: paymentNotes || undefined,
        }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to record payment");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setShowRecordPayment(false);
      setRecordPaymentInvoice(null);
    },
  });

  // Undo a recorded payment — e.g. a mistaken test entry, or a genuine
  // correction. Server recomputes the invoice's status automatically
  // (paid/partial reverts back towards unpaid as appropriate).
  const deletePayment = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/payments/${id}`, { method: "DELETE", headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to undo payment");
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });

  // Reassign a payment to a different invoice for the same household — for
  // correcting a real payment that landed on the wrong invoice (found
  // 2026-08-18: batch imports before the invoice-rollover fix could stack
  // two real payments on one invoice, or a lump-sum prepayment could
  // overpay a single small invoice). Keeps the payment's amount/date/audit
  // trail — only moves which invoice it counts against.
  const [reassigningPayment, setReassigningPayment] = useState<{ id: number; amount: number; currentInvoiceId: number; commitmentId: number | null } | null>(null);
  const [reassignTargetInvoiceId, setReassignTargetInvoiceId] = useState<number | null>(null);
  const reassignCandidates = reassigningPayment
    ? invoices.filter(i => i.commitmentId === reassigningPayment.commitmentId && i.id !== reassigningPayment.currentInvoiceId)
    : [];
  const reassignPayment = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/payments/${reassigningPayment!.id}/reassign`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: reassignTargetInvoiceId }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to reassign payment");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setReassigningPayment(null);
      setReassignTargetInvoiceId(null);
    },
  });

  // ── Multi-month invoice ──────────────────────────────────────────
  // For a household paying several months up front in one invoice (e.g. a
  // resident asking for a 6-month invoice) instead of the normal monthly cycle.
  const [showMultiMonth, setShowMultiMonth] = useState(false);
  const [multiMonthCommitmentId, setMultiMonthCommitmentId] = useState("");
  const [multiMonthCount, setMultiMonthCount] = useState(6);

  const multiMonthGenerate = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/invoices/multi-month`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ commitmentId: Number(multiMonthCommitmentId), months: multiMonthCount }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to generate multi-month invoice");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setShowMultiMonth(false);
      setMultiMonthCommitmentId("");
      setMultiMonthCount(6);
    },
  });

  // ── Bank Transactions ledger ──────────────────────────────────────
  // Persistent version of the import above: every credit row imported ever
  // lives here (status unallocated/allocated/ignored), so nothing is lost
  // once a dialog closes — an admin can come back any time and allocate
  // what's left. Modelled on Slipstream's swool.io Bank Transactions page.
  interface BankTxCommitmentInfo {
    id: number;
    fullName: string;
    street: string;
    houseNumber: string;
  }
  interface BankTxPledgeInfo {
    id: number;
    fullName: string;
    amount: number;
    amountReceived: number;
  }
  interface BankTxRow {
    id: number;
    transactionDate: string;
    description: string;
    amount: number;
    status: "unallocated" | "allocated" | "ignored";
    suggestedCommitmentId: number | null;
    commitmentId: number | null;
    invoiceId: number | null;
    paymentId: number | null;
    pledgeId: number | null;
    suggestedCommitment: BankTxCommitmentInfo | null;
    commitment: BankTxCommitmentInfo | null;
    pledge: BankTxPledgeInfo | null;
  }
  const [hideAllocatedTx, setHideAllocatedTx] = useState(true);
  const [showTxImport, setShowTxImport] = useState(false);
  const [txImportCsvText, setTxImportCsvText] = useState("");
  const [txImportResult, setTxImportResult] = useState<{ inserted: number; autoAllocated: number; unallocated: number; skippedDuplicate: number } | null>(null);

  const { data: bankTransactions = [], isLoading: bankTxLoading } = useQuery<BankTxRow[]>({
    queryKey: ["bank-transactions"],
    queryFn: () => fetch(`${BASE}/api/bank-transactions`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    }),
    enabled: authed && activeTab === "bank-transactions",
  });
  const visibleBankTransactions = hideAllocatedTx ? bankTransactions.filter(t => t.status !== "allocated") : bankTransactions;
  const unallocatedTxCount = bankTransactions.filter(t => t.status === "unallocated").length;

  const txImportMutation = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/bank-transactions/import`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ csv: txImportCsvText }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to import");
        return r.json();
      }),
    onSuccess: data => {
      setTxImportResult(data);
      setTxImportCsvText("");
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  const txIgnoreMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/bank-transactions/${id}/ignore`, { method: "POST", headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Failed to ignore");
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bank-transactions"] }),
  });
  const txUnignoreMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/bank-transactions/${id}/unignore`, { method: "POST", headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Failed to unignore");
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bank-transactions"] }),
  });

  // ── Allocate flow ──────────────────────────────────────────────────
  const [allocatingTx, setAllocatingTx] = useState<BankTxRow | null>(null);
  const [allocateSearch, setAllocateSearch] = useState("");
  const [allocateCommitmentId, setAllocateCommitmentId] = useState<number | null>(null);
  const [allocateInvoiceId, setAllocateInvoiceId] = useState<number | null>(null);

  interface SimpleCommitment { id: number; fullName: string; street: string; houseNumber: string }
  const { data: allCommitments = [] } = useQuery<SimpleCommitment[]>({
    queryKey: ["commitments-for-allocate"],
    queryFn: () => fetch(`${BASE}/api/commitments`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    }),
    enabled: authed && !!allocatingTx,
  });
  const allocateMatches = allocateSearch.trim().length >= 2
    ? allCommitments.filter(c =>
        c.fullName.toLowerCase().includes(allocateSearch.toLowerCase()) ||
        `${c.street} ${c.houseNumber}`.toLowerCase().includes(allocateSearch.toLowerCase()),
      ).slice(0, 8)
    : [];
  const { data: allocateInvoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ["invoices-for-allocate", allocateCommitmentId],
    queryFn: () => fetch(`${BASE}/api/invoices`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error("Failed to load");
      const all = await r.json() as InvoiceRow[];
      return all.filter(i => i.commitmentId === allocateCommitmentId);
    }),
    enabled: !!allocateCommitmentId,
  });

  // Invoice vs pledge — some large payments (e.g. a lump sum) turn out to be
  // a contribution toward the project rather than the regular household
  // levy. Added 2026-08-18 after finding real R5,000 payments that didn't
  // fit any single invoice.
  const [allocateMode, setAllocateMode] = useState<"invoice" | "pledge">("invoice");
  const [pledgeSearch, setPledgeSearch] = useState("");
  const [pledgeSelectedId, setPledgeSelectedId] = useState<number | null>(null);
  const [pledgeNewName, setPledgeNewName] = useState("");
  const [pledgeNewAmount, setPledgeNewAmount] = useState("");

  interface SimplePledge { id: number; fullName: string; amount: number; amountReceived: number }
  const { data: allPledges = [] } = useQuery<SimplePledge[]>({
    queryKey: ["pledges-for-allocate"],
    queryFn: () => fetch(`${BASE}/api/pledges`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    }),
    enabled: authed && !!allocatingTx && allocateMode === "pledge",
  });
  const pledgeMatches = pledgeSearch.trim().length >= 2
    ? allPledges.filter(p => p.fullName.toLowerCase().includes(pledgeSearch.toLowerCase())).slice(0, 8)
    : [];

  const allocatePledgeMutation = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/bank-transactions/${allocatingTx!.id}/allocate-pledge`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(
          pledgeSelectedId
            ? { pledgeId: pledgeSelectedId }
            : { newPledge: { fullName: pledgeNewName, amount: Number(pledgeNewAmount) || allocatingTx!.amount, isResident: !!allocatingTx!.suggestedCommitmentId } },
        ),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to allocate to pledge");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
      qc.invalidateQueries({ queryKey: ["pledges"] });
      setAllocatingTx(null);
    },
  });

  function openAllocate(tx: BankTxRow) {
    setAllocatingTx(tx);
    setAllocateMode("invoice");
    setAllocateSearch("");
    setAllocateCommitmentId(tx.suggestedCommitmentId ?? null);
    setAllocateInvoiceId(null);
    setPledgeSearch("");
    setPledgeSelectedId(null);
    setPledgeNewName(tx.suggestedCommitment?.fullName ?? "");
    setPledgeNewAmount(String(tx.amount));
    if (tx.suggestedCommitment) {
      setAllocateSearch(`${tx.suggestedCommitment.fullName} — ${tx.suggestedCommitment.street} ${tx.suggestedCommitment.houseNumber}`);
    }
  }

  const allocateMutation = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/bank-transactions/${allocatingTx!.id}/allocate`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ commitmentId: allocateCommitmentId, invoiceId: allocateInvoiceId }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to allocate");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank-transactions"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setAllocatingTx(null);
    },
  });

  // ── Bulk invoice generation ──────────────────────────────────────
  // Preview lists every "monthly" commitment not yet invoiced this calendar
  // month, with the rate that would apply. Admin deselects anyone who
  // shouldn't be invoiced (e.g. already paid their once-off) before confirming.
  interface BulkPreviewRow {
    commitmentId: number;
    fullName: string;
    street: string;
    houseNumber: string;
    email: string;
    rate: number;
  }
  const [showBulkInvoice, setShowBulkInvoice] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkResult, setBulkResult] = useState<{ createdCount: number; skippedCount: number } | null>(null);
  // "current" | "last" — lets Ingrid/Janine catch up a month that never got
  // invoiced, without touching the normal monthly flow's default behaviour.
  const [bulkMonth, setBulkMonth] = useState<"current" | "last">("current");

  function monthParamFor(which: "current" | "last"): string | undefined {
    if (which === "current") return undefined;
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}`;
  }

  const { data: bulkPreviewData, isLoading: bulkPreviewLoading, isError: bulkPreviewIsError, error: bulkPreviewError, refetch: refetchBulkPreview } = useQuery<{ eligible: BulkPreviewRow[]; alreadyInvoicedThisMonth: number }>({
    queryKey: ["invoices-bulk-preview", bulkMonth],
    queryFn: () => {
      const month = monthParamFor(bulkMonth);
      const url = month ? `${BASE}/api/invoices/bulk-preview?month=${month}` : `${BASE}/api/invoices/bulk-preview`;
      return fetch(url, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
        return r.json();
      });
    },
    enabled: authed && showBulkInvoice,
    retry: false,
  });

  function openBulkInvoiceDialog() {
    setBulkResult(null);
    setBulkMonth("current");
    setShowBulkInvoice(true);
  }

  // Default every eligible household to checked once the preview loads.
  useEffect(() => {
    if (bulkPreviewData?.eligible) {
      setBulkSelected(new Set(bulkPreviewData.eligible.map(r => r.commitmentId)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkPreviewData]);

  function toggleBulkSelected(id: number) {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const bulkGenerate = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/invoices/bulk-generate`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ commitmentIds: Array.from(bulkSelected), month: monthParamFor(bulkMonth) }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to generate invoices");
        return r.json() as Promise<{ created: string[]; skipped: { commitmentId: number; reason: string }[]; createdCount: number; skippedCount: number }>;
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setBulkResult({ createdCount: data.createdCount, skippedCount: data.skippedCount });
      refetchBulkPreview();
    },
  });

  // ── Once-off (R3,000) signups: one invoice each, ever ───────────────────
  // Same preview-then-confirm shape as the monthly flow, but no month concept
  // — a commitment either has an invoice on record already or it doesn't.
  interface OnceoffPreviewRow {
    commitmentId: number;
    fullName: string;
    street: string;
    houseNumber: string;
    email: string;
    amount: number;
    willBeMarkedPaid: boolean;
  }
  const [showOnceoffInvoice, setShowOnceoffInvoice] = useState(false);
  const [onceoffSelected, setOnceoffSelected] = useState<Set<number>>(new Set());
  const [onceoffResult, setOnceoffResult] = useState<{ createdCount: number; skippedCount: number } | null>(null);

  const { data: onceoffPreviewData, isLoading: onceoffPreviewLoading, isError: onceoffPreviewIsError, error: onceoffPreviewError, refetch: refetchOnceoffPreview } = useQuery<{ eligible: OnceoffPreviewRow[]; alreadyInvoiced: number }>({
    queryKey: ["invoices-onceoff-preview"],
    queryFn: () =>
      fetch(`${BASE}/api/invoices/onceoff-preview`, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
        return r.json();
      }),
    enabled: authed && showOnceoffInvoice,
    retry: false,
  });

  function openOnceoffInvoiceDialog() {
    setOnceoffResult(null);
    setShowOnceoffInvoice(true);
  }

  useEffect(() => {
    if (onceoffPreviewData?.eligible) {
      setOnceoffSelected(new Set(onceoffPreviewData.eligible.map(r => r.commitmentId)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onceoffPreviewData]);

  function toggleOnceoffSelected(id: number) {
    setOnceoffSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const onceoffGenerate = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/invoices/onceoff-generate`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ commitmentIds: Array.from(onceoffSelected) }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to generate once-off invoices");
        return r.json() as Promise<{ created: string[]; skipped: { commitmentId: number; reason: string }[]; createdCount: number; skippedCount: number }>;
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setOnceoffResult({ createdCount: data.createdCount, skippedCount: data.skippedCount });
      refetchOnceoffPreview();
    },
  });

  // ── Bulk invoice email ─────────────────────────────────────────
  // Same shape as bulk invoice generation above: preview first, admin
  // confirms, then send. Only ever emails an invoice once (server tracks
  // emailSentAt), so it's safe to click again later for newly generated ones.
  const [showSendAllInvoices, setShowSendAllInvoices] = useState(false);
  const [sendAllResult, setSendAllResult] = useState<{ sent: number; skippedNoEmail: number; failed: number; failureReasons?: string[] } | null>(null);
  // Running totals shown WHILE the batches are still going — the server only
  // ever processes a bounded batch per request (see SEND_ALL_BATCH_SIZE on the
  // backend), so a large run (hundreds of invoices) takes several calls
  // instead of one long one that could time out. This also means it's safe to
  // leave this running; there's no single request that can hang indefinitely.
  const [sendAllProgress, setSendAllProgress] = useState<{ sent: number; skippedNoEmail: number; failed: number } | null>(null);

  const { data: unsentData, isLoading: unsentLoading, isError: unsentIsError, error: unsentError, refetch: refetchUnsent } = useQuery<{ readyToSend: number; noEmailOnFile: number; preview: { id: number; invoiceNumber: string; billToName: string; billToEmail: string; total: number }[] }>({
    queryKey: ["invoices-unsent"],
    queryFn: () =>
      fetch(`${BASE}/api/invoices/unsent`, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
        return r.json();
      }),
    enabled: authed && showSendAllInvoices,
    retry: false,
  });

  function openSendAllDialog() {
    setSendAllResult(null);
    setSendAllProgress(null);
    setShowSendAllInvoices(true);
  }

  const sendAllInvoices = useMutation({
    mutationFn: async () => {
      let totals: { sent: number; skippedNoEmail: number; failed: number; failureReasons?: string[] } = { sent: 0, skippedNoEmail: 0, failed: 0 };
      setSendAllProgress(totals);
      // Loop calling the batched endpoint until it reports nothing left —
      // each individual call stays small/fast so it can't hang like a single
      // all-488-at-once request would.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await fetch(`${BASE}/api/invoices/send-all`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        });
        if (!res.ok) {
          throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to send invoices");
        }
        const data = (await res.json()) as { sent: number; skippedNoEmail: number; failed: number; remaining: number; failureReasons?: string[] };
        totals = {
          sent: totals.sent + data.sent,
          skippedNoEmail: totals.skippedNoEmail + data.skippedNoEmail,
          failed: totals.failed + data.failed,
          failureReasons: data.failureReasons?.length ? data.failureReasons : totals.failureReasons,
        };
        setSendAllProgress(totals);
        // If an entire batch sent nothing successfully, something systemic is
        // wrong (rate limit, bad API key, etc) — stop instead of hammering
        // the same failing batch forever (failed invoices stay unsent, so
        // they'd just be retried every loop with no progress).
        if (data.sent === 0 && data.failed > 0) {
          throw new Error(
            `Every invoice in this batch failed to send${data.failureReasons?.length ? ` (${data.failureReasons.join(", ")})` : ""} — stopped before retrying more.`,
          );
        }
        if (!data.remaining) break;
      }
      return totals;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setSendAllResult(data);
      refetchUnsent();
    },
  });

  function invoiceStatusBadgeClass(status: string): string {
    switch (status) {
      case "paid": return "bg-green-500/20 text-green-400 border-green-500/20";
      case "overdue": return "bg-red-500/20 text-red-400 border-red-500/20";
      case "cancelled": return "bg-muted text-muted-foreground border-transparent";
      case "draft": return "bg-blue-500/20 text-blue-400 border-blue-500/20";
      default: return "bg-amber-500/20 text-amber-400 border-amber-500/20"; // unpaid
    }
  }

  function printInvoice(inv: InvoiceRow) {
    const w = window.open("", "_blank");
    if (!w) return;
    const items = (inv.lineItems ?? [])
      .map(
        li =>
          `<tr><td style="padding:6px 8px;border-bottom:1px solid #ddd;">${li.description}</td><td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center;">${li.quantity}</td><td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;">R${li.unitAmount.toLocaleString("en-ZA")}</td><td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;">R${li.amount.toLocaleString("en-ZA")}</td></tr>`,
      )
      .join("");
    const logoSrc = "data:image/png;base64,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";
    w.document.write(`<!DOCTYPE html><html><head><title>${inv.invoiceNumber}</title></head><body style="font-family:sans-serif;max-width:640px;margin:2rem auto;background:#0a0a0a;color:#f2f2f2;padding:2rem;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem;">
        <img src="${logoSrc}" alt="KCEA" style="height:56px;width:auto;" />
        <div>
          <p style="margin:0;font-weight:bold;font-size:1.05rem;">Kensington Central Enclosure Association</p>
          <p style="color:#aaa;margin:2px 0 0;font-size:0.85rem;">FNB Gold Business Account 63213323693</p>
        </div>
      </div>
      <h2 style="color:#FA0377;margin-bottom:0.25rem;">Invoice ${inv.invoiceNumber}</h2>
      <p><strong>Bill to:</strong> ${inv.billToName}${inv.billToStreet ? ` — ${inv.billToStreet} ${inv.billToHouseNumber ?? ""}` : ""}</p>
      <p style="color:#ccc;">Invoice date: ${new Date(inv.invoiceDate).toLocaleDateString("en-ZA")} &nbsp; | &nbsp; Due: ${new Date(inv.dueDate).toLocaleDateString("en-ZA")}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
        <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #FA0377;">Description</th><th style="padding:6px 8px;border-bottom:2px solid #FA0377;">Qty</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #FA0377;">Unit</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #FA0377;">Amount</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
      <p style="text-align:right;font-size:1.2rem;margin-top:1rem;color:#FA0377;"><strong>Total: R${inv.total.toLocaleString("en-ZA")}</strong></p>
      <p style="color:#aaa;font-size:0.85rem;">Payment reference: house number + street name. Status: ${inv.status}.</p>
      <p style="color:#aaa;font-size:0.85rem;margin-top:0.75rem;">Authorised by: Kensington Central Enclosure Association</p>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  const { data: incompleteRecords = [], isLoading: incompleteLoading } = useQuery<IncompleteCommitment[]>({
    queryKey: ["incomplete-commitments"],
    queryFn: () =>
      fetch(`${BASE}/api/commitments/incomplete`, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      }),
    enabled: authed && (activeTab === "incomplete" || activeTab === "stats"),
  });

  const updateStats = useMutation({
    mutationFn: (data: Partial<SiteStats>) =>
      fetch(`${BASE}/api/stats`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(data),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stats"] });
      setStatsSaved(true);
      setStatsForm({});
      setTimeout(() => setStatsSaved(false), 3000);
    },
  });

  const updateCaptain = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<StreetCaptain> }) =>
      fetch(`${BASE}/api/captains/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(data),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["captains"] });
      setCaptainEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
      setSavedCaptains(prev => new Set([...prev, id]));
      setTimeout(() => setSavedCaptains(prev => { const n = new Set(prev); n.delete(id); return n; }), 3000);
    },
  });

  const deleteCommitment = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/commitments/${id}`, { method: "DELETE", headers: authHeaders })
        .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commitments"] }),
  });

  const updateCommitment = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Commitment> }) =>
      fetch(`${BASE}/api/commitments/${id}`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({ error: "Update failed" }))).error ?? "Update failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commitments"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["captains"] });
    },
  });

  const markWelcomed = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/captains/${id}/welcomed`, { method: "POST", headers: authHeaders })
        .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["captains"] }),
  });

  const markPinSent = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/captain/management/${id}/mark-pin-sent`, { method: "POST", headers: authHeaders, keepalive: true })
        .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["captain-profiles"] }),
  });

  const [welcomeModalId, setWelcomeModalId] = useState<number | null>(null);

  const toggleCaptainStatus = useMutation({
    mutationFn: ({ id, captainStatus }: { id: number; captainStatus: string }) =>
      fetch(`${BASE}/api/captains/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ captainStatus }),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["captains"] });
      if (vars.captainStatus === "Active Captain") {
        setWelcomeModalId(vars.id);
      }
    },
  });

  const deleteCaptain = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/captains/${id}`, { method: "DELETE", headers: authHeaders })
        .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["captains"] }),
  });

  const addStreet = useMutation({
    mutationFn: (street: string) =>
      fetch(`${BASE}/api/captains/add-street`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ street }),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["captains"] });
    },
    onError: (err: Error) => {
      alert(`Could not add street: ${err.message || "Try again."}`);
    },
  });

  const confirmPayment = useMutation({
    mutationFn: ({ id, paymentConfirmed }: { id: number; paymentConfirmed: boolean }) =>
      fetch(`${BASE}/api/commitments/${id}/confirm`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ paymentConfirmed }),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commitments"] }),
  });

  const { data: captainProfiles = [] } = useQuery<CaptainProfile[]>({
    queryKey: ["captain-profiles"],
    queryFn: () => fetch(`${BASE}/api/captain/management`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error(await r.text()); return r.json();
    }),
    enabled: authed && activeTab === "captain-mgmt",
  });

  const [profileSearch, setProfileSearch] = useState("");
  const filteredProfiles = useMemo(() => {
    const q = profileSearch.trim().toLowerCase();
    if (!q) return captainProfiles;
    return captainProfiles.filter(p => {
      if (p.name.toLowerCase().includes(q)) return true;
      const streets = captains.filter(c => c.captain === p.name).map(c => c.street.toLowerCase());
      return streets.some(s => s.includes(q));
    });
  }, [captainProfiles, captains, profileSearch]);

  // ── Manage Captains (assignments) ──────────────────────────────
  const { data: captainAssignments = [], isLoading: assignmentsLoading } = useQuery<CaptainAssignmentRow[]>({
    queryKey: ["captain-assignments"],
    queryFn: () => fetch(`${BASE}/api/captain-assignments`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error(await r.text()); return r.json();
    }),
    enabled: authed && activeTab === "manage-captains",
  });

  // The set of streets offered in the multi-select: canonical list plus any
  // street already on the captain roster (so custom-added streets show up too).
  const assignableStreets = useMemo(() => {
    const set = new Set<string>(STREET_OPTIONS.map(o => o.value));
    for (const c of captains) if (c.street?.trim()) set.add(c.street.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [captains]);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  // When editing, holds the resident row being edited; null means a new assignment.
  const [editingAssignment, setEditingAssignment] = useState<CaptainAssignmentRow | null>(null);
  const [assignResidentId, setAssignResidentId] = useState<number | null>(null);
  const [assignResidentSearch, setAssignResidentSearch] = useState("");
  const [assignStreets, setAssignStreets] = useState<string[]>([]);
  const [assignPhone, setAssignPhone] = useState("");
  const [assignError, setAssignError] = useState("");

  const residentSearchResults = useMemo(() => {
    const q = assignResidentSearch.trim().toLowerCase();
    if (!q) return [] as Commitment[];
    return commitments
      .filter(c => c.fullName.toLowerCase().includes(q) || c.street.toLowerCase().includes(q))
      .slice(0, 12);
  }, [commitments, assignResidentSearch]);

  const selectedResident = useMemo(
    () => commitments.find(c => c.id === assignResidentId) ?? null,
    [commitments, assignResidentId],
  );

  function openAssignModal() {
    setEditingAssignment(null);
    setAssignResidentId(null);
    setAssignResidentSearch("");
    setAssignStreets([]);
    setAssignPhone("");
    setAssignError("");
    setAssignModalOpen(true);
  }

  function openEditAssignment(row: CaptainAssignmentRow) {
    setEditingAssignment(row);
    setAssignResidentId(row.residentId);
    setAssignResidentSearch(row.fullName);
    setAssignStreets(row.streets.slice());
    setAssignPhone(row.phone ?? "");
    setAssignError("");
    setAssignModalOpen(true);
  }

  function toggleAssignStreet(street: string) {
    setAssignStreets(prev =>
      prev.includes(street) ? prev.filter(s => s !== street) : [...prev, street],
    );
  }

  const assignCaptain = useMutation({
    mutationFn: (payload: { residentId: number; streets: string[]; phone: string }) =>
      fetch(`${BASE}/api/captain-assignments`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({ error: "Failed" }))).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["captain-assignments"] });
      qc.invalidateQueries({ queryKey: ["captains"] });
      qc.invalidateQueries({ queryKey: ["captain-profiles"] });
      qc.invalidateQueries({ queryKey: ["commitments"] });
      setAssignModalOpen(false);
    },
    onError: (err: Error) => setAssignError(err.message || "Failed to assign captain"),
  });

  const updateAssignment = useMutation({
    mutationFn: ({ residentId, ...payload }: { residentId: number; streets: string[]; phone: string }) =>
      fetch(`${BASE}/api/captain-assignments/${residentId}`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({ error: "Failed" }))).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["captain-assignments"] });
      qc.invalidateQueries({ queryKey: ["captains"] });
      qc.invalidateQueries({ queryKey: ["captain-profiles"] });
      qc.invalidateQueries({ queryKey: ["commitments"] });
      setAssignModalOpen(false);
    },
    onError: (err: Error) => setAssignError(err.message || "Failed to update assignment"),
  });

  const removeAssignment = useMutation({
    mutationFn: (residentId: number) =>
      fetch(`${BASE}/api/captain-assignments/${residentId}`, { method: "DELETE", headers: authHeaders })
        .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["captain-assignments"] });
      qc.invalidateQueries({ queryKey: ["captains"] });
    },
  });

  function saveAssignment() {
    setAssignError("");
    if (!assignResidentId) { setAssignError("Please select a resident."); return; }
    if (assignStreets.length === 0) { setAssignError("Please select at least one street."); return; }
    const payload = { residentId: assignResidentId, streets: assignStreets, phone: assignPhone.trim() };
    if (editingAssignment) {
      updateAssignment.mutate(payload);
    } else {
      assignCaptain.mutate(payload);
    }
  }

  const { data: siteSettings } = useQuery<{ notifyWhatsapp: string | null }>({
    queryKey: ["site-settings"],
    queryFn: () => fetch(`${BASE}/api/settings`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error(await r.text()); return r.json();
    }),
    enabled: authed,
  });
  const storedWhatsapp = siteSettings?.notifyWhatsapp ?? "";
  const adminWhatsapp = storedWhatsapp || "0832355052";
  const [whatsappEdit, setWhatsappEdit] = useState<string | null>(null);
  const [whatsappSaved, setWhatsappSaved] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);
  const runMigrate = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/admin/migrate`, { method: "POST", headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Migration failed");
        return r.json();
      }),
    onSuccess: (d: { commitments: { before: number; deleted: number; after: number }; captains: Array<{ street: string; updated: boolean }>; splits?: Array<{ street: string; names: string[] }>; earlsCourtAdded?: boolean; settings: { notifyWhatsappInitialized: boolean } }) => {
      const capStreets = d.captains.filter(c => c.updated).map(c => c.street).join(", ");
      const splitsTxt = (d.splits ?? []).map(s => `${s.street} → ${s.names.join(", ")}`).join("; ");
      setMigrateResult(
        `Commitments: ${d.commitments.before} → ${d.commitments.after} (deleted ${d.commitments.deleted} placeholders). ` +
        `Captains updated: ${capStreets || "none"}. ` +
        (splitsTxt ? `Split: ${splitsTxt}. ` : "") +
        (d.earlsCourtAdded ? "Earls Court added. " : "") +
        (d.settings.notifyWhatsappInitialized ? "WhatsApp number initialized." : "")
      );
      qc.invalidateQueries({ queryKey: ["commitments"] });
      qc.invalidateQueries({ queryKey: ["captains"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: () => setMigrateResult("Migration failed. Check console."),
  });
  const updateSettings = useMutation({
    mutationFn: (data: { notifyWhatsapp?: string }) =>
      fetch(`${BASE}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(data),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site-settings"] });
      setWhatsappEdit(null);
      setWhatsappSaved(true);
      setTimeout(() => setWhatsappSaved(false), 3000);
    },
  });
  const [pinSetupResult, setPinSetupResult] = useState<string | null>(null);
  const sendPinSetupEmails = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/captain/management/send-pin-setup-emails`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: (d: { sent: number; noEmailOnFile: string[]; failed: string[] }) => {
      setPinSetupResult(
        `Sent ${d.sent} email${d.sent === 1 ? "" : "s"}.` +
        (d.noEmailOnFile.length ? ` No email on file: ${d.noEmailOnFile.join(", ")}.` : "") +
        (d.failed.length ? ` Failed: ${d.failed.join(", ")}.` : "")
        );
      qc.invalidateQueries({ queryKey: ["captain-profiles"] });
    },
    onError: () => setPinSetupResult("Failed to send. Check console."),
  });

  const { data: captainNotes = [] } = useQuery<CaptainNote[]>({
    queryKey: ["captain-notes"],
    queryFn: () => fetch(`${BASE}/api/captain/management/notes`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error(await r.text()); return r.json();
    }),
    enabled: authed && activeTab === "captain-mgmt",
  });

  const updateCaptainProfile = useMutation({
    mutationFn: ({ id, ...body }: { id: number; pin?: string; phone?: string; email?: string }) =>
      fetch(`${BASE}/api/captain/management/${id}`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["captain-profiles"] });
      setSavedProfiles(prev => new Set([...prev, vars.id]));
      setPinEdits(prev => { const n = { ...prev }; delete n[vars.id]; return n; });
      setTimeout(() => setSavedProfiles(prev => { const n = new Set(prev); n.delete(vars.id); return n; }), 3000);
    },
  });

  const createCaptainProfile = useMutation({
    mutationFn: (body: { name: string; phone: string; email: string }) =>
      fetch(`${BASE}/api/captain/management/profiles`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["captain-profiles"] });
      setNewProfileName(""); setNewProfilePhone(""); setNewProfileEmail(""); setShowAddProfile(false);
    },
  });

  const deleteCaptainProfile = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/captain/management/${id}`, { method: "DELETE", headers: authHeaders })
        .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["captain-profiles"] }),
  });


  const handleSetPin = async (id: number) => {
    setSetPinLoading(prev => new Set([...prev, id]));
    try {
      const res = await fetch(`${BASE}/api/captain/management/${id}/set-pin`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json() as { pin?: string };
      if (res.ok && data.pin) {
        setSetPinResult(prev => ({ ...prev, [id]: { pin: data.pin!, sent: false } }));
        qc.invalidateQueries({ queryKey: ["captain-profiles"] });
        setTimeout(() => setSetPinResult(prev => { const n = { ...prev }; delete n[id]; return n; }), 10000);
      }
    } finally {
      setSetPinLoading(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await fetch(`${BASE}/api/admin/verify`, {
        method: "POST",
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({})) as { role?: "primary" | "secondary" };
        setAuthRole(data.role ?? "secondary");
        setAuthed(true);
      } else {
        setAuthError("Incorrect username or password. Please try again.");
      }
    } catch {
      setAuthError("Could not reach the server. Please try again.");
    }
  };

  const handleStatsChange = (field: keyof SiteStats, value: string) =>
    setStatsForm(prev => ({ ...prev, [field]: parseInt(value, 10) || 0 }));

  const handleCaptainChange = (id: number, field: keyof StreetCaptain, value: string | number) =>
    setCaptainEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }));

  const exportCsv = () => {
    const headers = ["ID", "Name", "Email", "Phone", "Street", "House", "Type", "Source", "Date"];
    const rows = commitments.map(c => [
      c.id, c.fullName, c.email, c.phone, c.street, c.houseNumber,
      c.commitmentType === "onceoff" ? "Once-off (R3,000)" : "Monthly (R250/mo)",
      c.imported ? "Imported" : "Online",
      new Date(c.submittedAt).toLocaleString(),
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `kcea-commitments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const parseCSV = (text: string) => {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
    if (lines.length < 2) return [];

    const parseRow = (line: string): string[] => {
      const cols: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else { inQ = !inQ; }
        } else if (ch === "," && !inQ) {
          cols.push(cur.trim()); cur = "";
        } else {
          cur += ch;
        }
      }
      cols.push(cur.trim());
      return cols;
    };

    const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const colIndex = (names: string[]) => {
      for (const n of names) { const i = headers.indexOf(n); if (i !== -1) return i; }
      return -1;
    };

    const nameIdx = colIndex(["fullname", "name", "fullname"]);
    const streetIdx = colIndex(["street", "streetname"]);
    const houseIdx = colIndex(["housenumber", "house", "houseno", "housenum"]);
    const emailIdx = colIndex(["email", "emailaddress"]);
    const phoneIdx = colIndex(["phone", "cellnumber", "cell", "mobile"]);
    const typeIdx = colIndex(["commitmenttype", "type", "paymenttype"]);
    const dateIdx = colIndex(["datesubmitted", "date", "submitteddate", "submittedat", "datesigned"]);

    return lines.slice(1).map(line => {
      const cols = parseRow(line);
      const get = (i: number) => (i >= 0 ? (cols[i] ?? "").trim() : "");
      return {
        fullName: get(nameIdx),
        street: get(streetIdx),
        houseNumber: get(houseIdx),
        email: get(emailIdx),
        phone: get(phoneIdx),
        commitmentType: get(typeIdx),
        submittedAt: get(dateIdx),
      };
    }).filter(r => r.fullName || r.street);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    setImportError("");
    setImportResult(null);
    setImportLoading(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) { setImportError("No valid rows found in the CSV file."); setImportLoading(false); return; }
      const res = await fetch(`${BASE}/api/commitments/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) { setImportError("Import failed — server error."); setImportLoading(false); return; }
      const result: ImportResult = await res.json();
      setImportResult(result);
      qc.invalidateQueries({ queryKey: ["commitments"] });
    } catch {
      setImportError("Could not read or parse the file.");
    } finally {
      setImportLoading(false);
    }
  };

  const filtered = commitments.filter(c => {
    const q = search.toLowerCase();
    return !q || [c.fullName, c.email, c.street, c.phone].some(v => v.toLowerCase().includes(q));
  });

  const monthlyCount = commitments.filter(c => c.commitmentType === "monthly").length;
  const onceOffCount = commitments.filter(c => c.commitmentType === "onceoff").length;

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    commitments.forEach(c => {
      const key = `${c.fullName.toLowerCase()}|${c.street.toLowerCase()}|${c.houseNumber.toLowerCase()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [commitments]);

  // Total rows that participate in a duplicate set (e.g. 2 identical entries = 2 duplicates).
  const duplicateRowCount = useMemo(
    () => commitments.filter(c => duplicateKeys.has(`${c.fullName.toLowerCase()}|${c.street.toLowerCase()}|${c.houseNumber.toLowerCase()}`)).length,
    [commitments, duplicateKeys],
  );

  if (!authed) {
    return (
      <div className="min-h-screen bg-background text-foreground dark flex items-center justify-center p-4">
        <Card className="bg-card border-card-border w-full max-w-sm">
          <CardHeader className="text-center space-y-2">
            <div className="flex justify-center">
              <div className="bg-primary/20 p-3 rounded-full">
                <Shield className="h-8 w-8 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl">KCEA Admin</CardTitle>
            <p className="text-sm text-muted-foreground">Enter your admin credentials to continue</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="kcea-admin"
                  className="bg-background border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="bg-background border-border"
                />
              </div>
              {authError && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 p-3 rounded-md border border-red-500/20">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {authError}
                </div>
              )}
              <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                <LogIn className="mr-2 h-4 w-4" />
                Sign In
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground dark font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-xl">
            <img src={`${BASE}/kcea-logo.png`} alt="KCEA" className="h-8 w-auto" />
            Admin
          </div>
          <div className="flex items-center gap-3">
            <a href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">← Back to site</a>
            {authRole === "secondary" && (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-300">
                Secondary admin
              </span>
            )}
            <Button variant="outline" size="sm" className="border-border" onClick={() => { setAuthed(false); setPassword(""); setUsername(""); setAuthRole(null); setSecondaryPwView(null); }}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Manage submissions, stats, and street captain data.</p>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-card border-card-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="bg-primary/20 p-2 rounded-lg"><ClipboardList className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold">{commitments.length}</p>
                <p className="text-xs text-muted-foreground">Total submissions</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-card-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="bg-blue-500/20 p-2 rounded-lg"><Users className="h-5 w-5 text-blue-400" /></div>
              <div>
                <p className="text-2xl font-bold">{monthlyCount}</p>
                <p className="text-xs text-muted-foreground">Monthly (R250/mo)</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-card-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="bg-green-500/20 p-2 rounded-lg"><BarChart3 className="h-5 w-5 text-green-400" /></div>
              <div>
                <p className="text-2xl font-bold">{onceOffCount}</p>
                <p className="text-xs text-muted-foreground">Once-off (R3,000)</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-6 items-start">
          {/* Sidebar nav */}
          <nav className="w-56 shrink-0 space-y-1 sticky top-24">
            {([ ["submissions", ClipboardList, "Residents"], ["stats", BarChart3, "Stats"], ["captains", Users, "Captains"], ["manage-captains", UserPlus, "Manage Captains"], ["incomplete", AlertTriangle, "Incomplete"], ["captain-mgmt", Key, "Captain Portal"], ["pledges", Heart, "Pledges"], ["invoices", FileText, "Invoices"], ["bank-transactions", Landmark, "Bank Transactions"], ["expenses", Receipt, "Expenses"], ["settings", SettingsIcon, "Settings"] ] as const).map(([tab, Icon, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{label}</span>
                {tab === "submissions" && commitments.length > 0 && (
                  <span className="bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full">{commitments.length}</span>
                )}
                {tab === "incomplete" && incompleteRecords.length > 0 && (
                  <span className="bg-amber-500/20 text-amber-400 text-xs px-1.5 py-0.5 rounded-full">{incompleteRecords.length}</span>
                )}
                {tab === "bank-transactions" && unallocatedTxCount > 0 && (
                  <span className="bg-amber-500/20 text-amber-400 text-xs px-1.5 py-0.5 rounded-full">{unallocatedTxCount}</span>
                )}
              </button>
            ))}
          </nav>

          {/* Tab content */}
          <div className="flex-1 min-w-0 space-y-8">
          {viewingResidentId !== null ? (
            <ResidentDetailPanel
              residentId={viewingResidentId}
              contact={viewingResidentContact}
              statement={residentStatement}
              statementLoading={residentStatementLoading}
              authHeaders={authHeaders}
              onBack={() => setViewingResidentId(null)}
              onEdit={() => { if (viewingResidentContact) { openEditCommitment(viewingResidentContact); setViewingResidentId(null); } }}
              onOpenMultiMonth={() => {
                if (viewingResidentId !== null) setMultiMonthCommitmentId(String(viewingResidentId));
                setShowMultiMonth(true);
              }}
              onSaveNotes={(id, notes) => updateCommitment.mutate({ id, patch: { notes } })}
              savingNotes={updateCommitment.isPending}
              invoiceStatusBadgeClass={invoiceStatusBadgeClass}
            />
          ) : (
          <>
        {/* Submissions Tab */}
        {activeTab === "submissions" && (
          <Card className="bg-card border-card-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
              <CardTitle className="text-xl">Residents</CardTitle>
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleImport}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border gap-2"
                  onClick={() => { setImportResult(null); setImportError(""); fileInputRef.current?.click(); }}
                  disabled={importLoading}
                >
                  <Upload className="h-4 w-4" />
                  {importLoading ? "Importing…" : "Import CSV"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border gap-2"
                  onClick={exportCsv}
                  disabled={commitments.length === 0}
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
                {(() => {
                  const pending = new Set<string>();
                  for (const c of commitments) {
                    const s = (c.street ?? "").trim();
                    if (!s || s.toLowerCase() === "other") continue;
                    if (isNewStreet(s)) pending.add(s.toLowerCase());
                  }
                  if (pending.size === 0) return null;
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-500/40 text-amber-300 hover:text-amber-200 gap-2"
                      data-testid="btn-ignore-all-new-streets"
                      onClick={() => {
                        if (confirm(`Dismiss all ${pending.size} "New Street" flag${pending.size === 1 ? "" : "s"}? They won't be added to the streets list. You can still add them manually later from the Captains tab.`)) {
                          const next = new Set(dismissedNewStreets);
                          for (const s of pending) next.add(s);
                          persistDismissed(next);
                        }
                      }}
                    >
                      Ignore all ({pending.size})
                    </Button>
                  );
                })()}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {importResult && (
                <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/20 rounded-lg p-4 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-green-400">Import complete</p>
                    <p className="text-muted-foreground mt-0.5">
                      {importResult.added} record{importResult.added !== 1 ? "s" : ""} added
                      {(importResult.duplicates ?? 0) > 0 && (
                        <> · <span className="text-amber-400">{importResult.duplicates} duplicate{importResult.duplicates !== 1 ? "s" : ""} flagged &amp; skipped</span></>
                      )}
                      {importResult.skipped > 0 && ` · ${importResult.skipped} malformed row${importResult.skipped !== 1 ? "s" : ""} skipped`}
                    </p>
                    {(importResult.duplicates ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Duplicates match an existing record by phone number, or by name + street.
                      </p>
                    )}
                  </div>
                  <button onClick={() => setImportResult(null)} className="ml-auto text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
                </div>
              )}
              {importError && (
                <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {importError}
                  <button onClick={() => setImportError("")} className="ml-auto text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, street…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 bg-background border-border"
                />
              </div>

              {commitmentsLoading ? (
                <p className="text-muted-foreground text-sm py-4">Loading…</p>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <ClipboardList className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                  <p className="text-muted-foreground text-sm">
                    {search ? "No results match your search." : "No submissions yet. They'll appear here when residents complete the form."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Header row */}
                  <div className="grid grid-cols-12 gap-3 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
                    <div className="col-span-2">Name</div>
                    <div className="col-span-2">Street / House</div>
                    <div className="col-span-2">Contact</div>
                    <div className="col-span-2">Type</div>
                    <div className="col-span-1">Date</div>
                    <div className="col-span-3"></div>
                  </div>
                  {filtered.map(c => {
                    const streetMissing = !c.street || !c.street.trim() || c.street.trim().toLowerCase() === "other";
                    // Only flag as a "new street" worth adding to the list when
                    // the value is a real street name we haven't seen — never
                    // for blank/placeholder rows. Those use the "Request Street
                    // Info" follow-up button below instead.
                    const newStreet = !streetMissing && isNewStreet(c.street);
                    const streetInfoDigits = (c.phone || "").replace(/\D/g, "");
                    const streetInfoNormalised = streetInfoDigits.startsWith("0") ? "27" + streetInfoDigits.slice(1) : streetInfoDigits;
                    const streetInfoWaUrl = /^\d{10,15}$/.test(streetInfoNormalised)
                      ? `https://wa.me/${streetInfoNormalised}?text=${encodeURIComponent(`Hi ${(c.fullName || "there").split(/\s+/)[0]}, thank you for committing to the KCEA project! We noticed your street name is missing from your registration. Could you please reply with your street name and house number so we can update your record? Thank you! 🏘️`)}`
                      : null;
                    return (
                    <div key={c.id} className={`grid grid-cols-12 gap-3 items-center px-3 py-3 rounded-lg border transition-colors ${streetMissing ? "bg-red-500/5 border-red-500/40 hover:border-red-500/60" : newStreet ? "bg-amber-500/5 border-amber-500/40 hover:border-amber-500/60" : "bg-background/50 border-border hover:border-border/80"}`} data-testid={`submission-row-${c.id}`}>
                      <div className="col-span-2">
                        <button
                          type="button"
                          onClick={() => setViewingResidentId(c.id)}
                          className="font-medium text-sm text-primary hover:underline text-left"
                          data-testid={`link-resident-${c.id}`}
                        >
                          {c.fullName}
                        </button>
                        <p className="text-xs text-muted-foreground">#{c.id}</p>
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm">{streetMissing ? <span className="text-red-300 italic">Street missing</span> : c.street}</p>
                          {newStreet && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5 py-0 h-4" variant="outline" data-testid={`badge-new-street-${c.id}`}>
                              New Street
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">No. {c.houseNumber}</p>
                        {newStreet && (
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Add "${c.street}" to the streets list with a default of 20 households? You can edit the target later in the Captains tab.`)) {
                                  addStreet.mutate(c.street.trim());
                                }
                              }}
                              disabled={addStreet.isPending}
                              className="text-[11px] text-amber-300 hover:text-amber-200 underline underline-offset-2 disabled:opacity-50"
                              data-testid={`btn-add-street-${c.id}`}
                            >
                              Add {c.street} to streets list
                            </button>
                            <span className="text-[11px] text-muted-foreground">·</span>
                            <button
                              type="button"
                              onClick={() => {
                                const next = new Set(dismissedNewStreets);
                                next.add(c.street.trim().toLowerCase());
                                persistDismissed(next);
                              }}
                              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                              data-testid={`btn-dismiss-new-street-${c.id}`}
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                        {streetMissing && (
                          streetInfoWaUrl ? (
                            <a
                              href={streetInfoWaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-block text-[11px] text-red-300 hover:text-red-200 underline underline-offset-2"
                              data-testid={`btn-request-street-info-${c.id}`}
                            >
                              Request Street Info via WhatsApp
                            </a>
                          ) : (
                            <span className="mt-1 inline-block text-[11px] text-muted-foreground italic">
                              No valid phone for follow-up
                            </span>
                          )
                        )}
                      </div>
                      <div className="col-span-2 min-w-0">
                        <p className="text-xs truncate">{c.email}</p>
                        <p className="text-xs text-muted-foreground">{c.phone}</p>
                      </div>
                      <div className="col-span-2 flex flex-col gap-1">
                        <TypeBadge type={c.commitmentType} />
                        {c.imported && (
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/20 text-xs w-fit" variant="outline">Imported</Badge>
                        )}
                        {c.paymentConfirmed && (
                          <Badge className="bg-green-500/20 text-green-400 border-green-500/20 text-xs w-fit" variant="outline">Paid ✓</Badge>
                        )}
                        {duplicateKeys.has(`${c.fullName.toLowerCase()}|${c.street.toLowerCase()}|${c.houseNumber.toLowerCase()}`) && (
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/20 text-xs w-fit" variant="outline">Duplicate</Badge>
                        )}
                      </div>
                      <div className="col-span-1">
                        <p className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(c.submittedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                        </p>
                      </div>
                      <div className="col-span-3 flex items-center justify-end gap-1">
                        {editSavedId === c.id && (
                          <span className="text-xs text-green-400 flex items-center gap-1 mr-1"><CheckCircle className="h-3.5 w-3.5" /> Saved</span>
                        )}
                        <button
                          onClick={() => setViewingResidentId(c.id)}
                          className="text-muted-foreground hover:text-primary transition-colors p-1 rounded"
                          title="View resident — balance & history"
                          data-testid={`btn-view-resident-${c.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => confirmPayment.mutate({ id: c.id, paymentConfirmed: !c.paymentConfirmed })}
                          className={`transition-colors p-1 rounded ${c.paymentConfirmed ? "text-green-400 hover:text-muted-foreground" : "text-muted-foreground hover:text-green-400"}`}
                          title={c.paymentConfirmed ? "Mark payment unconfirmed" : "Mark payment confirmed"}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => openEditCommitment(c)}
                          className="text-muted-foreground hover:text-primary transition-colors p-1 rounded"
                          title="Edit submission"
                          data-testid={`btn-edit-commitment-${c.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete submission from ${c.fullName}?`)) deleteCommitment.mutate(c.id);
                          }}
                          className="text-muted-foreground hover:text-red-400 transition-colors p-1 rounded"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground pt-1">
                    Showing {filtered.length} of {commitments.length} submissions
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stats Tab */}
        {activeTab === "stats" && (
          <Card className="bg-card border-card-border">
            <CardHeader>
              <CardTitle className="text-xl">Key Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {statsLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : (
                <>
                  <div className="grid sm:grid-cols-3 gap-4">
                    <div className="bg-background/50 border border-border rounded-lg p-4 space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Committed Households</p>
                      <p className="text-2xl font-bold">{stats?.committedHouseholds ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">Live from database</p>
                    </div>
                    <div className="bg-background/50 border border-border rounded-lg p-4 space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly Income</p>
                      <p className="text-2xl font-bold">R{stats?.monthlyContributions?.toLocaleString() ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">Monthly commitments × R250</p>
                    </div>
                    <div className="bg-background/50 border border-border rounded-lg p-4 space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Phase 1 Funding</p>
                      <p className="text-2xl font-bold">{stats?.fundingPercent ?? "—"}%</p>
                      <p className="text-xs text-muted-foreground">Of {stats?.targetHouseholds ?? "—"} household target</p>
                    </div>
                  </div>

                  <div className="pt-2 space-y-3">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-sm font-semibold">Submissions breakdown</h3>
                      <span className="text-xs text-muted-foreground">Live from database</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div className="bg-background/50 border border-border rounded-lg p-3 space-y-1" data-testid="stat-total-submissions">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total submissions</p>
                        <p className="text-2xl font-bold">{commitments.length}</p>
                        <p className="text-[11px] text-muted-foreground">All rows in the database</p>
                      </div>
                      <div className="bg-background/50 border border-border rounded-lg p-3 space-y-1" data-testid="stat-monthly">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Monthly</p>
                        <p className="text-2xl font-bold text-blue-400">{monthlyCount}</p>
                        <p className="text-[11px] text-muted-foreground">R250 / month each</p>
                      </div>
                      <div className="bg-background/50 border border-border rounded-lg p-3 space-y-1" data-testid="stat-onceoff">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Once-off</p>
                        <p className="text-2xl font-bold text-primary">{onceOffCount}</p>
                        <p className="text-[11px] text-muted-foreground">R3,000 one-time</p>
                      </div>
                      <div className="bg-background/50 border border-border rounded-lg p-3 space-y-1" data-testid="stat-incomplete">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Incomplete</p>
                        <p className={`text-2xl font-bold ${incompleteRecords.length > 0 ? "text-amber-400" : ""}`}>
                          {incompleteLoading ? "…" : incompleteRecords.length}
                        </p>
                        <p className="text-[11px] text-muted-foreground">Missing name, phone or email</p>
                      </div>
                      <div className="bg-background/50 border border-border rounded-lg p-3 space-y-1 col-span-2 sm:col-span-1" data-testid="stat-duplicates">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Duplicates</p>
                        <p className={`text-2xl font-bold ${duplicateRowCount > 0 ? "text-red-400" : ""}`}>{duplicateRowCount}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {duplicateKeys.size > 0
                            ? `${duplicateRowCount} rows across ${duplicateKeys.size} ${duplicateKeys.size === 1 ? "group" : "groups"}`
                            : "Same name + street + house"}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 text-xs text-blue-200/90 leading-relaxed">
                      <p className="font-semibold text-blue-300 mb-1">Why the public count may differ from the admin total</p>
                      <p>
                        The homepage counter ("households committed") shows the same total submissions number from this database,
                        but visitors' browsers cache the homepage for a short time, so it can lag by a minute or two after new
                        submissions, CSV imports or deletions. It also counts every row — including any incomplete or duplicate
                        entries — so once you clean those up here the public number will drop to match. Refresh the homepage to
                        force an immediate update.
                      </p>
                    </div>
                  </div>

                  <div className="max-w-xs space-y-2">
                    <Label htmlFor="targetHouseholds">Target Households</Label>
                    <Input
                      id="targetHouseholds"
                      type="number"
                      min={1}
                      defaultValue={stats?.targetHouseholds}
                      key={`th-${stats?.targetHouseholds}`}
                      onChange={e => handleStatsChange("targetHouseholds", e.target.value)}
                      className="bg-background border-border"
                    />
                    <p className="text-xs text-muted-foreground">The number of households needed to fully fund the project. This updates the funding % shown on the homepage.</p>
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      onClick={() => updateStats.mutate(statsForm)}
                      disabled={updateStats.isPending || Object.keys(statsForm).length === 0}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {updateStats.isPending ? "Saving…" : "Save Target"}
                    </Button>
                    {statsSaved && (
                      <div className="flex items-center gap-1.5 text-green-400 text-sm">
                        <CheckCircle className="h-4 w-4" /> Saved!
                      </div>
                    )}
                    {updateStats.isError && (
                      <div className="flex items-center gap-1.5 text-red-400 text-sm">
                        <AlertTriangle className="h-4 w-4" /> Save failed
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Captains Tab */}
        {activeTab === "captains" && (
          <Card className="bg-card border-card-border">
            <CardHeader>
              <CardTitle className="text-xl">Street Captains</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Active captains appear on the homepage. Toggle a row's role to promote a pending volunteer or demote an active captain.
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => sendPinSetupEmails.mutate()} disabled={sendPinSetupEmails.isPending} data-testid="button-send-pin-setup-emails">{sendPinSetupEmails.isPending ? "Sending…" : "Email All Captains: Set Up PIN"}</Button>
              {pinSetupResult && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-pin-setup-result">{pinSetupResult}</p>
            )}
            </CardHeader>
            <CardContent>
              <div className="mb-4 space-y-2" data-testid="captain-filters">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="text"
                      value={captainSearch}
                      onChange={e => setCaptainSearch(e.target.value)}
                      placeholder="Search by name, street or phone..."
                      className="pl-9 pr-9 bg-background border-border"
                      data-testid="input-captain-search"
                    />
                    {captainSearch && (
                      <button
                        type="button"
                        onClick={() => setCaptainSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        title="Clear search"
                        aria-label="Clear search"
                      >
                        <span className="text-lg leading-none">×</span>
                      </button>
                    )}
                  </div>
                  <select
                    value={captainStatusFilter}
                    onChange={e => setCaptainStatusFilter(e.target.value as typeof captainStatusFilter)}
                    className="h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-56"
                    data-testid="select-captain-status-filter"
                  >
                    <option value="all">All statuses</option>
                    <option value="Active Captain">Active Captain</option>
                    <option value="Pending / New Volunteer">Pending / New Volunteer</option>
                    <option value="Unassigned">Unassigned</option>
                  </select>
                  {filtersActive && (
                    <Button
                      variant="outline"
                      onClick={() => { setCaptainSearch(""); setCaptainStatusFilter("all"); }}
                      className="h-10 gap-1.5"
                      data-testid="button-clear-captain-filters"
                    >
                      <span className="text-base leading-none">×</span> Clear
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground" data-testid="text-captain-result-count">
                  Showing {filteredCaptains.length} of {captains.length} captains
                </p>
              </div>
              {dupCount > 0 && (
                <div
                  className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-start gap-2"
                  data-testid="banner-duplicate-captains"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">{dupCount} duplicate {dupCount === 1 ? "entry" : "entries"} found</p>
                    <p className="text-xs text-red-300/80 mt-0.5">
                      Rows sharing a name or street with another row are highlighted in red. Co-captain streets will appear here too —
                      review each one and delete any genuine duplicates using the trash button.
                    </p>
                  </div>
                </div>
              )}
              {captainsLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
                    <div className="col-span-2">Street</div>
                    <div className="col-span-2">Captain</div>
                    <div className="col-span-2">Phone</div>
                    <div className="col-span-1">Target</div>
                    <div className="col-span-1">Activity</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-2"></div>
                  </div>
                  {filteredCaptains.length === 0 && (
                    <p className="text-sm text-muted-foreground px-4 py-6 text-center">
                      No captains match your filters.{" "}
                      <button
                        type="button"
                        onClick={() => { setCaptainSearch(""); setCaptainStatusFilter("all"); }}
                        className="underline hover:text-foreground"
                      >
                        Clear filters
                      </button>
                    </p>
                  )}
                  {filteredCaptains.map(c => {
                    const edit = captainEdits[c.id] ?? {};
                    const isDirty = Object.keys(edit).length > 0;
                    const isSaving = updateCaptain.isPending && updateCaptain.variables?.id === c.id;
                    const wasSaved = savedCaptains.has(c.id);
                    const isActive = c.captainStatus === "Active Captain";
                    const isToggling = toggleCaptainStatus.isPending && (toggleCaptainStatus.variables as { id: number } | undefined)?.id === c.id;
                    const isDup = dupCaptainIds.has(c.id);
                    return (
                      <div key={c.id} className={`grid grid-cols-12 gap-3 items-start p-4 rounded-lg bg-background/50 border transition-colors ${isDup ? "border-red-500/50 bg-red-500/5" : isActive ? "border-border" : "border-amber-500/20"}`} data-testid={`captain-row-${c.id}`}>
                        <div className="col-span-2 font-semibold text-sm pt-1">{c.street}</div>
                        <div className="col-span-2">
                          <Input
                            defaultValue={c.captain}
                            key={`cap-${c.id}-${c.captain}`}
                            onChange={e => handleCaptainChange(c.id, "captain", e.target.value)}
                            placeholder="Captain name"
                            className="bg-card border-border text-sm h-8"
                          />
                          {c.email && (
                            <p className="text-xs text-muted-foreground truncate mt-1">{c.email}</p>
                          )}
                          {!isActive && c.motivation && (
                            <p className="text-xs text-muted-foreground italic mt-1 leading-tight">{c.motivation}</p>
                          )}
                        </div>
                        <div className="col-span-2">
                          <Input
                            type="tel"
                            defaultValue={c.phone ?? ""}
                            key={`phone-${c.id}-${c.phone ?? ""}`}
                            onChange={e => handleCaptainChange(c.id, "phone", e.target.value)}
                            placeholder=""
                            className="bg-card border-border text-sm h-8"
                          />
                        </div>
                        <div className="col-span-1">
                          <Input
                            type="number"
                            min={0}
                            defaultValue={c.targetHouseholds ?? 30}
                            key={`target-${c.id}-${c.targetHouseholds ?? 30}`}
                            onChange={e => handleCaptainChange(c.id, "targetHouseholds", parseInt(e.target.value, 10) || 0)}
                            className="bg-card border-border text-sm h-8 text-center"
                            title="Target households for this street"
                          />
                        </div>
                        <div className="col-span-1">
                          {(() => {
                            const target = (edit.targetHouseholds ?? c.targetHouseholds) ?? 30;
                            const committed = c.forms ?? 0;
                            const computed = computeStreetStatus(committed, target);
                            return (
                              <div
                                className={`w-full h-8 rounded-md border text-xs font-medium px-2 flex items-center justify-center ${getStreetStatusClass(computed)}`}
                                title={`Auto-calculated from ${committed} of ${target} households (${target > 0 ? Math.round((committed / target) * 100) : 0}%)`}
                                data-testid={`badge-captain-status-${c.id}`}
                              >
                                {computed}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="col-span-2 flex flex-col items-start gap-1.5 pt-0.5">
                          <button
                            onClick={() => toggleCaptainStatus.mutate({
                              id: c.id,
                              captainStatus: isActive ? "Pending / New Volunteer" : "Active Captain",
                            })}
                            disabled={isToggling}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                              isActive
                                ? "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30"
                                : "bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30"
                            }`}
                          >
                            {isToggling ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                            {isActive ? "Active Captain" : "Pending / New Volunteer"}
                          </button>
                          {isActive && c.captain && c.captain.trim().toLowerCase() !== "unassigned" && (() => {
                            const welcomed = !!c.welcomedAt;
                            const msg = buildCaptainWelcomeMsg(c.captain, c.street, c.phone ?? "", c.pin, adminWhatsapp);
                            const url = c.phone ? makeResidentWaUrl(c.phone, msg) : null;
                            if (!url) {
                              return (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border bg-amber-500/10 text-amber-400 border-amber-500/30"
                                  title="Add a phone number to this captain to send the welcome message"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  No phone — add one before sending welcome
                                </span>
                              );
                            }
                            return (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => markWelcomed.mutate(c.id)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors ${
                                  welcomed
                                    ? "text-blue-400 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20"
                                    : "text-green-400 bg-green-500/10 border-green-500/20 hover:bg-green-500/20"
                                }`}
                                title={welcomed ? `Welcomed ${new Date(c.welcomedAt!).toLocaleDateString()}` : "Send welcome WhatsApp"}
                              >
                                <MessageSquare className="h-3 w-3" />
                                {welcomed ? "Resend Welcome" : "Send Welcome"}
                              </a>
                            );
                          })()}
                        </div>
                        <div className="col-span-2 flex items-center gap-2 pt-0.5">
                          <Button
                            size="sm"
                            onClick={() => { if (captainEdits[c.id]) updateCaptain.mutate({ id: c.id, data: captainEdits[c.id] }); }}
                            disabled={!isDirty || isSaving}
                            className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            {isSaving ? "…" : <Save className="h-3 w-3" />}
                          </Button>
                          {wasSaved && <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />}
                          {isDirty && !wasSaved && (
                            <Badge className="text-xs shrink-0 bg-amber-500/20 text-amber-400 border-amber-500/30" variant="secondary">
                              Unsaved
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0 text-red-400 border-red-400/30 hover:bg-red-500/10 ml-auto"
                            disabled={deleteCaptain.isPending}
                            onClick={() => {
                              if (confirm(`Delete ${c.captain || "this captain"} from ${c.street}? This cannot be undone.`)) {
                                deleteCaptain.mutate(c.id);
                              }
                            }}
                            title="Delete captain"
                            data-testid={`delete-captain-${c.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground pt-2">
                    Click the role badge to toggle a captain's status instantly. Click <Save className="inline h-3 w-3" /> to save name/forms/status edits.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {/* Manage Captains Tab */}
        {activeTab === "manage-captains" && (
          <Card className="bg-card border-card-border">
            <CardHeader>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-xl">Manage Captains</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Assign residents as street captains. A captain can cover multiple streets. Assigning here also wires up their Captain Portal login.
                  </p>
                </div>
                <Button onClick={openAssignModal} className="gap-1.5" data-testid="button-assign-captain">
                  <UserPlus className="h-4 w-4" /> Assign Captain
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {assignmentsLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : captainAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-8 text-center">
                  No captain assignments yet. Click <span className="font-medium text-foreground">Assign Captain</span> to add one.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
                    <div className="col-span-2">Name</div>
                    <div className="col-span-3">Street(s)</div>
                    <div className="col-span-2">Phone</div>
                    <div className="col-span-2">Email</div>
                    <div className="col-span-1">PIN</div>
                    <div className="col-span-2 text-right">Actions</div>
                  </div>
                  {captainAssignments.map(row => {
                    const isRemoving = removeAssignment.isPending && removeAssignment.variables === row.residentId;
                    return (
                      <div
                        key={row.residentId}
                        className="grid grid-cols-12 gap-3 items-center p-4 rounded-lg bg-background/50 border border-border"
                        data-testid={`assignment-row-${row.residentId}`}
                      >
                        <div className="col-span-2 font-semibold text-sm">{row.fullName}</div>
                        <div className="col-span-3 text-sm">{row.streets.join(", ")}</div>
                        <div className="col-span-2 text-sm text-muted-foreground">{row.phone || "—"}</div>
                        <div className="col-span-2 text-sm text-muted-foreground truncate" title={row.email}>{row.email || "—"}</div>
                        <div className="col-span-1">
                          {row.pinSet ? (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs" variant="outline">PIN set</Badge>
                          ) : (
                            <Badge className="bg-muted text-muted-foreground border-border text-xs" variant="outline">No PIN</Badge>
                          )}
                        </div>
                        <div className="col-span-2 flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1"
                            onClick={() => openEditAssignment(row)}
                            data-testid={`button-edit-assignment-${row.residentId}`}
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                            disabled={isRemoving}
                            onClick={() => {
                              if (window.confirm(`Remove ${row.fullName} as captain for ${row.streets.join(", ")}? This deactivates the assignment (it is not deleted).`)) {
                                removeAssignment.mutate(row.residentId);
                              }
                            }}
                            data-testid={`button-remove-assignment-${row.residentId}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {/* Incomplete Records Tab */}
        {activeTab === "incomplete" && (
          <Card className="bg-card border-card-border">
            <CardHeader>
              <CardTitle className="text-xl">Incomplete Records</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Commitments missing name, phone or email — plus captain profiles missing a phone number.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {incompleteLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : incompleteRecords.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <CheckCircle className="h-10 w-10 text-green-400/40 mx-auto" />
                  <p className="text-muted-foreground text-sm">No incomplete records — all submissions have complete details.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-3 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
                    <div className="col-span-3">Name</div>
                    <div className="col-span-2">Street / House</div>
                    <div className="col-span-2">Missing</div>
                    <div className="col-span-3">Contact on file</div>
                    <div className="col-span-2"></div>
                  </div>
                  {incompleteRecords.map(c => {
                    const isProfile = c.kind === "profile";
                    const isNoCaptain = c.kind === "no-captain";
                    const hasPhone = !!(c.phone && c.phone !== "-");
                    const hasEmail = !!(c.email && c.email !== "imported@kcea.local");
                    const token = c.updateToken ?? "";
                    const waUrl = !isProfile && !isNoCaptain && hasPhone && token ? makeIncompleteWaUrl(c.phone, c.fullName, c.street, c.id, token) : null;
                    const mailtoUrl = !isProfile && !isNoCaptain && !hasPhone && hasEmail && token
                      ? `mailto:${c.email}?subject=${encodeURIComponent("KCEA — please update your details")}&body=${encodeURIComponent(`Hi ${(c.fullName || "there").split(/\s+/)[0]}, we have your commitment on record${c.street ? ` for ${c.street}` : ""} but are missing some details. Please update your info here: ${makeUpdateLink(c.id, token)}`)}`
                      : null;
                    const borderColor = isNoCaptain ? "border-red-500/30 hover:border-red-500/40" : "border-amber-500/20 hover:border-amber-500/30";
                    return (
                      <div key={`${c.kind || "commitment"}-${c.id}`} className={`grid grid-cols-12 gap-3 items-center px-3 py-3 rounded-lg bg-background/50 border ${borderColor} transition-colors`}>
                        <div className="col-span-3">
                          <p className="font-medium text-sm">
                            {c.fullName || <span className="italic text-muted-foreground">No name</span>}
                            {isProfile && <Badge className="ml-2 bg-blue-500/15 text-blue-300 border-blue-400/30 text-[10px]" variant="outline">Captain profile</Badge>}
                            {isNoCaptain && <Badge className="ml-2 bg-red-500/15 text-red-300 border-red-400/30 text-[10px]" variant="outline">No captain</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {isProfile ? `Profile #${c.id}` : `#${c.id} · ${new Date(c.submittedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}`}
                          </p>
                        </div>
                        <div className="col-span-2">
                          {isProfile ? (
                            <p className="text-xs text-muted-foreground italic">—</p>
                          ) : (
                            <>
                              <p className="text-sm">{c.street}</p>
                              <p className="text-xs text-muted-foreground">No. {c.houseNumber}</p>
                            </>
                          )}
                        </div>
                        <div className="col-span-2">
                          <div className="flex flex-wrap gap-1">
                            {c.missingFields.map(f => (
                              <Badge key={f} className="bg-amber-500/20 text-amber-400 border-amber-500/20 text-xs" variant="outline">
                                {f}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="col-span-3 min-w-0">
                          {hasEmail ? (
                            <p className="text-xs truncate">{c.email}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No email</p>
                          )}
                          {hasPhone ? (
                            <p className="text-xs text-muted-foreground">{c.phone}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No phone</p>
                          )}
                          {!isProfile && !hasPhone && hasEmail && (
                            <p className="text-[10px] text-amber-400/80 italic mt-0.5">No phone — contact by email</p>
                          )}
                        </div>
                        <div className="col-span-2 flex justify-end">
                          {isProfile ? (
                            <span className="text-xs text-muted-foreground italic text-right">Enter phone in<br/>Captains tab</span>
                          ) : waUrl ? (
                            <a href={waUrl} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="outline" className="h-8 text-xs px-2 gap-1.5 border-green-500/40 text-green-400 hover:bg-green-500/10">
                                <ExternalLink className="h-3 w-3" />
                                WhatsApp
                              </Button>
                            </a>
                          ) : mailtoUrl ? (
                            <a href={mailtoUrl}>
                              <Button size="sm" variant="outline" className="h-8 text-xs px-2 gap-1.5 border-blue-500/40 text-blue-400 hover:bg-blue-500/10">
                                <ExternalLink className="h-3 w-3" />
                                Email
                              </Button>
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">No contact info</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground pt-1">{incompleteRecords.length} incomplete record{incompleteRecords.length !== 1 ? "s" : ""}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Captain Portal Management Tab */}
        {activeTab === "captain-mgmt" && (
          <div className="space-y-6">

            {/* Captain Profiles */}
            <Card className="bg-card border-card-border">
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
                <div>
                  <CardTitle className="text-xl">Captain Profiles</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Set phone numbers and PINs for each captain so they can log into the Captain Portal.</p>
                </div>
                <Button size="sm" variant="outline" className="gap-2 shrink-0" onClick={() => setShowAddProfile(p => !p)}>
                  <Users className="h-4 w-4" />
                  {showAddProfile ? "Cancel" : "Add Captain"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {showAddProfile && (
                  <div className="flex gap-2 items-end p-3 rounded-lg bg-background/50 border border-primary/30">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Name (must match street captain name exactly)</Label>
                      <Input value={newProfileName} onChange={e => setNewProfileName(e.target.value)} placeholder="e.g. Carina" className="bg-background border-border h-8 text-sm" />
                    </div>
                    <div className="w-40 space-y-1">
                      <Label className="text-xs">Phone</Label>
                      <Input value={newProfilePhone} onChange={e => setNewProfilePhone(e.target.value)} placeholder="e.g. 082 123 4567" className="bg-background border-border h-8 text-sm" />
                    </div>
                    <div className="w-48 space-y-1">
                      <Label className="text-xs">Email</Label>
                      <Input value={newProfileEmail} onChange={e => setNewProfileEmail(e.target.value)} placeholder="e.g. captain@example.com" className="bg-background border-border h-8 text-sm" />
                    </div>
                    <Button size="sm" className="h-8" disabled={!newProfileName.trim() || createCaptainProfile.isPending} onClick={() => createCaptainProfile.mutate({ name: newProfileName.trim(), phone: newProfilePhone.trim(), email: newProfileEmail.trim() })}>
                      {createCaptainProfile.isPending ? "Adding…" : "Add"}
                    </Button>
                  </div>
                )}

                {captainProfiles.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="text"
                      value={profileSearch}
                      onChange={e => setProfileSearch(e.target.value)}
                      placeholder="Search by captain name or street..."
                      className="pl-9 pr-9 bg-background border-border"
                      data-testid="input-profile-search"
                    />
                    {profileSearch && (
                      <button
                        type="button"
                        onClick={() => setProfileSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        title="Clear search"
                        aria-label="Clear search"
                      >
                        <span className="text-lg leading-none">×</span>
                      </button>
                    )}
                  </div>
                )}

                {captainProfiles.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <Key className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">Loading captain profiles…</p>
                  </div>
                ) : filteredProfiles.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <Search className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">No captains match "{profileSearch}".</p>
                    <button type="button" onClick={() => setProfileSearch("")} className="text-xs text-primary hover:underline">Clear search</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredProfiles.map(p => {
                      const streets = captains.filter(c => c.captain === p.name).map(c => c.street);
                      const isSaved = savedProfiles.has(p.id);
                      const isSettingPin = setPinLoading.has(p.id);
                      const pinResult = setPinResult[p.id];
                      return (
                        <div key={p.id} className="rounded-lg bg-background/50 border border-border p-4 space-y-3">
                          {/* Row 1: name, street, last login, delete */}
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-sm">{p.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{streets.length > 0 ? streets.join(", ") : "No streets assigned"}</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="text-right">
                                <p className="text-xs text-muted-foreground">Last login</p>
                                <p className="text-xs font-medium">
                                  {p.lastLoginAt
                                    ? new Date(p.lastLoginAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })
                                    : "Never"}
                                </p>
                              </div>
                              <button
                                onClick={() => { if (confirm(`Remove ${p.name} from the portal? They will no longer be able to log in.`)) deleteCaptainProfile.mutate(p.id); }}
                                className="text-muted-foreground hover:text-red-400 transition-colors p-1 rounded"
                                title="Delete captain"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          {/* Row 2: phone + PIN */}
                          <div className="flex items-end gap-3 flex-wrap">
                            <div className="flex-1 min-w-[180px] space-y-1">
                              <Label className="text-xs flex items-center gap-1"><Phone className="h-3 w-3" /> Phone number</Label>
                              <div className="flex gap-2">
                                <Input
                                  value={phoneEdits[p.id] ?? p.phone ?? ""}
                                  onChange={e => setPhoneEdits(prev => ({ ...prev, [p.id]: e.target.value }))}
                                  placeholder="e.g. 082 123 4567"
                                  className="bg-background border-border h-8 text-xs"
                                />
                                {isSaved ? (
                                  <span className="text-xs text-green-400 flex items-center gap-1 shrink-0"><CheckCircle className="h-3.5 w-3.5" /> Saved</span>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-xs px-2 gap-1 border-border shrink-0"
                                    disabled={updateCaptainProfile.isPending}
                                    onClick={() => {
                                      const phone = phoneEdits[p.id] !== undefined ? phoneEdits[p.id] : p.phone ?? "";
                                      updateCaptainProfile.mutate({ id: p.id, phone });
                                    }}
                                  >
                                    <Save className="h-3 w-3" /> Save
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div className="flex-1 min-w-[180px] space-y-1">
                              <Label className="text-xs flex items-center gap-1"><Mail className="h-3 w-3" /> Email</Label>
                              <div className="flex gap-2">
                                <Input
                                  value={emailEdits[p.id] ?? p.email ?? ""}
                                  onChange={e => setEmailEdits(prev => ({ ...prev, [p.id]: e.target.value }))}
                                  placeholder="e.g. captain@example.com"
                                  className="bg-background border-border h-8 text-xs"
                                />
                                {isSaved ? (
                                  <span className="text-xs text-green-400 flex items-center gap-1 shrink-0"><CheckCircle className="h-3.5 w-3.5" /> Saved</span>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-xs px-2 gap-1 border-border shrink-0"
                                    disabled={updateCaptainProfile.isPending}
                                    onClick={() => {
                                      const email = emailEdits[p.id] !== undefined ? emailEdits[p.id] : p.email ?? "";
                                      updateCaptainProfile.mutate({ id: p.id, email });
                                    }}
                                  >
                                    <Save className="h-3 w-3" /> Save
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs flex items-center gap-1"><Key className="h-3 w-3" /> Portal PIN</Label>
                              <div className="flex items-center gap-2">
                                {pinResult ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-lg font-bold text-primary tracking-[0.3em] bg-primary/10 px-3 py-1 rounded-md">{pinResult.pin}</span>
                                    {p.phone && (() => {
                                      const streets = streetsForCaptainName(p.name);
                                      if (streets.length === 0) return null;
                                      const multi = streets.length > 1;
                                      return streets.map(street => {
                                        const msg = buildCaptainWelcomeMsg(p.name, street, p.phone!, pinResult.pin, adminWhatsapp);
                                        const url = makeResidentWaUrl(p.phone!, msg);
                                        if (!url) return null;
                                        const sent = !!p.pinSentAt;
                                        const sentDate = sent ? new Date(p.pinSentAt!).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }) : null;
                                        return (
                                          <div key={street} className="flex flex-col items-start gap-0.5">
                                            <div className="flex items-center gap-1.5">
                                              {sent ? (
                                                <>
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground bg-muted/40 border border-border">
                                                    <CheckCircle className="h-3 w-3" />PIN Sent ✓
                                                  </span>
                                                  <a href={url} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => { if (e.button === 0) markPinSent.mutate(p.id); }} onClick={() => markPinSent.mutate(p.id)} className="text-xs text-primary hover:underline">
                                                    Resend{multi ? ` (${street})` : ""}
                                                  </a>
                                                </>
                                              ) : (
                                                <a href={url} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => { if (e.button === 0) markPinSent.mutate(p.id); }} onClick={() => markPinSent.mutate(p.id)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-green-400 bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors">
                                                  <MessageSquare className="h-3 w-3" />Send PIN{multi ? ` (${street})` : ""} via WhatsApp
                                                </a>
                                              )}
                                            </div>
                                            {sent && <span className="text-[10px] text-muted-foreground">Sent {sentDate}</span>}
                                          </div>
                                        );
                                      });
                                    })()}
                                  </div>
                                ) : p.pin ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-lg font-bold text-foreground tracking-[0.3em] bg-background border border-border px-3 py-1 rounded-md">{p.pin}</span>
                                    {p.phone && (() => {
                                      const streets = streetsForCaptainName(p.name);
                                      if (streets.length === 0) return null;
                                      const multi = streets.length > 1;
                                      return streets.map(street => {
                                        const msg = buildCaptainWelcomeMsg(p.name, street, p.phone!, p.pin, adminWhatsapp);
                                        const url = makeResidentWaUrl(p.phone!, msg);
                                        if (!url) return null;
                                        const sent = !!p.pinSentAt;
                                        const sentDate = sent ? new Date(p.pinSentAt!).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }) : null;
                                        return (
                                          <div key={street} className="flex flex-col items-start gap-0.5">
                                            <div className="flex items-center gap-1.5">
                                              {sent ? (
                                                <>
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground bg-muted/40 border border-border">
                                                    <CheckCircle className="h-3 w-3" />PIN Sent ✓
                                                  </span>
                                                  <a href={url} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => { if (e.button === 0) markPinSent.mutate(p.id); }} onClick={() => markPinSent.mutate(p.id)} className="text-xs text-primary hover:underline">
                                                    Resend{multi ? ` (${street})` : ""}
                                                  </a>
                                                </>
                                              ) : (
                                                <a href={url} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => { if (e.button === 0) markPinSent.mutate(p.id); }} onClick={() => markPinSent.mutate(p.id)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-green-400 bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors">
                                                  <MessageSquare className="h-3 w-3" />Send PIN{multi ? ` (${street})` : ""} via WhatsApp
                                                </a>
                                              )}
                                            </div>
                                            {sent && <span className="text-[10px] text-muted-foreground">Sent {sentDate}</span>}
                                          </div>
                                        );
                                      });
                                    })()}
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 text-xs px-2 gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                                      disabled={isSettingPin}
                                      onClick={() => handleSetPin(p.id)}
                                    >
                                      <RefreshCw className={`h-3 w-3 ${isSettingPin ? "animate-spin" : ""}`} />
                                      {isSettingPin ? "Resetting…" : "Reset PIN"}
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    className="h-8 text-xs px-3 gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                                    disabled={isSettingPin}
                                    onClick={() => handleSetPin(p.id)}
                                  >
                                    <Key className={`h-3 w-3 ${isSettingPin ? "animate-spin" : ""}`} />
                                    {isSettingPin ? "Setting PIN…" : "Set PIN"}
                                  </Button>
                                )}
                              </div>
                              {!pinResult && p.pin && (
                                <p className="text-xs text-muted-foreground">Reset generates a new random PIN. Use 'Send PIN via WhatsApp' to message the captain.</p>
                              )}
                              {!pinResult && !p.pin && (
                                <p className="text-xs text-muted-foreground">Generates a random 4-digit PIN. Use 'Send PIN via WhatsApp' to send it to the captain.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-xs text-muted-foreground pt-1">{captainProfiles.filter(p => p.pinHash).length} of {captainProfiles.length} captains have a PIN set</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Captain Notes */}
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">Captain Notes</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">All notes added by captains during their door-to-door visits.</p>
              </CardHeader>
              <CardContent>
                {captainNotes.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">No captain notes yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-12 gap-3 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
                      <div className="col-span-2">Street</div>
                      <div className="col-span-1">No.</div>
                      <div className="col-span-2">Captain</div>
                      <div className="col-span-6">Note</div>
                      <div className="col-span-1">Date</div>
                    </div>
                    {captainNotes.map(n => (
                      <div key={n.id} className="grid grid-cols-12 gap-3 items-start px-3 py-3 rounded-lg bg-background/50 border border-border">
                        <div className="col-span-2"><p className="text-sm">{n.street}</p></div>
                        <div className="col-span-1"><p className="text-sm text-muted-foreground">{n.houseNumber}</p></div>
                        <div className="col-span-2"><p className="text-xs text-muted-foreground">{n.captainName}</p></div>
                        <div className="col-span-6"><p className="text-xs leading-relaxed">{n.note}</p></div>
                        <div className="col-span-1">
                          <p className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(n.updatedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                          </p>
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground pt-1">{captainNotes.length} note{captainNotes.length !== 1 ? "s" : ""}</p>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        )}

        {/* Pledges Tab */}
        {activeTab === "pledges" && (
          <Card className="bg-card border-card-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
              <div>
                <CardTitle className="text-xl flex items-center gap-2"><Heart className="h-5 w-5 text-primary" /> Pledges</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Total pledged: <span className="font-bold text-primary">R{pledges.reduce((s, p) => s + p.amount, 0).toLocaleString("en-ZA")}</span>
                  {" · "}{pledges.length} pledge{pledges.length === 1 ? "" : "s"}
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {pledgesLoading ? (
                <p className="text-sm text-muted-foreground">Loading pledges...</p>
              ) : pledges.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No pledges yet. Share the pledge link with the community.</p>
              ) : (
                <div className="space-y-2">
                  {pledges.map(p => {
                    const phoneDigits = p.phone.replace(/[\s()\-+]/g, "");
                    const normalized = phoneDigits.startsWith("0") ? "27" + phoneDigits.slice(1) : phoneDigits;
                    const waUrl = /^\d{10,15}$/.test(normalized)
                      ? `https://wa.me/${normalized}?text=${encodeURIComponent(`Hi ${p.fullName.split(/\s+/)[0]}, thank you for your pledge of R${p.amount.toLocaleString("en-ZA")} to the KCEA project. We'll be in touch about payment details.`)}`
                      : null;
                    return (
                      <div key={p.id} className="rounded-lg border border-card-border p-4 space-y-2" data-testid={`pledge-row-${p.id}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold">{p.fullName}</span>
                              <Badge className="bg-primary/20 text-primary border-primary/20 text-xs" variant="outline">
                                R{p.amount.toLocaleString("en-ZA")}
                              </Badge>
                              {p.amountReceived > 0 && (
                                <Badge
                                  className={`text-xs ${p.amountReceived >= p.amount ? "bg-green-500/20 text-green-400 border-green-500/20" : "bg-amber-500/20 text-amber-400 border-amber-500/20"}`}
                                  variant="outline"
                                >
                                  Received R{p.amountReceived.toLocaleString("en-ZA")}
                                </Badge>
                              )}
                              {p.isResident ? (
                                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/20 text-xs" variant="outline">
                                  Resident — {p.street} {p.houseNumber}
                                </Badge>
                              ) : (
                                <Badge className="bg-muted text-muted-foreground border-transparent text-xs" variant="outline">Non-resident</Badge>
                              )}
                              {p.commitmentId && (
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/20 text-xs" variant="outline">
                                  Linked to commitment #{p.commitmentId}
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                              <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {p.phone}</span>
                              <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {p.email}</span>
                              <span>{new Date(p.createdAt).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}</span>
                            </div>
                            {p.message && (
                              <p className="text-xs text-muted-foreground italic pt-1">"{p.message}"</p>
                            )}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {waUrl && (
                              <Button asChild size="sm" variant="outline" className="gap-1.5">
                                <a href={waUrl} target="_blank" rel="noopener noreferrer" data-testid={`wa-pledge-${p.id}`}>
                                  <MessageSquare className="h-3.5 w-3.5" /> Thank
                                </a>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-400 border-red-400/30 hover:bg-red-500/10"
                              onClick={() => {
                                if (confirm(`Delete pledge from ${p.fullName} (R${p.amount.toLocaleString("en-ZA")})?`)) {
                                  deletePledge.mutate(p.id);
                                }
                              }}
                              data-testid={`delete-pledge-${p.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Invoices Tab */}
        {activeTab === "invoices" && (
          <Card className="bg-card border-card-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4 flex-wrap">
              <div>
                <CardTitle className="text-xl flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Invoices</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
                  {" · "}Outstanding: <span className="font-bold text-primary">
                    R{invoices.filter(i => i.status !== "cancelled" && i.status !== "draft").reduce((s, i) => s + Math.max(0, i.total - (i.amountPaid ?? 0)), 0).toLocaleString("en-ZA")}
                  </span>
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={openBulkInvoiceDialog} data-testid="bulk-invoice-button">
                  <FileText className="h-4 w-4" /> Generate monthly invoices
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={openOnceoffInvoiceDialog} data-testid="onceoff-invoice-button">
                  <FileText className="h-4 w-4" /> Invoice once-off signups
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowMultiMonth(true)} data-testid="multi-month-invoice-button">
                  <FileText className="h-4 w-4" /> Multi-month invoice
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={openSendAllDialog} data-testid="send-all-invoices-button">
                  <Mail className="h-4 w-4" /> Email all
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => setShowCreateInvoice(true)} data-testid="create-invoice-button">
                  <Plus className="h-4 w-4" /> New invoice
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, street, or invoice number..."
                    className="pl-8"
                    value={invoiceSearch}
                    onChange={e => setInvoiceSearch(e.target.value)}
                    data-testid="invoice-search"
                  />
                </div>
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={invoiceStatusFilter}
                  onChange={e => setInvoiceStatusFilter(e.target.value)}
                  data-testid="invoice-status-filter"
                >
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              {invoicesLoading ? (
                <p className="text-sm text-muted-foreground">Loading invoices...</p>
              ) : invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No invoices yet. Create the first one above.</p>
              ) : (
                <div className="space-y-2">
                  {invoices.map(inv => (
                    <div key={inv.id} className="rounded-lg border border-card-border p-4 space-y-2" data-testid={`invoice-row-${inv.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold">{inv.invoiceNumber}</span>
                            <span className="font-semibold">{inv.billToName}</span>
                            {inv.billToStreet && (
                              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/20 text-xs" variant="outline">
                                {inv.billToStreet} {inv.billToHouseNumber}
                              </Badge>
                            )}
                            <Badge className={`${invoiceStatusBadgeClass(inv.status)} text-xs`} variant="outline">
                              {inv.status}
                            </Badge>
                            {inv.emailSentAt && (
                              <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/20 text-xs gap-1" variant="outline">
                                <Mail className="h-3 w-3" /> Emailed
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                            <span>Invoiced {new Date(inv.invoiceDate).toLocaleDateString("en-ZA")}</span>
                            <span>Due {new Date(inv.dueDate).toLocaleDateString("en-ZA")}</span>
                            <span className="font-semibold text-foreground">R{inv.total.toLocaleString("en-ZA")}</span>
                            {!!inv.amountPaid && (
                              <span className="text-green-400">
                                Paid R{inv.amountPaid.toLocaleString("en-ZA")}
                                {inv.amountPaid < inv.total && ` · Balance R${(inv.total - inv.amountPaid).toLocaleString("en-ZA")}`}
                              </span>
                            )}
                            {inv.createdBy && <span>By {inv.createdBy}</span>}
                          </div>
                          {!!inv.payments?.length && (
                            <div className="space-y-1 pt-1">
                              {inv.payments.map(p => (
                                <div key={p.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>
                                    R{p.amount.toLocaleString("en-ZA")} · {p.method} · {new Date(p.paymentDate).toLocaleDateString("en-ZA")}
                                    {p.reference ? ` · ${p.reference}` : ""}
                                  </span>
                                  <button
                                    type="button"
                                    className="text-primary hover:underline disabled:opacity-50"
                                    onClick={() => {
                                      setReassigningPayment({ id: p.id, amount: p.amount, currentInvoiceId: inv.id, commitmentId: inv.commitmentId });
                                      setReassignTargetInvoiceId(null);
                                    }}
                                    data-testid={`reassign-payment-${p.id}`}
                                  >
                                    Reassign
                                  </button>
                                  <button
                                    type="button"
                                    className="text-red-400 hover:underline disabled:opacity-50"
                                    disabled={deletePayment.isPending}
                                    onClick={() => {
                                      if (window.confirm(`Undo this R${p.amount.toLocaleString("en-ZA")} payment?`)) {
                                        deletePayment.mutate(p.id);
                                      }
                                    }}
                                    data-testid={`undo-payment-${p.id}`}
                                  >
                                    Undo
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0 items-center flex-wrap">
                          {inv.status === "paid" || inv.status === "partial" ? (
                            <Badge className={`${invoiceStatusBadgeClass(inv.status)} text-xs`} variant="outline" title="Paid/partial is set automatically from recorded payments">
                              {inv.status}
                            </Badge>
                          ) : (
                            <select
                              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                              value={inv.status}
                              onChange={e => updateInvoiceStatus.mutate({ id: inv.id, status: e.target.value })}
                              data-testid={`invoice-status-select-${inv.id}`}
                            >
                              <option value="draft">Draft</option>
                              <option value="unpaid">Unpaid</option>
                              <option value="overdue">Overdue</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => openRecordPayment(inv)}
                            data-testid={`record-payment-${inv.id}`}
                          >
                            <CheckCircle className="h-3.5 w-3.5" /> Record payment
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={async () => {
                              const full = await fetch(`${BASE}/api/invoices/${inv.id}`, { headers: authHeaders }).then(r => r.json());
                              printInvoice(full);
                            }}
                            data-testid={`print-invoice-${inv.id}`}
                          >
                            <Printer className="h-3.5 w-3.5" /> Print
                          </Button>
                          <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={async () => {
                                    const email = window.prompt(`Send a test copy of ${inv.invoiceNumber} to which email address?`, "");
                                    if (!email || !email.trim()) return;
                                    try {
                                            const res = await fetch(`${BASE}/api/invoices/${inv.id}/send-test`, {
                                                      method: "POST",
                                                      headers: { ...authHeaders, "Content-Type": "application/json" },
                                                      body: JSON.stringify({ email: email.trim() }),
                                            });
                                            const data = await res.json().catch(() => ({}));
                                            if (!res.ok) {
                                                      alert(`Test send failed: ${data.error ?? res.status}`);
                                                      return;
                                            }
                                            alert(
                                                      data.pdfAttached
                                                        ? `Test email sent to ${email.trim()} with the PDF attached.`
                                                        : `Test email sent to ${email.trim()}, but the PDF failed to attach${data.pdfError ? `: ${data.pdfError}` : ""}. Sent as plain text instead.`,
                                                    );
                                    } catch (err) {
                                            alert(`Test send failed: ${(err as Error).message}`);
                                    }
                              }}
                              data-testid={`send-test-invoice-${inv.id}`}
                            >
                            <Mail className="h-3.5 w-3.5" /> Send test
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-red-400 hover:text-red-300"
                            onClick={() => {
                              if (window.confirm(`Delete invoice ${inv.invoiceNumber}? This can't be undone.`)) {
                                deleteInvoice.mutate(inv.id);
                              }
                            }}
                            disabled={deleteInvoice.isPending}
                            data-testid={`delete-invoice-${inv.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showBulkInvoice && (
          <Dialog open={showBulkInvoice} onOpenChange={setShowBulkInvoice}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Generate monthly invoices</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Every household committed to the monthly R250 (R150 for Earls Court) that hasn't already
                  been invoiced for the selected month. Uncheck anyone who shouldn't get one this round.
                </p>
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="bulk-month"
                      checked={bulkMonth === "current"}
                      onChange={() => setBulkMonth("current")}
                    />
                    This month
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="bulk-month"
                      checked={bulkMonth === "last"}
                      onChange={() => setBulkMonth("last")}
                    />
                    Last month (catch-up)
                  </label>
                </div>
                {bulkPreviewLoading ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Loading eligible households...</p>
                ) : bulkPreviewIsError ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 space-y-2">
                    <p className="text-sm font-semibold text-red-300">Couldn't load the preview</p>
                    <p className="text-xs text-red-200/90 break-words">{(bulkPreviewError as Error).message}</p>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetchBulkPreview()}>
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </Button>
                  </div>
                ) : !bulkPreviewData || bulkPreviewData.eligible.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Nothing to invoice — every monthly household already has an invoice for this month.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{bulkSelected.size} of {bulkPreviewData.eligible.length} selected</span>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-foreground"
                          onClick={() => setBulkSelected(new Set(bulkPreviewData.eligible.map(r => r.commitmentId)))}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-foreground"
                          onClick={() => setBulkSelected(new Set())}
                        >
                          Deselect all
                        </button>
                      </div>
                    </div>
                    <div className="max-h-80 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
                      {bulkPreviewData.eligible.map(row => (
                        <label
                          key={row.commitmentId}
                          className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-background/50 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={bulkSelected.has(row.commitmentId)}
                            onChange={() => toggleBulkSelected(row.commitmentId)}
                          />
                          <span className="flex-1">
                            {row.fullName} — {row.street} {row.houseNumber}
                          </span>
                          <span className="text-muted-foreground">R{row.rate}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {bulkResult && (
                  <p className="text-sm text-green-400">
                    Created {bulkResult.createdCount} invoice{bulkResult.createdCount === 1 ? "" : "s"}
                    {bulkResult.skippedCount > 0 ? ` (${bulkResult.skippedCount} skipped)` : ""}.
                  </p>
                )}
                {bulkGenerate.isError && (
                  <p className="text-sm text-red-400">{(bulkGenerate.error as Error).message}</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowBulkInvoice(false)}>Close</Button>
                <Button
                  disabled={bulkSelected.size === 0 || bulkGenerate.isPending}
                  onClick={() => bulkGenerate.mutate()}
                  data-testid="submit-bulk-generate"
                >
                  {bulkGenerate.isPending ? "Generating..." : `Generate ${bulkSelected.size || ""} invoice${bulkSelected.size === 1 ? "" : "s"}`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {showSendAllInvoices && (
          <Dialog open={showSendAllInvoices} onOpenChange={setShowSendAllInvoices}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Email all outstanding invoices</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Sends every invoice that hasn't been emailed yet to the address on file. Each invoice only
                  ever gets emailed once, so it's safe to run this again later for newly generated invoices.
                </p>
                {sendAllResult ? (
                  <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-4 space-y-1">
                    <p className="text-sm font-semibold text-teal-300">Done</p>
                    <p className="text-xs text-teal-200/90">{sendAllResult.sent} sent{sendAllResult.skippedNoEmail ? `, ${sendAllResult.skippedNoEmail} skipped (no email on file)` : ""}{sendAllResult.failed ? `, ${sendAllResult.failed} failed` : ""}.</p>
                    {!!sendAllResult.failureReasons?.length && (
                      <p className="text-xs text-teal-200/70">Failure reason(s): {sendAllResult.failureReasons.join(", ")}</p>
                    )}
                  </div>
                ) : sendAllInvoices.isPending ? (
                  <div className="rounded-lg border border-card-border p-4 space-y-1">
                    <p className="text-sm font-semibold">Sending — this runs in small batches, keep this open...</p>
                    <p className="text-xs text-muted-foreground">
                      {sendAllProgress?.sent ?? 0} sent so far
                      {sendAllProgress?.skippedNoEmail ? `, ${sendAllProgress.skippedNoEmail} skipped` : ""}
                      {sendAllProgress?.failed ? `, ${sendAllProgress.failed} failed` : ""}
                      {unsentData?.readyToSend ? ` of ${unsentData.readyToSend}` : ""}.
                    </p>
                  </div>
                ) : unsentLoading ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Checking what's ready to send...</p>
                ) : unsentIsError ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 space-y-2">
                    <p className="text-sm font-semibold text-red-300">Couldn't load the preview</p>
                    <p className="text-xs text-red-200/90 break-words">{(unsentError as Error).message}</p>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetchUnsent()}>
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border border-card-border p-3 space-y-1">
                      <p className="text-sm"><span className="font-bold text-primary">{unsentData?.readyToSend ?? 0}</span> invoice{unsentData?.readyToSend === 1 ? "" : "s"} ready to email</p>
                      {!!unsentData?.noEmailOnFile && (
                        <p className="text-xs text-muted-foreground">{unsentData.noEmailOnFile} more have no email on file — those stay unsent, you'll need to reach them another way</p>
                      )}
                    </div>
                    {unsentData && unsentData.preview.length > 0 && (
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {unsentData.preview.map(r => (
                          <div key={r.id} className="flex items-center justify-between text-xs border-b border-card-border pb-1.5">
                            <span className="font-mono">{r.invoiceNumber}</span>
                            <span className="truncate flex-1 mx-2">{r.billToName}</span>
                            <span className="text-muted-foreground truncate max-w-[140px]">{r.billToEmail}</span>
                          </div>
                        ))}
                        {unsentData.readyToSend > unsentData.preview.length && (
                          <p className="text-xs text-muted-foreground pt-1">+{unsentData.readyToSend - unsentData.preview.length} more</p>
                        )}
                      </div>
                    )}
                  </>
                )}
                {sendAllInvoices.isError && (
                  <p className="text-sm text-red-400">
                    {(sendAllInvoices.error as Error).message}
                    {sendAllProgress ? ` (${sendAllProgress.sent} did get sent before this — safe to try again for the rest.)` : ""}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowSendAllInvoices(false)}>Close</Button>
                {!sendAllResult && (
                  <Button
                    disabled={!unsentData?.readyToSend || sendAllInvoices.isPending}
                    onClick={() => sendAllInvoices.mutate()}
                    data-testid="submit-send-all-invoices"
                  >
                    {sendAllInvoices.isPending ? "Sending..." : `Email ${unsentData?.readyToSend || ""} invoice${unsentData?.readyToSend === 1 ? "" : "s"}`}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {showOnceoffInvoice && (
          <Dialog open={showOnceoffInvoice} onOpenChange={setShowOnceoffInvoice}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Invoice once-off signups</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Households that paid a once-off R3,000 instead of joining the monthly plan. Each gets exactly
                  one invoice, ever — marked paid automatically if we already have their payment confirmed, so
                  their account balance matches everyone else's.
                </p>
                {onceoffPreviewLoading ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Loading eligible households...</p>
                ) : onceoffPreviewIsError ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 space-y-2">
                    <p className="text-sm font-semibold text-red-300">Couldn't load the preview</p>
                    <p className="text-xs text-red-200/90 break-words">{(onceoffPreviewError as Error).message}</p>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetchOnceoffPreview()}>
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </Button>
                  </div>
                ) : !onceoffPreviewData || onceoffPreviewData.eligible.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Nothing to invoice — every once-off household already has an invoice on record.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{onceoffSelected.size} of {onceoffPreviewData.eligible.length} selected</span>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-foreground"
                          onClick={() => setOnceoffSelected(new Set(onceoffPreviewData.eligible.map(r => r.commitmentId)))}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-foreground"
                          onClick={() => setOnceoffSelected(new Set())}
                        >
                          Deselect all
                        </button>
                      </div>
                    </div>
                    <div className="max-h-80 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
                      {onceoffPreviewData.eligible.map(row => (
                        <label
                          key={row.commitmentId}
                          className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-background/50 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={onceoffSelected.has(row.commitmentId)}
                            onChange={() => toggleOnceoffSelected(row.commitmentId)}
                          />
                          <span className="flex-1">
                            {row.fullName} — {row.street} {row.houseNumber}
                          </span>
                          <span className="text-muted-foreground">
                            R{row.amount} {row.willBeMarkedPaid ? "· will mark paid" : "· unpaid"}
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {onceoffResult && (
                  <p className="text-sm text-green-400">
                    Created {onceoffResult.createdCount} invoice{onceoffResult.createdCount === 1 ? "" : "s"}
                    {onceoffResult.skippedCount > 0 ? ` (${onceoffResult.skippedCount} skipped)` : ""}.
                  </p>
                )}
                {onceoffGenerate.isError && (
                  <p className="text-sm text-red-400">{(onceoffGenerate.error as Error).message}</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowOnceoffInvoice(false)}>Close</Button>
                <Button
                  disabled={onceoffSelected.size === 0 || onceoffGenerate.isPending}
                  onClick={() => onceoffGenerate.mutate()}
                  data-testid="submit-onceoff-generate"
                >
                  {onceoffGenerate.isPending ? "Generating..." : `Generate ${onceoffSelected.size || ""} invoice${onceoffSelected.size === 1 ? "" : "s"}`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {showCreateInvoice && (
          <Dialog open={showCreateInvoice} onOpenChange={setShowCreateInvoice}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>New invoice</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Bill to (name)</Label>
                  <Input value={newInvoiceBillToName} onChange={e => setNewInvoiceBillToName(e.target.value)} data-testid="invoice-billto-name" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Street</Label>
                    <Input value={newInvoiceStreet} onChange={e => setNewInvoiceStreet(e.target.value)} data-testid="invoice-street" />
                  </div>
                  <div>
                    <Label>House number</Label>
                    <Input value={newInvoiceHouseNumber} onChange={e => setNewInvoiceHouseNumber(e.target.value)} data-testid="invoice-house-number" />
                  </div>
                </div>
                <div>
                  <Label>Email (optional)</Label>
                  <Input value={newInvoiceEmail} onChange={e => setNewInvoiceEmail(e.target.value)} data-testid="invoice-email" />
                </div>
                <div>
                  <Label>Due in (days)</Label>
                  <Input type="number" value={newInvoiceDueInDays} onChange={e => setNewInvoiceDueInDays(parseInt(e.target.value, 10) || 15)} data-testid="invoice-due-days" />
                </div>
                <div className="space-y-2">
                  <Label>Line items</Label>
                  {newInvoiceLineItems.map((li, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Input
                        className="flex-1"
                        placeholder="Description"
                        value={li.description}
                        onChange={e => {
                          const next = [...newInvoiceLineItems];
                          next[idx] = { ...next[idx], description: e.target.value };
                          setNewInvoiceLineItems(next);
                        }}
                      />
                      <Input
                        className="w-16"
                        type="number"
                        value={li.quantity}
                        onChange={e => {
                          const next = [...newInvoiceLineItems];
                          next[idx] = { ...next[idx], quantity: parseInt(e.target.value, 10) || 1 };
                          setNewInvoiceLineItems(next);
                        }}
                      />
                      <Input
                        className="w-24"
                        type="number"
                        placeholder="R"
                        value={li.unitAmount}
                        onChange={e => {
                          const next = [...newInvoiceLineItems];
                          next[idx] = { ...next[idx], unitAmount: parseInt(e.target.value, 10) || 0 };
                          setNewInvoiceLineItems(next);
                        }}
                      />
                      {newInvoiceLineItems.length > 1 && (
                        <Button size="sm" variant="outline" onClick={() => setNewInvoiceLineItems(newInvoiceLineItems.filter((_, i) => i !== idx))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => setNewInvoiceLineItems([...newInvoiceLineItems, { description: "", quantity: 1, unitAmount: 0 }])}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add line item
                  </Button>
                </div>
                <p className="text-right font-semibold">
                  Total: R{newInvoiceLineItems.reduce((s, li) => s + li.quantity * li.unitAmount, 0).toLocaleString("en-ZA")}
                </p>
                {createInvoice.isError && (
                  <p className="text-sm text-red-400">{(createInvoice.error as Error).message}</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateInvoice(false)}>Cancel</Button>
                <Button
                  disabled={!newInvoiceBillToName.trim() || newInvoiceLineItems.some(li => !li.description.trim()) || createInvoice.isPending}
                  onClick={() => createInvoice.mutate()}
                  data-testid="submit-create-invoice"
                >
                  {createInvoice.isPending ? "Creating..." : "Create invoice"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {showRecordPayment && recordPaymentInvoice && (
          <Dialog open={showRecordPayment} onOpenChange={setShowRecordPayment}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Record payment — {recordPaymentInvoice.invoiceNumber}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {recordPaymentInvoice.billToName} — Total R{recordPaymentInvoice.total.toLocaleString("en-ZA")}
                  {!!recordPaymentInvoice.amountPaid && `, already paid R${recordPaymentInvoice.amountPaid.toLocaleString("en-ZA")}`}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-amount">Amount (R)</Label>
                  <Input id="payment-amount" type="number" min="1" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} data-testid="payment-amount-input" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-date">Payment date</Label>
                  <Input id="payment-date" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} data-testid="payment-date-input" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-method">Method</Label>
                  <select
                    id="payment-method"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={paymentMethod}
                    onChange={e => setPaymentMethod(e.target.value)}
                  >
                    <option value="EFT">EFT</option>
                    <option value="Cash">Cash</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-reference">Reference</Label>
                  <Input id="payment-reference" value={paymentReference} onChange={e => setPaymentReference(e.target.value)} data-testid="payment-reference-input" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-notes">Notes (optional)</Label>
                  <Input id="payment-notes" value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} />
                </div>
                {recordPayment.isError && <p className="text-sm text-red-400">{(recordPayment.error as Error).message}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowRecordPayment(false)}>Cancel</Button>
                <Button
                  disabled={!paymentAmount || Number(paymentAmount) <= 0 || recordPayment.isPending}
                  onClick={() => recordPayment.mutate()}
                  data-testid="submit-record-payment"
                >
                  {recordPayment.isPending ? "Recording..." : "Record payment"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {reassigningPayment && (
          <Dialog open={!!reassigningPayment} onOpenChange={open => !open && setReassigningPayment(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Reassign payment — R{reassigningPayment.amount.toLocaleString("en-ZA")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Moves this payment to a different invoice for the same household. The amount, date, and reference stay the same — only which invoice it counts against changes.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="reassign-invoice">Move to invoice</Label>
                  <select
                    id="reassign-invoice"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={reassignTargetInvoiceId ?? ""}
                    onChange={e => setReassignTargetInvoiceId(e.target.value ? Number(e.target.value) : null)}
                    data-testid="reassign-invoice-select"
                  >
                    <option value="">Select an invoice...</option>
                    {reassignCandidates.map(inv => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} — R{inv.total.toLocaleString("en-ZA")} ({inv.status}){!!inv.amountPaid && `, paid R${inv.amountPaid.toLocaleString("en-ZA")}`}
                      </option>
                    ))}
                  </select>
                  {reassignCandidates.length === 0 && (
                    <p className="text-xs text-amber-400">This household has no other invoice yet — generate one first (e.g. Multi-month invoice) if this payment covers a different month.</p>
                  )}
                </div>
                {reassignPayment.isError && <p className="text-sm text-red-400">{(reassignPayment.error as Error).message}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReassigningPayment(null)}>Cancel</Button>
                <Button
                  disabled={!reassignTargetInvoiceId || reassignPayment.isPending}
                  onClick={() => reassignPayment.mutate()}
                  data-testid="submit-reassign-payment"
                >
                  {reassignPayment.isPending ? "Reassigning..." : "Reassign"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {showMultiMonth && (
          <Dialog open={showMultiMonth} onOpenChange={setShowMultiMonth}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Generate multi-month invoice</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  For a household paying several months up front in one invoice (e.g. a resident asking for 6 months at once) instead of the normal monthly cycle. Creates one invoice with one line item per month, and blocks the normal monthly run from also billing those months.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="mm-commitment-id">Commitment ID</Label>
                  <Input
                    id="mm-commitment-id"
                    type="number"
                    placeholder="e.g. 42 — find it via Submissions search"
                    value={multiMonthCommitmentId}
                    onChange={e => setMultiMonthCommitmentId(e.target.value)}
                    data-testid="mm-commitment-id-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mm-months">Number of months</Label>
                  <Input
                    id="mm-months"
                    type="number"
                    min={2}
                    max={24}
                    value={multiMonthCount}
                    onChange={e => setMultiMonthCount(Number(e.target.value))}
                    data-testid="mm-months-input"
                  />
                </div>
                {multiMonthGenerate.isError && <p className="text-sm text-red-400">{(multiMonthGenerate.error as Error).message}</p>}
                {multiMonthGenerate.isSuccess && <p className="text-sm text-green-400">Invoice created.</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowMultiMonth(false)}>Close</Button>
                <Button
                  disabled={!multiMonthCommitmentId || multiMonthCount < 2 || multiMonthGenerate.isPending}
                  onClick={() => multiMonthGenerate.mutate()}
                  data-testid="submit-multi-month"
                >
                  {multiMonthGenerate.isPending ? "Generating..." : "Generate invoice"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Bank Transactions Tab */}
        {activeTab === "bank-transactions" && (
          <Card className="bg-card border-card-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4 flex-wrap">
              <div>
                <CardTitle className="text-xl flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" /> Bank Transactions</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {bankTransactions.length} imported · <span className="font-bold text-amber-400">{unallocatedTxCount} unallocated</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={hideAllocatedTx} onChange={e => setHideAllocatedTx(e.target.checked)} />
                  Hide Allocated
                </label>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setShowTxImport(true); setTxImportCsvText(""); setTxImportResult(null); }} data-testid="bank-tx-import-button">
                  <Upload className="h-4 w-4" /> Import CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {bankTxLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : visibleBankTransactions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {bankTransactions.length === 0 ? "No transactions imported yet." : "Nothing unallocated — everything's been allocated."}
                </p>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1">
                  {visibleBankTransactions.map(tx => (
                    <div key={tx.id} className="rounded-lg border border-card-border p-3 flex items-center justify-between gap-3 flex-wrap" data-testid={`bank-tx-row-${tx.id}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">{new Date(tx.transactionDate).toLocaleDateString("en-ZA")}</span>
                          <span className="text-sm truncate">{tx.description}</span>
                          <span className="font-semibold text-sm">R{tx.amount.toLocaleString("en-ZA")}</span>
                        </div>
                        <div className="mt-1">
                          {tx.status === "allocated" && tx.commitment && (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/20 text-xs" variant="outline">
                              Allocated — {tx.commitment.fullName} ({tx.commitment.street} {tx.commitment.houseNumber})
                            </Badge>
                          )}
                          {tx.status === "allocated" && tx.pledge && (
                            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/20 text-xs" variant="outline">
                              Pledge — {tx.pledge.fullName} (R{tx.pledge.amountReceived.toLocaleString("en-ZA")} of R{tx.pledge.amount.toLocaleString("en-ZA")})
                            </Badge>
                          )}
                          {tx.status === "ignored" && (
                            <Badge className="bg-muted text-muted-foreground border-transparent text-xs" variant="outline">Ignored</Badge>
                          )}
                          {tx.status === "unallocated" && tx.suggestedCommitment && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/20 text-xs" variant="outline">
                              Suggested: {tx.suggestedCommitment.fullName} ({tx.suggestedCommitment.street} {tx.suggestedCommitment.houseNumber})
                            </Badge>
                          )}
                          {tx.status === "unallocated" && !tx.suggestedCommitment && (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/20 text-xs" variant="outline">No match found</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {tx.status === "unallocated" && (
                          <>
                            <Button size="sm" className="gap-1.5" onClick={() => openAllocate(tx)} data-testid={`allocate-tx-${tx.id}`}>
                              <Check className="h-3.5 w-3.5" /> Allocate
                            </Button>
                            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => txIgnoreMutation.mutate(tx.id)} disabled={txIgnoreMutation.isPending}>
                              <EyeOff className="h-3.5 w-3.5" /> Ignore
                            </Button>
                          </>
                        )}
                        {tx.status === "ignored" && (
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => txUnignoreMutation.mutate(tx.id)} disabled={txUnignoreMutation.isPending}>
                            Unignore
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showTxImport && (
          <Dialog open={showTxImport} onOpenChange={setShowTxImport}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import bank statement (CSV)</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Every credit row gets saved permanently. Confident matches with an open invoice are allocated automatically; everything else lands in the list below as unallocated, for you to allocate any time.
                </p>
                {!txImportResult && (
                  <>
                    <div className="flex items-center gap-3">
                      <input
                        type="file"
                        accept=".csv,text/csv,text/plain"
                        onChange={async e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const text = await file.text();
                          setTxImportCsvText(text);
                          e.target.value = "";
                        }}
                        className="text-xs file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-xs file:cursor-pointer"
                        data-testid="bank-tx-file-input"
                      />
                      {txImportCsvText && (
                        <span className="text-xs text-muted-foreground">{txImportCsvText.trim().split("\n").length} lines loaded</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">— or paste it directly —</p>
                    <textarea
                      className="w-full h-40 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                      placeholder="Date,Description,Amount&#10;2026-08-01,EFT Derby 12,250&#10;..."
                      value={txImportCsvText}
                      onChange={e => setTxImportCsvText(e.target.value)}
                      data-testid="bank-tx-csv-input"
                    />
                    {txImportMutation.isError && <p className="text-sm text-red-400">{(txImportMutation.error as Error).message}</p>}
                  </>
                )}
                {txImportResult && (
                  <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-4 space-y-1">
                    <p className="text-sm font-semibold text-teal-300">Done</p>
                    <p className="text-xs text-teal-200/90">
                      {txImportResult.inserted} new transaction{txImportResult.inserted === 1 ? "" : "s"} imported
                      {" · "}{txImportResult.autoAllocated} auto-allocated{" · "}{txImportResult.unallocated} need review
                      {txImportResult.skippedDuplicate > 0 ? ` · ${txImportResult.skippedDuplicate} already on file, skipped` : ""}.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowTxImport(false)}>Close</Button>
                {!txImportResult && (
                  <Button
                    disabled={!txImportCsvText.trim() || txImportMutation.isPending}
                    onClick={() => txImportMutation.mutate()}
                    data-testid="submit-bank-tx-import"
                  >
                    {txImportMutation.isPending ? "Importing..." : "Import"}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {allocatingTx && (
          <Dialog open={!!allocatingTx} onOpenChange={open => !open && setAllocatingTx(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Allocate — R{allocatingTx.amount.toLocaleString("en-ZA")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{allocatingTx.description}</p>

                <div className="flex gap-1 rounded-lg border border-border p-1 w-fit">
                  <button
                    type="button"
                    className={`px-3 py-1 rounded-md text-xs font-medium ${allocateMode === "invoice" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
                    onClick={() => setAllocateMode("invoice")}
                    data-testid="allocate-mode-invoice"
                  >
                    Invoice
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 rounded-md text-xs font-medium ${allocateMode === "pledge" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
                    onClick={() => setAllocateMode("pledge")}
                    data-testid="allocate-mode-pledge"
                  >
                    Pledge
                  </button>
                </div>

                {allocateMode === "invoice" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="allocate-search">Household</Label>
                      <Input
                        id="allocate-search"
                        placeholder="Search by name or street..."
                        value={allocateSearch}
                        onChange={e => { setAllocateSearch(e.target.value); setAllocateCommitmentId(null); setAllocateInvoiceId(null); }}
                        data-testid="allocate-search-input"
                      />
                      {allocateSearch.trim().length >= 2 && !allocateCommitmentId && (
                        <div className="max-h-40 overflow-y-auto border border-border rounded-lg">
                          {allocateMatches.length === 0 ? (
                            <p className="text-xs text-muted-foreground p-2">No matches</p>
                          ) : (
                            allocateMatches.map(c => (
                              <button
                                key={c.id}
                                type="button"
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-background/50"
                                onClick={() => { setAllocateCommitmentId(c.id); setAllocateSearch(`${c.fullName} — ${c.street} ${c.houseNumber}`); }}
                              >
                                {c.fullName} — {c.street} {c.houseNumber}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    {allocateCommitmentId && (
                      <div className="space-y-1.5">
                        <Label htmlFor="allocate-invoice">Invoice</Label>
                        <select
                          id="allocate-invoice"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={allocateInvoiceId ?? ""}
                          onChange={e => setAllocateInvoiceId(e.target.value ? Number(e.target.value) : null)}
                          data-testid="allocate-invoice-select"
                        >
                          <option value="">Select an invoice...</option>
                          {allocateInvoices.map(inv => (
                            <option key={inv.id} value={inv.id}>
                              {inv.invoiceNumber} — R{inv.total.toLocaleString("en-ZA")} ({inv.status})
                            </option>
                          ))}
                        </select>
                        {allocateInvoices.length === 0 && (
                          <p className="text-xs text-amber-400">No invoices on file for this household yet — generate one first (e.g. Multi-month invoice) if this payment covers more than the current month.</p>
                        )}
                      </div>
                    )}
                    {allocateMutation.isError && <p className="text-sm text-red-400">{(allocateMutation.error as Error).message}</p>}
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="pledge-search">Existing pledge</Label>
                      <Input
                        id="pledge-search"
                        placeholder="Search by name..."
                        value={pledgeSearch}
                        onChange={e => { setPledgeSearch(e.target.value); setPledgeSelectedId(null); }}
                        data-testid="pledge-search-input"
                      />
                      {pledgeSearch.trim().length >= 2 && !pledgeSelectedId && (
                        <div className="max-h-40 overflow-y-auto border border-border rounded-lg">
                          {pledgeMatches.length === 0 ? (
                            <p className="text-xs text-muted-foreground p-2">No matches</p>
                          ) : (
                            pledgeMatches.map(p => (
                              <button
                                key={p.id}
                                type="button"
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-background/50"
                                onClick={() => { setPledgeSelectedId(p.id); setPledgeSearch(p.fullName); }}
                              >
                                {p.fullName} — pledged R{p.amount.toLocaleString("en-ZA")}, received R{p.amountReceived.toLocaleString("en-ZA")}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    {!pledgeSelectedId && (
                      <div className="space-y-2 pt-1 border-t border-border">
                        <p className="text-xs text-muted-foreground pt-2">— or create a new pledge —</p>
                        <div className="space-y-1.5">
                          <Label htmlFor="pledge-new-name">Name</Label>
                          <Input id="pledge-new-name" value={pledgeNewName} onChange={e => setPledgeNewName(e.target.value)} data-testid="pledge-new-name-input" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="pledge-new-amount">Pledge amount (R) — how much they're pledging in total, not just this payment</Label>
                          <Input id="pledge-new-amount" type="number" value={pledgeNewAmount} onChange={e => setPledgeNewAmount(e.target.value)} data-testid="pledge-new-amount-input" />
                        </div>
                      </div>
                    )}
                    {allocatePledgeMutation.isError && <p className="text-sm text-red-400">{(allocatePledgeMutation.error as Error).message}</p>}
                  </>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAllocatingTx(null)}>Cancel</Button>
                {allocateMode === "invoice" ? (
                  <Button
                    disabled={!allocateCommitmentId || !allocateInvoiceId || allocateMutation.isPending}
                    onClick={() => allocateMutation.mutate()}
                    data-testid="submit-allocate"
                  >
                    {allocateMutation.isPending ? "Allocating..." : "Allocate"}
                  </Button>
                ) : (
                  <Button
                    disabled={(!pledgeSelectedId && !pledgeNewName.trim()) || allocatePledgeMutation.isPending}
                    onClick={() => allocatePledgeMutation.mutate()}
                    data-testid="submit-allocate-pledge"
                  >
                    {allocatePledgeMutation.isPending ? "Allocating..." : "Allocate to pledge"}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Expenses Tab */}
        {activeTab === "expenses" && (
          <Card className="bg-card border-card-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4 flex-wrap">
              <div>
                <CardTitle className="text-xl flex items-center gap-2"><Receipt className="h-5 w-5 text-primary" /> Expenses</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {expenses.length} expense{expenses.length === 1 ? "" : "s"} · Total: <span className="font-bold text-primary">R{(expensesData?.total ?? 0).toLocaleString("en-ZA")}</span>
                </p>
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => setShowAddExpense(true)} data-testid="add-expense-button">
                <Plus className="h-4 w-4" /> Add expense
              </Button>
            </CardHeader>
            <CardContent>
              {expensesLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : expenses.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No expenses recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {expenses.map(e => (
                    <div key={e.id} className="rounded-lg border border-card-border p-3 flex items-center justify-between gap-3 flex-wrap" data-testid={`expense-row-${e.id}`}>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{e.description}</span>
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/20 text-xs" variant="outline">{e.category}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(e.expenseDate).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
                          {e.reference ? ` · ${e.reference}` : ""}
                          {e.createdBy ? ` · By ${e.createdBy}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-semibold text-sm">R{e.amount.toLocaleString("en-ZA")}</span>
                        <button
                          onClick={() => { if (confirm(`Delete expense "${e.description}"?`)) deleteExpense.mutate(e.id); }}
                          className="text-muted-foreground hover:text-red-400 transition-colors p-1 rounded"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showAddExpense && (
          <Dialog open={showAddExpense} onOpenChange={setShowAddExpense}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add expense</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="expense-date">Date</Label>
                  <Input id="expense-date" type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-category">Category</Label>
                  <Input id="expense-category" placeholder="e.g. Bank fees, TIS deposit, Application fee" value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)} data-testid="expense-category-input" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-amount">Amount (R)</Label>
                  <Input id="expense-amount" type="number" min="1" value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} data-testid="expense-amount-input" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-description">Description</Label>
                  <Input id="expense-description" value={expenseDescription} onChange={e => setExpenseDescription(e.target.value)} data-testid="expense-description-input" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-reference">Reference (optional)</Label>
                  <Input id="expense-reference" value={expenseReference} onChange={e => setExpenseReference(e.target.value)} />
                </div>
                {createExpense.isError && <p className="text-sm text-red-400">{(createExpense.error as Error).message}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddExpense(false)}>Cancel</Button>
                <Button
                  disabled={!expenseCategory.trim() || !expenseAmount || Number(expenseAmount) <= 0 || !expenseDescription.trim() || createExpense.isPending}
                  onClick={() => createExpense.mutate()}
                  data-testid="submit-add-expense"
                >
                  {createExpense.isPending ? "Saving..." : "Add expense"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <div className="space-y-6">
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl flex items-center gap-2"><SettingsIcon className="h-5 w-5" /> Site Settings</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">Configuration values used across the admin and captain portals. Not visible on the public site.</p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="admin-whatsapp" className="text-sm flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" /> Admin WhatsApp Number
                  </Label>
                  <p className="text-xs text-muted-foreground">Used in WhatsApp messages sent from admin (e.g. "Questions? WhatsApp ..."). Local SA format or international, e.g. <span className="font-mono">0832355052</span> or <span className="font-mono">+27832355052</span>.</p>
                  <div className="flex gap-2">
                    <Input
                      id="admin-whatsapp"
                      value={whatsappEdit ?? storedWhatsapp}
                      onChange={e => setWhatsappEdit(e.target.value)}
                      placeholder="e.g. 0832355052"
                      className="bg-background border-border"
                    />
                    {whatsappSaved ? (
                      <span className="text-xs text-green-400 flex items-center gap-1 px-2"><CheckCircle className="h-4 w-4" /> Saved</span>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={updateSettings.isPending || whatsappEdit === null || whatsappEdit.trim() === storedWhatsapp}
                        onClick={() => updateSettings.mutate({ notifyWhatsapp: (whatsappEdit ?? "").trim() })}
                        className="gap-1 shrink-0"
                      >
                        <Save className="h-3.5 w-3.5" /> {updateSettings.isPending ? "Saving…" : "Save"}
                      </Button>
                    )}
                  </div>
                </div>

                {authRole === "primary" && (
                  <div className="pt-4 border-t border-border space-y-2">
                    <Label className="text-sm">Secondary admin account</Label>
                    <p className="text-xs text-muted-foreground">
                      A second admin login with full access. Username is set by the
                      <code className="mx-1 px-1 bg-background/60 rounded">ADMIN_USERNAME_2</code>
                      environment variable (default <code className="px-1 bg-background/60 rounded">kcea-admin2</code>).
                      Only the primary admin can change this password.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Username</Label>
                        <Input value={secondaryPwView?.username ?? "kcea-admin2"} readOnly className="bg-background/40 border-border font-mono text-sm" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Current password</Label>
                        <div className="flex gap-2">
                          <Input
                            value={secondaryPwView?.password ?? ""}
                            readOnly
                            type={showSecondaryPw ? "text" : "password"}
                            placeholder="••••••••"
                            className="bg-background/40 border-border font-mono text-sm"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-border whitespace-nowrap"
                            onClick={() => setShowSecondaryPw(s => !s)}
                          >
                            {showSecondaryPw ? "Hide" : "Show"}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="pt-2 space-y-2">
                      <Label htmlFor="secondary-new-pw" className="text-xs text-muted-foreground">Set new password (min 6 characters)</Label>
                      <div className="flex gap-2">
                        <Input
                          id="secondary-new-pw"
                          type="text"
                          value={secondaryPwEdit}
                          onChange={e => { setSecondaryPwEdit(e.target.value); setSecondaryPwSaved(false); setSecondaryPwError(""); }}
                          placeholder="New password for secondary admin"
                          className="bg-background border-border font-mono text-sm"
                        />
                        <Button
                          size="sm"
                          className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1 whitespace-nowrap"
                          disabled={secondaryPwEdit.trim().length < 6}
                          onClick={async () => {
                            setSecondaryPwError("");
                            setSecondaryPwSaved(false);
                            try {
                              const res = await fetch(`${BASE}/api/admin/secondary`, {
                                method: "PUT",
                                headers: { ...authHeaders, "Content-Type": "application/json" },
                                body: JSON.stringify({ password: secondaryPwEdit.trim() }),
                              });
                              if (!res.ok) {
                                const data = await res.json().catch(() => ({})) as { error?: string };
                                setSecondaryPwError(data.error ?? "Failed to update password.");
                                return;
                              }
                              const data = await res.json() as { username: string; password: string };
                              setSecondaryPwView({ username: data.username, password: data.password });
                              setSecondaryPwEdit("");
                              setSecondaryPwSaved(true);
                            } catch {
                              setSecondaryPwError("Could not reach the server.");
                            }
                          }}
                        >
                          <Save className="h-3.5 w-3.5" /> Update password
                        </Button>
                      </div>
                      {secondaryPwSaved && <p className="text-xs text-green-400">Secondary admin password updated.</p>}
                      {secondaryPwError && <p className="text-xs text-red-400">{secondaryPwError}</p>}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-border space-y-2">
                  <Label className="text-sm">Apply data fixes</Label>
                  <p className="text-xs text-muted-foreground">
                    One-time cleanup for this database: deletes placeholder commitments
                    (name "Imported"/empty, email/phone "Unknown"), updates Nile/Onyx/Panther/Orion/Mildura captains,
                    and initializes the WhatsApp number if empty. Safe to re-run.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => { setMigrateResult(null); runMigrate.mutate(); }}
                    disabled={runMigrate.isPending}
                    className="gap-1"
                  >
                    {runMigrate.isPending ? "Running…" : "Apply data fixes"}
                  </Button>
                  {migrateResult && (
                    <p className="text-xs text-green-400 pt-1">{migrateResult}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
          </>
          )}
          </div>
        </div>
      </main>

      {(() => {
        const wc = welcomeModalId != null ? captains.find(c => c.id === welcomeModalId) : null;
        const phoneDigits = (wc?.phone ?? "").replace(/[\s()\-+]/g, "");
        const normalized = phoneDigits.startsWith("0") ? "27" + phoneDigits.slice(1) : phoneDigits;
        const phoneOk = /^\d{10,15}$/.test(normalized);
        const pinOk = !!(wc?.pin && wc.pin.trim());
        const welcomeMsg = wc
          ? buildCaptainWelcomeMsg(wc.captain, wc.street, wc.phone ?? "", wc.pin, adminWhatsapp)
          : "";
        const waUrl = phoneOk ? `https://wa.me/${normalized}?text=${encodeURIComponent(welcomeMsg)}` : null;
        return (
          <Dialog open={welcomeModalId != null} onOpenChange={(o) => { if (!o) setWelcomeModalId(null); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-green-400" /> Welcome new Active Captain
                </DialogTitle>
              </DialogHeader>
              {wc && (
                <div className="space-y-4">
                  <div className="rounded-md bg-background/50 border border-border p-3 text-sm space-y-1">
                    <p><span className="text-muted-foreground">Captain:</span> <span className="font-semibold">{wc.captain}</span> — {wc.street}</p>
                    <p><span className="text-muted-foreground">Phone:</span> {wc.phone ? <span className="font-mono">{wc.phone}</span> : <span className="text-red-400">Missing</span>}</p>
                    <p><span className="text-muted-foreground">PIN:</span> {pinOk ? <span className="font-mono">{wc.pin}</span> : <span className="text-red-400">Not set</span>}</p>
                  </div>

                  {!phoneOk ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">
                      <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> No phone — add one before sending welcome</p>
                      <p className="text-xs text-amber-200/80 mt-1">Add a valid phone number to this captain row before sending.</p>
                    </div>
                  ) : (
                    <>
                      {!pinOk && (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
                          No PIN set yet — the message will say "Your PIN will be sent shortly". Set the PIN in the Captain Portal tab to include it.
                        </div>
                      )}
                      <div className="rounded-md border border-border bg-background/50 p-3 text-xs whitespace-pre-wrap leading-relaxed">
                        {welcomeMsg}
                      </div>
                    </>
                  )}
                </div>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setWelcomeModalId(null)} data-testid="button-welcome-close">Close</Button>
                {waUrl && (
                  <Button asChild className="bg-green-600 hover:bg-green-700 text-white gap-1.5">
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        if (wc) markWelcomed.mutate(wc.id);
                        setWelcomeModalId(null);
                      }}
                      data-testid="button-welcome-send"
                    >
                      <MessageSquare className="h-4 w-4" /> Send via WhatsApp
                    </a>
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      <Dialog open={!!editingCommitment} onOpenChange={(o) => { if (!o) setEditingCommitment(null); }}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Submission {editingCommitment ? `#${editingCommitment.id}` : ""}</DialogTitle>
          </DialogHeader>
          {editingCommitment && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label htmlFor="edit-name">Full name *</Label>
                  <Input
                    id="edit-name"
                    value={editForm.fullName ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))}
                    className="bg-background border-border"
                    data-testid="input-edit-name"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-street">Street *</Label>
                  <Input
                    id="edit-street"
                    value={editForm.street ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, street: e.target.value }))}
                    className="bg-background border-border"
                    data-testid="input-edit-street"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-house">House number</Label>
                  <Input
                    id="edit-house"
                    value={editForm.houseNumber ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, houseNumber: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editForm.email ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-phone">Phone / contact</Label>
                  <Input
                    id="edit-phone"
                    value={editForm.phone ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-type">Payment type</Label>
                  <select
                    id="edit-type"
                    value={editForm.commitmentType ?? "monthly"}
                    onChange={e => setEditForm(f => ({ ...f, commitmentType: e.target.value }))}
                    className="w-full h-10 rounded-md bg-background border border-border px-3 text-sm"
                  >
                    <option value="monthly">Monthly (R250/mo)</option>
                    <option value="onceoff">Once-off (R3,000)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-date">Date</Label>
                  <Input
                    id="edit-date"
                    type="datetime-local"
                    value={editForm.submittedAt ? new Date(editForm.submittedAt).toISOString().slice(0, 16) : ""}
                    onChange={e => setEditForm(f => ({ ...f, submittedAt: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Status</Label>
                  <div className="flex flex-wrap gap-4 pt-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!editForm.imported}
                        onChange={e => setEditForm(f => ({ ...f, imported: e.target.checked }))}
                      />
                      Imported
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!editForm.paymentConfirmed}
                        onChange={e => setEditForm(f => ({ ...f, paymentConfirmed: e.target.checked }))}
                      />
                      Payment confirmed (verified)
                    </label>
                  </div>
                </div>
              </div>
              {editError && (
                <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> {editError}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCommitment(null)} disabled={updateCommitment.isPending}>
              Cancel
            </Button>
            <Button
              onClick={saveEditCommitment}
              disabled={updateCommitment.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              data-testid="btn-save-edit-commitment"
            >
              <Save className="h-4 w-4" />
              {updateCommitment.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign / Edit Captain Modal */}
      <Dialog open={assignModalOpen} onOpenChange={(o) => { if (!o) setAssignModalOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAssignment ? "Edit Captain Assignment" : "Assign Captain"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Resident picker */}
            <div className="space-y-1.5">
              <Label>Resident</Label>
              {selectedResident ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                  <div className="text-sm">
                    <span className="font-medium">{selectedResident.fullName}</span>
                    <span className="text-muted-foreground"> — {selectedResident.street} No. {selectedResident.houseNumber}</span>
                  </div>
                  {!editingAssignment && (
                    <button
                      type="button"
                      onClick={() => { setAssignResidentId(null); setAssignResidentSearch(""); }}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Clear resident"
                      data-testid="button-clear-resident"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    type="text"
                    value={assignResidentSearch}
                    onChange={e => setAssignResidentSearch(e.target.value)}
                    placeholder="Search resident by name or street…"
                    className="pl-9 bg-background border-border"
                    data-testid="input-resident-search"
                  />
                  {assignResidentSearch.trim() !== "" && (
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background">
                      {residentSearchResults.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">No residents found.</p>
                      ) : (
                        residentSearchResults.map(r => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setAssignResidentId(r.id);
                              setAssignResidentSearch(r.fullName);
                              if (!assignPhone.trim()) setAssignPhone(r.phone ?? "");
                            }}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
                            data-testid={`resident-option-${r.id}`}
                          >
                            <span className="font-medium">{r.fullName}</span>
                            <span className="text-muted-foreground"> — {r.street} No. {r.houseNumber}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Streets multi-select */}
            <div className="space-y-1.5">
              <Label>Street(s) — select one or more</Label>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background p-2 grid grid-cols-2 gap-1">
                {assignableStreets.map(street => {
                  const checked = assignStreets.includes(street);
                  return (
                    <label
                      key={street}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-muted/50"
                      data-testid={`street-option-${street}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignStreet(street)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <span className={checked ? "font-medium" : ""}>{street}</span>
                    </label>
                  );
                })}
              </div>
              {assignStreets.length > 0 && (
                <p className="text-xs text-muted-foreground">Selected: {assignStreets.slice().sort((a, b) => a.localeCompare(b)).join(", ")}</p>
              )}
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <Label htmlFor="assign-phone">Phone</Label>
              <Input
                id="assign-phone"
                type="tel"
                value={assignPhone}
                onChange={e => setAssignPhone(e.target.value)}
                placeholder="Captain's contact number"
                className="bg-background border-border"
                data-testid="input-assign-phone"
              />
              <p className="text-xs text-muted-foreground">Pre-filled from the resident's record. Used for their Captain Portal login.</p>
            </div>

            {assignError && (
              <p className="text-sm text-red-400" data-testid="text-assign-error">{assignError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignModalOpen(false)} data-testid="button-cancel-assign">Cancel</Button>
            <Button
              onClick={saveAssignment}
              disabled={assignCaptain.isPending || updateAssignment.isPending}
              data-testid="button-save-assign"
            >
              {assignCaptain.isPending || updateAssignment.isPending ? "Saving…" : editingAssignment ? "Save Changes" : "Assign Captain"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
