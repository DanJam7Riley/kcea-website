import { useState, useEffect } from "react";
import {
  Shield, LogOut, CheckCircle, XCircle, Plus, Save,
  MessageSquare, Home, ArrowLeft, Lock, Sparkles,
  ChevronDown, ChevronUp, Phone, Mail, Calendar, MapPin
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CommittedProperty {
  id: number;
  fullName: string;
  street: string;
  houseNumber: string;
  commitmentType: string;
  paymentConfirmed: boolean;
  phone: string;
  email: string;
  submittedAt: string;
}

function ContactDetails({ fullName, street, houseNumber, phone, email, submittedAt }: {
  fullName: string; street: string; houseNumber: string;
  phone: string; email: string; submittedAt: string;
}) {
  const phoneTrim = (phone ?? "").trim();
  const emailTrim = (email ?? "").trim();
  const dateStr = submittedAt
    ? new Date(submittedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
  return (
    <div className="mt-2 pt-2 border-t border-border/40 space-y-1.5 text-xs">
      <div className="flex items-center gap-2"><MapPin className="h-3 w-3 text-muted-foreground shrink-0" /><span className="font-medium">{fullName}</span><span className="text-muted-foreground">— {street} No. {houseNumber}</span></div>
      <div className="flex items-center gap-2"><Phone className="h-3 w-3 text-muted-foreground shrink-0" />{phoneTrim ? <span className="break-all">{phoneTrim}</span> : <span className="text-red-400 font-medium">Missing</span>}</div>
      <div className="flex items-center gap-2"><Mail className="h-3 w-3 text-muted-foreground shrink-0" />{emailTrim ? <span className="break-all">{emailTrim}</span> : <span className="text-red-400 font-medium">Missing</span>}</div>
      <div className="flex items-center gap-2"><Calendar className="h-3 w-3 text-muted-foreground shrink-0" /><span className="text-muted-foreground">Submitted {dateStr}</span></div>
      <p className="text-[10px] text-muted-foreground italic pt-0.5">View only. Contact admin to correct any details.</p>
    </div>
  );
}

interface NewSubmission {
  id: number;
  fullName: string;
  street: string;
  houseNumber: string;
  commitmentType: string;
  phone: string;
  email: string;
  submittedAt: string;
}

interface HouseRecord {
  id: number;
  street: string;
  houseNumber: string;
}

interface NoteRecord {
  id: number;
  street: string;
  houseNumber: string;
  note: string;
  updatedAt: string;
}

interface ContactedResident {
  commitmentId: number;
  contactedAt: string;
}

interface MissingContact {
  id: number;
  fullName: string;
  street: string;
  houseNumber: string;
  missingPhone: boolean;
  missingEmail: boolean;
}

interface DashboardData {
  captainName: string;
  streets: string[];
  committed: CommittedProperty[];
  notCommitted: HouseRecord[];
  notes: NoteRecord[];
  newSubmissions: NewSubmission[];
  contactedResidents: ContactedResident[];
  targetByStreet: Record<string, number>;
  targetHouseholds: number;
  missingContactInfo: MissingContact[];
}

function makeWaUrl(phone: string, message: string): string | null {
  const digits = phone.replace(/[\s()\-+]/g, "");
  if (!digits || digits.length < 7) return null;
  const normalized = digits.startsWith("0") ? "27" + digits.slice(1) : digits;
  if (!/^\d{10,15}$/.test(normalized)) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

interface PropertyNoteFieldProps {
  street: string;
  houseNumber: string;
  noteEdits: Record<string, string>;
  expandedNotes: Set<string>;
  savingNotes: Set<string>;
  onToggle: (key: string) => void;
  onChange: (key: string, val: string) => void;
  onSave: (street: string, houseNumber: string) => void;
}

function PropertyNoteField({
  street, houseNumber, noteEdits, expandedNotes, savingNotes, onToggle, onChange, onSave
}: PropertyNoteFieldProps) {
  const key = `${street}|${houseNumber}`;
  const currentText = noteEdits[key] ?? "";
  const isExpanded = expandedNotes.has(key);
  const isSaving = savingNotes.has(key);

  if (isExpanded) {
    return (
      <div className="mt-2 space-y-2">
        <Textarea
          value={currentText}
          onChange={e => onChange(key, e.target.value)}
          placeholder="e.g. 'Spoke to owner, will pay end of month' or 'Tenant only, owner uncontactable'"
          className="bg-background border-border text-xs resize-none h-16"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="text-xs h-7 gap-1"
            onClick={() => onSave(street, houseNumber)}
            disabled={isSaving}
          >
            <Save className="h-3 w-3" />
            {isSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7"
            onClick={() => onToggle(key)}
            disabled={isSaving}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => onToggle(key)}
      className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors max-w-full"
    >
      <MessageSquare className="h-3 w-3 shrink-0" />
      {currentText
        ? <span className="truncate">{currentText}</span>
        : <span className="italic">Add note</span>}
    </button>
  );
}

export default function CaptainPortal() {
  const [token, setToken] = useState(() => localStorage.getItem("kcea_captain_token") ?? "");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(false);

  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const toggleDetails = (key: string) => setExpandedDetails(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});
  const [savingNotes, setSavingNotes] = useState<Set<string>>(new Set());

  const [newHouseStreet, setNewHouseStreet] = useState("");
  const [newHouseNum, setNewHouseNum] = useState("");
  const [addingHouse, setAddingHouse] = useState(false);

  const fetchDashboard = async (t: string) => {
    setDashLoading(true);
    try {
      const res = await fetch(`${BASE}/api/captain/dashboard`, {
        headers: { "x-captain-token": t },
      });
      if (res.status === 401) {
        localStorage.removeItem("kcea_captain_token");
        setToken("");
        setDashboard(null);
        return;
      }
      const data = await res.json() as DashboardData;
      setDashboard(data);
      const edits: Record<string, string> = {};
      for (const n of data.notes ?? []) {
        edits[`${n.street}|${n.houseNumber}`] = n.note;
      }
      setNoteEdits(edits);
      if (data.streets.length === 1) setNewHouseStreet(data.streets[0]);
    } catch {
      // silently ignore
    } finally {
      setDashLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchDashboard(token);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const res = await fetch(`${BASE}/api/captain/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.replace(/\s/g, ""), pin }),
      });
      const data = await res.json() as { token?: string; error?: string };
      if (!res.ok) {
        setLoginError(data.error ?? "Login failed");
        return;
      }
      const tk = data.token!;
      localStorage.setItem("kcea_captain_token", tk);
      setToken(tk);
      await fetchDashboard(tk);
    } catch {
      setLoginError("Unable to connect. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${BASE}/api/captain/session`, {
        method: "DELETE",
        headers: { "x-captain-token": token },
      });
    } catch {}
    localStorage.removeItem("kcea_captain_token");
    setToken("");
    setDashboard(null);
  };

  const handleContactResident = async (commitmentId: number) => {
    try {
      const res = await fetch(`${BASE}/api/captain/contact-resident`, {
        method: "POST",
        headers: { "x-captain-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ commitmentId }),
      });
      if (!res.ok) return;
      const data = await res.json() as { commitmentId: number; contactedAt: string };
      setDashboard(prev => {
        if (!prev) return prev;
        const existing = prev.contactedResidents ?? [];
        const others = existing.filter(c => c.commitmentId !== data.commitmentId);
        return { ...prev, contactedResidents: [...others, { commitmentId: data.commitmentId, contactedAt: data.contactedAt }] };
      });
    } catch {
      // silently ignore — WhatsApp link still opens regardless
    }
  };

  const toggleNote = (key: string) => {
    setExpandedNotes(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  const changeNote = (key: string, val: string) => {
    setNoteEdits(prev => ({ ...prev, [key]: val }));
  };

  const handleSaveNote = async (street: string, houseNumber: string) => {
    const key = `${street}|${houseNumber}`;
    const note = noteEdits[key] ?? "";
    setSavingNotes(prev => new Set([...prev, key]));
    try {
      await fetch(`${BASE}/api/captain/notes`, {
        method: "POST",
        headers: { "x-captain-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ street, houseNumber, note }),
      });
      setExpandedNotes(prev => { const n = new Set(prev); n.delete(key); return n; });
    } catch {}
    setSavingNotes(prev => { const n = new Set(prev); n.delete(key); return n; });
  };

  const handleAddHouse = async (e: React.FormEvent) => {
    e.preventDefault();
    const street = newHouseStreet || dashboard?.streets[0] || "";
    if (!street || !newHouseNum.trim()) return;
    setAddingHouse(true);
    try {
      await fetch(`${BASE}/api/captain/houses`, {
        method: "POST",
        headers: { "x-captain-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ street, houseNumber: newHouseNum.trim() }),
      });
      setNewHouseNum("");
      await fetchDashboard(token);
    } catch {}
    setAddingHouse(false);
  };

  const noteProps = { noteEdits, expandedNotes, savingNotes, onToggle: toggleNote, onChange: changeNote, onSave: handleSaveNote };

  // ── LOGIN SCREEN ──────────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b border-border bg-background/95 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-lg">
            <img src={`${BASE}/kcea-logo.png`} alt="KCEA" className="h-7 w-auto" />
          </div>
          <a href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back to site
          </a>
        </header>

        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm bg-card border-border">
            <CardHeader className="text-center pb-2">
              <div className="h-14 w-14 bg-primary/20 rounded-full flex items-center justify-center text-primary mx-auto mb-3">
                <Lock className="h-7 w-7" />
              </div>
              <CardTitle className="text-2xl">Captain Portal</CardTitle>
              <p className="text-muted-foreground text-sm mt-1">
                Sign in with your registered phone number and PIN
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+27 82 123 4567"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    required
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pin">4-Digit PIN</Label>
                  <Input
                    id="pin"
                    type="password"
                    placeholder="••••"
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    required
                    maxLength={4}
                    inputMode="numeric"
                    className="bg-background border-border tracking-[0.5em] text-center text-lg"
                  />
                </div>
                {loginError && (
                  <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <XCircle className="h-4 w-4 shrink-0" />
                    {loginError}
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground"
                  disabled={loginLoading || pin.length < 4}
                >
                  {loginLoading ? "Signing in…" : "Sign In"}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground text-center mt-4">
                Contact the KCEA admin to set up your access.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── LOADING SCREEN ────────────────────────────────────────────
  if (dashLoading || !dashboard) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Shield className="h-10 w-10 text-primary animate-pulse mx-auto" />
          <p className="text-muted-foreground text-sm">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  // Total = per-street household targets (default 30 each). Falls back to registered houses
  // if the server didn't supply targets (older clients / new captain with no rows yet).
  const total = dashboard.targetHouseholds && dashboard.targetHouseholds > 0
    ? dashboard.targetHouseholds
    : dashboard.committed.length + dashboard.notCommitted.length;
  const pct = total > 0 ? Math.min(100, Math.round((dashboard.committed.length / total) * 100)) : 0;

  const sortByHouseNum = <T extends { houseNumber: string }>(arr: T[]) =>
    [...arr].sort((a, b) => a.houseNumber.localeCompare(b.houseNumber, undefined, { numeric: true }));

  // ── DASHBOARD ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="container mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-primary font-bold">
              <img src={`${BASE}/kcea-logo.png`} alt="KCEA" className="h-7 w-auto" />
            </div>
            <span className="text-border">|</span>
            <div>
              <span className="font-semibold text-sm">{dashboard.captainName}</span>
              <span className="text-muted-foreground text-sm ml-2 hidden sm:inline">
                — {dashboard.streets.join(" & ")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors hidden sm:block">
              ← Back to site
            </a>
            <Button variant="outline" size="sm" className="gap-2 border-border" onClick={handleLogout}>
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8 space-y-6">

        {/* New Submissions card — residents who committed since last login */}
        {dashboard.newSubmissions && dashboard.newSubmissions.length > 0 && (
          <Card className="bg-card border-primary/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                New Submissions Since Your Last Login ({dashboard.newSubmissions.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                These residents have just committed. Send them a quick thank-you WhatsApp to welcome them.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
              {dashboard.newSubmissions.map(s => {
                const firstName = (s.fullName || "there").split(/\s+/)[0] || "there";
                const msg = `Hi ${firstName}, thank you for committing to the KCEA enclosure for ${s.street}! I'm your street captain. Please feel free to reach out if you have any questions. - ${dashboard.captainName}`;
                const waUrl = makeWaUrl(s.phone, msg);
                const contacted = (dashboard.contactedResidents ?? []).find(c => c.commitmentId === s.id);
                return (
                  <div key={s.id} className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{s.fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.street} No. {s.houseNumber}
                        <span className="ml-2 text-[10px] uppercase tracking-wide">
                          {new Date(s.submittedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleDetails(`new:${s.id}`)}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                      >
                        {expandedDetails.has(`new:${s.id}`) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        Details
                      </button>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge
                        variant="outline"
                        className={s.commitmentType === "onceoff"
                          ? "bg-primary/20 text-primary border-primary/20 text-xs"
                          : "bg-blue-500/20 text-blue-400 border-blue-500/20 text-xs"}
                      >
                        {s.commitmentType === "onceoff" ? "Once-off" : "R250/mo"}
                      </Badge>
                      {waUrl ? (
                        contacted ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground bg-muted/40 border border-border whitespace-nowrap">
                              <CheckCircle className="h-3 w-3" />
                              Sent ✓
                            </span>
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => { void handleContactResident(s.id); }}
                              className="text-[10px] text-primary hover:underline"
                            >
                              Resend
                            </a>
                          </div>
                        ) : (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => { void handleContactResident(s.id); }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-green-400 bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors whitespace-nowrap"
                          >
                            <MessageSquare className="h-3 w-3" />
                            WhatsApp
                          </a>
                        )
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">No phone</span>
                      )}
                    </div>
                    </div>
                    {expandedDetails.has(`new:${s.id}`) && (
                      <ContactDetails
                        fullName={s.fullName}
                        street={s.street}
                        houseNumber={s.houseNumber}
                        phone={s.phone}
                        email={s.email}
                        submittedAt={s.submittedAt}
                      />
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Progress card */}
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {dashboard.streets.join(" & ")} — Street Progress
                </h2>
                <p className="text-muted-foreground text-sm mt-1">
                  <span className="text-green-400 font-medium">{dashboard.committed.length} committed</span>
                  {total > dashboard.committed.length && (
                    <> • <span className="text-red-400 font-medium">{total - dashboard.committed.length} to follow up</span></>
                  )}
                  {total === 0 && " • Register properties below to start tracking"}
                </p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <span className="text-4xl font-bold text-primary">{pct}%</span>
                <p className="text-xs text-muted-foreground">{dashboard.committed.length} / {total}</p>
              </div>
            </div>
            <Progress value={pct} className="h-3" />
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">

          {/* ── Committed ── */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-400" />
                Committed ({dashboard.committed.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
              {dashboard.committed.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No commitments yet for {dashboard.streets.join(" / ")}.
                </p>
              ) : (
                sortByHouseNum(dashboard.committed).map(c => (
                  <div key={c.id} className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{c.fullName}</p>
                        <p className="text-xs text-muted-foreground">{c.street} No. {c.houseNumber}</p>
                        <button
                          type="button"
                          onClick={() => toggleDetails(`committed:${c.id}`)}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                        >
                          {expandedDetails.has(`committed:${c.id}`) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          Details
                        </button>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge
                          variant="outline"
                          className={c.commitmentType === "onceoff"
                            ? "bg-primary/20 text-primary border-primary/20 text-xs"
                            : "bg-blue-500/20 text-blue-400 border-blue-500/20 text-xs"}
                        >
                          {c.commitmentType === "onceoff" ? "Once-off" : "R250/mo"}
                        </Badge>
                        {c.paymentConfirmed && (
                          <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/20 text-xs">
                            Paid ✓
                          </Badge>
                        )}
                      </div>
                    </div>
                    {expandedDetails.has(`committed:${c.id}`) && (
                      <ContactDetails
                        fullName={c.fullName}
                        street={c.street}
                        houseNumber={c.houseNumber}
                        phone={c.phone}
                        email={c.email}
                        submittedAt={c.submittedAt}
                      />
                    )}
                    <PropertyNoteField street={c.street} houseNumber={c.houseNumber} {...noteProps} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* ── Not yet committed ── */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-400" />
                Follow-up needed ({dashboard.notCommitted.length + (dashboard.missingContactInfo?.length ?? 0)})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {dashboard.missingContactInfo && dashboard.missingContactInfo.length > 0 && (
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 space-y-2">
                  <p className="text-xs font-medium text-amber-400 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    Missing contact info ({dashboard.missingContactInfo.length})
                  </p>
                  {dashboard.missingContactInfo.map(m => (
                    <div key={m.id} className="text-xs">
                      <span className="font-medium">{m.fullName}</span>
                      <span className="text-muted-foreground"> — {m.street} No. {m.houseNumber}</span>
                      <span className="ml-2 text-amber-400/80">
                        {m.missingPhone && m.missingEmail ? "no phone & email"
                          : m.missingPhone ? "no phone"
                          : "no email"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="max-h-[26rem] overflow-y-auto pr-1 space-y-2">
                {dashboard.notCommitted.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {total === 0
                      ? "Register properties below to track follow-ups."
                      : "All registered properties have committed — great work!"}
                  </p>
                )}
                {sortByHouseNum(dashboard.notCommitted).map(h => (
                  <div key={h.id} className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                    <div>
                      <p className="font-medium text-sm">{h.street} No. {h.houseNumber}</p>
                      <p className="text-xs text-red-400/80">Not yet committed</p>
                    </div>
                    <PropertyNoteField street={h.street} houseNumber={h.houseNumber} {...noteProps} />
                  </div>
                ))}
              </div>

              {/* Register house form */}
              <div className="pt-3 mt-1 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Home className="h-3 w-3" />
                  Register a property to track
                </p>
                <form onSubmit={handleAddHouse} className="flex gap-2">
                  {dashboard.streets.length > 1 && (
                    <Select value={newHouseStreet} onValueChange={setNewHouseStreet}>
                      <SelectTrigger className="bg-background border-border h-8 text-xs flex-1">
                        <SelectValue placeholder="Street" />
                      </SelectTrigger>
                      <SelectContent>
                        {dashboard.streets.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Input
                    placeholder="House no."
                    value={newHouseNum}
                    onChange={e => setNewHouseNum(e.target.value)}
                    className="bg-background border-border h-8 text-xs"
                    style={{ width: 90 }}
                    required
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8 text-xs gap-1 shrink-0"
                    disabled={addingHouse || !newHouseNum.trim() || (dashboard.streets.length > 1 && !newHouseStreet)}
                  >
                    <Plus className="h-3 w-3" />
                    {addingHouse ? "Adding…" : "Add"}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  );
}
