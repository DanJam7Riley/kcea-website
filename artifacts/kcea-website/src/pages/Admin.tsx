import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Save, LogIn, AlertTriangle, CheckCircle, Check, Key,
  Trash2, Download, Upload, Users, ClipboardList, BarChart3, Search, MessageSquare, RefreshCw, Phone, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_OPTIONS = ["Strong", "Good", "Solid", "Steady", "In Progress", "Re-engaged", "Critical"];
const TABS = ["submissions", "stats", "captains", "incomplete", "captain-mgmt"] as const;
type Tab = typeof TABS[number];

interface IncompleteCommitment {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  street: string;
  houseNumber: string;
  commitmentType: string;
  submittedAt: string;
  missingFields: string[];
}

function makeWhatsAppUrl(phone: string, missingFields: string[]): string | null {
  const digits = phone.replace(/[\s()\-+]/g, "");
  if (!digits || digits.length < 7) return null;
  const normalized = digits.startsWith("0") ? "27" + digits.slice(1) : digits;
  if (!/^\d{10,15}$/.test(normalized)) return null;
  const fieldList = missingFields.join(" and ");
  const msg = `Hi, this is the KCEA team. We have your commitment form on record but some details are missing. Could you please reply with your ${fieldList} so we can update our record? Thank you!`;
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
  id: number;
  committedHouseholds: number;
  monthlyContributions: number;
  targetHouseholds: number;
  fundingPercent: number;
  updatedAt: string;
}

interface StreetCaptain {
  id: number;
  street: string;
  captain: string;
  forms: number;
  status: string;
  phone: string | null;
  email: string | null;
  motivation: string | null;
  captainStatus: string;
  submittedAt: string;
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
}

interface ImportResult {
  added: number;
  skipped: number;
}

interface CaptainProfile {
  id: number;
  name: string;
  phone: string | null;
  pin: string | null;
  pinHash: string | null;
  lastLoginAt: string | null;
}


interface CaptainNote {
  id: number;
  street: string;
  houseNumber: string;
  captainName: string;
  note: string;
  updatedAt: string;
}

function getStatusColor(status: string) {
  if (status === "Strong" || status === "Good") return "bg-green-500/20 text-green-400";
  if (status === "Solid" || status === "Steady") return "bg-blue-500/20 text-blue-400";
  if (status === "In Progress") return "bg-amber-500/20 text-amber-400";
  if (status === "Re-engaged") return "bg-purple-500/20 text-purple-400";
  return "bg-red-500/20 text-red-400";
}

function TypeBadge({ type }: { type: string }) {
  return type === "onceoff"
    ? <Badge className="bg-primary/20 text-primary border-primary/20 text-xs" variant="outline">Once-off</Badge>
    : <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/20 text-xs" variant="outline">Monthly</Badge>;
}

export default function Admin() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("submissions");
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
  const [savedProfiles, setSavedProfiles] = useState<Set<number>>(new Set());
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfilePhone, setNewProfilePhone] = useState("");
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [setPinLoading, setSetPinLoading] = useState<Set<number>>(new Set());
  const [setPinResult, setSetPinResult] = useState<Record<number, { pin: string; sent: boolean }>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();

  const authHeaders = { "x-admin-password": password };

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

  const { data: commitments = [], isLoading: commitmentsLoading } = useQuery<Commitment[]>({
    queryKey: ["commitments"],
    queryFn: () =>
      fetch(`${BASE}/api/commitments`, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      }),
    enabled: authed,
  });

  const { data: incompleteRecords = [], isLoading: incompleteLoading } = useQuery<IncompleteCommitment[]>({
    queryKey: ["incomplete-commitments"],
    queryFn: () =>
      fetch(`${BASE}/api/commitments/incomplete`, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      }),
    enabled: authed && activeTab === "incomplete",
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

  const toggleCaptainStatus = useMutation({
    mutationFn: ({ id, captainStatus }: { id: number; captainStatus: string }) =>
      fetch(`${BASE}/api/captains/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ captainStatus }),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["captains"] }),
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

  const { data: captainNotes = [] } = useQuery<CaptainNote[]>({
    queryKey: ["captain-notes"],
    queryFn: () => fetch(`${BASE}/api/captain/management/notes`, { headers: authHeaders }).then(async r => {
      if (!r.ok) throw new Error(await r.text()); return r.json();
    }),
    enabled: authed && activeTab === "captain-mgmt",
  });

  const updateCaptainProfile = useMutation({
    mutationFn: ({ id, ...body }: { id: number; pin?: string; phone?: string }) =>
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
    mutationFn: (body: { name: string; phone: string }) =>
      fetch(`${BASE}/api/captain/management/profiles`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["captain-profiles"] });
      setNewProfileName(""); setNewProfilePhone(""); setShowAddProfile(false);
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
        setAuthed(true);
      } else {
        setAuthError("Incorrect password. Please try again.");
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
            <p className="text-sm text-muted-foreground">Enter your admin password to continue</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
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
            <Shield className="h-6 w-6" />
            KCEA Admin
          </div>
          <div className="flex items-center gap-3">
            <a href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">← Back to site</a>
            <Button variant="outline" size="sm" className="border-border" onClick={() => { setAuthed(false); setPassword(""); }}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
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

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {([ ["submissions", ClipboardList, "Submissions"], ["stats", BarChart3, "Stats"], ["captains", Users, "Captains"], ["incomplete", AlertTriangle, "Incomplete"], ["captain-mgmt", Key, "Captain Portal"] ] as const).map(([tab, Icon, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {tab === "submissions" && commitments.length > 0 && (
                <span className="bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full">{commitments.length}</span>
              )}
              {tab === "incomplete" && incompleteRecords.length > 0 && (
                <span className="bg-amber-500/20 text-amber-400 text-xs px-1.5 py-0.5 rounded-full">{incompleteRecords.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Submissions Tab */}
        {activeTab === "submissions" && (
          <Card className="bg-card border-card-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
              <CardTitle className="text-xl">Commitment Submissions</CardTitle>
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
                      {importResult.skipped > 0 && ` · ${importResult.skipped} skipped as duplicate${importResult.skipped !== 1 ? "s" : ""}`}
                    </p>
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
                  {filtered.map(c => (
                    <div key={c.id} className="grid grid-cols-12 gap-3 items-center px-3 py-3 rounded-lg bg-background/50 border border-border hover:border-border/80 transition-colors">
                      <div className="col-span-2">
                        <p className="font-medium text-sm">{c.fullName}</p>
                        <p className="text-xs text-muted-foreground">#{c.id}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-sm">{c.street}</p>
                        <p className="text-xs text-muted-foreground">No. {c.houseNumber}</p>
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
                      </div>
                      <div className="col-span-1">
                        <p className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(c.submittedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                        </p>
                      </div>
                      <div className="col-span-3 flex items-center justify-end gap-1">
                        {(() => {
                          const msg = `Hi ${c.fullName}, thank you for committing to the KCEA enclosure project! Your details have been recorded for ${c.street}, No. ${c.houseNumber}. We will be in touch with payment information soon. KCEA Team.`;
                          const url = makeResidentWaUrl(c.phone, msg);
                          return url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-green-400 bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors whitespace-nowrap" title="Send thank-you WhatsApp to resident">
                              <MessageSquare className="h-3 w-3" />WhatsApp Resident
                            </a>
                          ) : null;
                        })()}
                        <button
                          onClick={() => confirmPayment.mutate({ id: c.id, paymentConfirmed: !c.paymentConfirmed })}
                          className={`transition-colors p-1 rounded ${c.paymentConfirmed ? "text-green-400 hover:text-muted-foreground" : "text-muted-foreground hover:text-green-400"}`}
                          title={c.paymentConfirmed ? "Mark payment unconfirmed" : "Mark payment confirmed"}
                        >
                          <Check className="h-4 w-4" />
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
                  ))}
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
                  <div className="grid sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="committedHouseholds">Committed Households</Label>
                      <Input
                        id="committedHouseholds"
                        type="number"
                        min={0}
                        defaultValue={stats?.committedHouseholds}
                        key={`ch-${stats?.committedHouseholds}`}
                        onChange={e => handleStatsChange("committedHouseholds", e.target.value)}
                        className="bg-background border-border"
                      />
                    </div>
                    <div className="space-y-2">
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
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="monthlyContributions">Monthly Contributions (R)</Label>
                      <Input
                        id="monthlyContributions"
                        type="number"
                        min={0}
                        defaultValue={stats?.monthlyContributions}
                        key={`mc-${stats?.monthlyContributions}`}
                        onChange={e => handleStatsChange("monthlyContributions", e.target.value)}
                        className="bg-background border-border"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fundingPercent">Phase 1 Funding % (0–100)</Label>
                      <Input
                        id="fundingPercent"
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={stats?.fundingPercent}
                        key={`fp-${stats?.fundingPercent}`}
                        onChange={e => handleStatsChange("fundingPercent", e.target.value)}
                        className="bg-background border-border"
                      />
                    </div>
                  </div>
                  {stats?.updatedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last updated: {new Date(stats.updatedAt).toLocaleString()}
                    </p>
                  )}
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      onClick={() => updateStats.mutate(statsForm)}
                      disabled={updateStats.isPending || Object.keys(statsForm).length === 0}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {updateStats.isPending ? "Saving…" : "Save Stats"}
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
            </CardHeader>
            <CardContent>
              {captainsLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
                    <div className="col-span-2">Street</div>
                    <div className="col-span-2">Captain</div>
                    <div className="col-span-1">Forms</div>
                    <div className="col-span-2">Activity Status</div>
                    <div className="col-span-3">Role</div>
                    <div className="col-span-2"></div>
                  </div>
                  {captains.map(c => {
                    const edit = captainEdits[c.id] ?? {};
                    const isDirty = Object.keys(edit).length > 0;
                    const currentStatus = edit.status ?? c.status;
                    const isSaving = updateCaptain.isPending && updateCaptain.variables?.id === c.id;
                    const wasSaved = savedCaptains.has(c.id);
                    const isActive = c.captainStatus === "Active Captain";
                    const isToggling = toggleCaptainStatus.isPending && (toggleCaptainStatus.variables as { id: number } | undefined)?.id === c.id;
                    return (
                      <div key={c.id} className={`grid grid-cols-12 gap-3 items-start p-4 rounded-lg bg-background/50 border transition-colors ${isActive ? "border-border" : "border-amber-500/20"}`}>
                        <div className="col-span-2 font-semibold text-sm pt-1">{c.street}</div>
                        <div className="col-span-2">
                          <Input
                            defaultValue={c.captain}
                            key={`cap-${c.id}-${c.captain}`}
                            onChange={e => handleCaptainChange(c.id, "captain", e.target.value)}
                            placeholder="Captain name"
                            className="bg-card border-border text-sm h-8"
                          />
                          {!isActive && (c.phone || c.email) && (
                            <div className="mt-1 space-y-0.5">
                              {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                              {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                            </div>
                          )}
                          {!isActive && c.motivation && (
                            <p className="text-xs text-muted-foreground italic mt-1 leading-tight">{c.motivation}</p>
                          )}
                        </div>
                        <div className="col-span-1">
                          <Input
                            type="number"
                            min={0}
                            defaultValue={c.forms}
                            key={`forms-${c.id}-${c.forms}`}
                            onChange={e => handleCaptainChange(c.id, "forms", parseInt(e.target.value, 10) || 0)}
                            className="bg-card border-border text-sm h-8"
                          />
                        </div>
                        <div className="col-span-2">
                          <select
                            defaultValue={c.status}
                            key={`status-${c.id}-${c.status}`}
                            onChange={e => handleCaptainChange(c.id, "status", e.target.value)}
                            className="w-full h-8 rounded-md border border-border bg-card text-foreground text-sm px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            {STATUS_OPTIONS.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-3 flex flex-col items-start gap-1.5 pt-0.5">
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
                          {!isActive && c.phone && (() => {
                            const msg = `Hi ${c.captain}, thank you for volunteering to be a Street Captain for ${c.street}! Your application is under review. The KCEA committee will be in touch soon. Questions? WhatsApp us at 0832355052.`;
                            const url = makeResidentWaUrl(c.phone, msg);
                            return url ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-green-400 bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors">
                                <MessageSquare className="h-3 w-3" />WhatsApp Applicant
                              </a>
                            ) : null;
                          })()}
                          {isActive && c.phone && (() => {
                            const msg = `Hi ${c.captain}, you have been confirmed as Street Captain for ${c.street}! Welcome to the team. Your captain portal: attached-assets-janineriley.replit.app/captain-login${c.email ? ` | Username: ${c.email}` : ""}. The KCEA committee will send your PIN separately. Questions? WhatsApp 0832355052.`;
                            const url = makeResidentWaUrl(c.phone, msg);
                            return url ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors">
                                <MessageSquare className="h-3 w-3" />Approval WhatsApp
                              </a>
                            ) : null;
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
                            <Badge className={`text-xs shrink-0 ${getStatusColor(currentStatus)}`} variant="secondary">
                              {currentStatus}
                            </Badge>
                          )}
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
        {/* Incomplete Records Tab */}
        {activeTab === "incomplete" && (
          <Card className="bg-card border-card-border">
            <CardHeader>
              <CardTitle className="text-xl">Incomplete Records</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Commitment submissions that are missing one or more fields (name, phone, or email).
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
                    const waUrl = c.phone && c.phone !== "-" ? makeWhatsAppUrl(c.phone, c.missingFields) : null;
                    return (
                      <div key={c.id} className="grid grid-cols-12 gap-3 items-center px-3 py-3 rounded-lg bg-background/50 border border-amber-500/20 hover:border-amber-500/30 transition-colors">
                        <div className="col-span-3">
                          <p className="font-medium text-sm">{c.fullName || <span className="italic text-muted-foreground">No name</span>}</p>
                          <p className="text-xs text-muted-foreground">#{c.id} · {new Date(c.submittedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-sm">{c.street}</p>
                          <p className="text-xs text-muted-foreground">No. {c.houseNumber}</p>
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
                          {c.email && c.email !== "imported@kcea.local" ? (
                            <p className="text-xs truncate">{c.email}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No email</p>
                          )}
                          {c.phone && c.phone !== "-" ? (
                            <p className="text-xs text-muted-foreground">{c.phone}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No phone</p>
                          )}
                        </div>
                        <div className="col-span-2 flex justify-end">
                          {waUrl ? (
                            <a href={waUrl} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="outline" className="h-8 text-xs px-2 gap-1.5 border-green-500/40 text-green-400 hover:bg-green-500/10">
                                <ExternalLink className="h-3 w-3" />
                                WhatsApp
                              </Button>
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">No phone on record</span>
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
                      <Input value={newProfilePhone} onChange={e => setNewProfilePhone(e.target.value)} placeholder="+27821234567" className="bg-background border-border h-8 text-sm" />
                    </div>
                    <Button size="sm" className="h-8" disabled={!newProfileName.trim() || createCaptainProfile.isPending} onClick={() => createCaptainProfile.mutate({ name: newProfileName.trim(), phone: newProfilePhone.trim() })}>
                      {createCaptainProfile.isPending ? "Adding…" : "Add"}
                    </Button>
                  </div>
                )}

                {captainProfiles.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <Key className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">Loading captain profiles…</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {captainProfiles.map(p => {
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
                                  placeholder="+27821234567"
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
                            <div className="space-y-1">
                              <Label className="text-xs flex items-center gap-1"><Key className="h-3 w-3" /> Portal PIN</Label>
                              <div className="flex items-center gap-2">
                                {pinResult ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-lg font-bold text-primary tracking-[0.3em] bg-primary/10 px-3 py-1 rounded-md">{pinResult.pin}</span>
                                    {p.phone && (() => {
                                      const msg = `Hi ${p.name}, your KCEA Captain Portal login: attached-assets-janineriley.replit.app/captain-login | Username: ${p.name} | PIN: ${pinResult.pin}. Keep your PIN private. Questions? WhatsApp 0832355052.`;
                                      const url = makeResidentWaUrl(p.phone, msg);
                                      return url ? (
                                        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-green-400 bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors">
                                          <MessageSquare className="h-3 w-3" />Send PIN via WhatsApp
                                        </a>
                                      ) : null;
                                    })()}
                                  </div>
                                ) : p.pin ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-lg font-bold text-foreground tracking-[0.3em] bg-background border border-border px-3 py-1 rounded-md">{p.pin}</span>
                                    {p.phone && (() => {
                                      const msg = `Hi ${p.name}, your KCEA Captain Portal login: attached-assets-janineriley.replit.app/captain-login | Username: ${p.name} | PIN: ${p.pin}. Keep your PIN private. Questions? WhatsApp 0832355052.`;
                                      const url = makeResidentWaUrl(p.phone, msg);
                                      return url ? (
                                        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-green-400 bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors">
                                          <MessageSquare className="h-3 w-3" />Send PIN via WhatsApp
                                        </a>
                                      ) : null;
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


      </main>
    </div>
  );
}
