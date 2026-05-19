import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Save, LogIn, AlertTriangle, CheckCircle,
  Trash2, Download, Upload, Users, ClipboardList, BarChart3, Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_OPTIONS = ["Strong", "Good", "Solid", "Steady", "In Progress", "Re-engaged", "Critical"];
const TABS = ["submissions", "stats", "captains", "volunteers"] as const;
type Tab = typeof TABS[number];

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
  submittedAt: string;
}

interface ImportResult {
  added: number;
  skipped: number;
}

interface Volunteer {
  id: number;
  fullName: string;
  street: string;
  phone: string;
  email: string;
  motivation: string | null;
  submittedAt: string;
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
    queryFn: () => fetch(`${BASE}/api/captains`).then(r => r.json()),
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

  const { data: volunteers = [], isLoading: volunteersLoading } = useQuery<Volunteer[]>({
    queryKey: ["volunteers"],
    queryFn: () =>
      fetch(`${BASE}/api/volunteers`, { headers: authHeaders }).then(async r => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      }),
    enabled: authed,
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

  const deleteVolunteer = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/volunteers/${id}`, { method: "DELETE", headers: authHeaders })
        .then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["volunteers"] }),
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const res = await fetch(`${BASE}/api/stats`, { headers: authHeaders });
    if (res.ok) { setAuthed(true); } else { setAuthError("Incorrect password. Please try again."); }
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
    const dateIdx = colIndex(["datesubmitted", "date", "submitteddate", "submittedat"]);

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
          {([ ["submissions", ClipboardList, "Submissions"], ["stats", BarChart3, "Stats"], ["captains", Users, "Captains"], ["volunteers", Shield, "Volunteers"] ] as const).map(([tab, Icon, label]) => (
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
              {tab === "volunteers" && volunteers.length > 0 && (
                <span className="bg-green-500/20 text-green-400 text-xs px-1.5 py-0.5 rounded-full">{volunteers.length}</span>
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
                    <div className="col-span-3">Name</div>
                    <div className="col-span-2">Street / House</div>
                    <div className="col-span-3">Contact</div>
                    <div className="col-span-2">Type</div>
                    <div className="col-span-1">Date</div>
                    <div className="col-span-1"></div>
                  </div>
                  {filtered.map(c => (
                    <div key={c.id} className="grid grid-cols-12 gap-3 items-center px-3 py-3 rounded-lg bg-background/50 border border-border hover:border-border/80 transition-colors">
                      <div className="col-span-3">
                        <p className="font-medium text-sm">{c.fullName}</p>
                        <p className="text-xs text-muted-foreground">#{c.id}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-sm">{c.street}</p>
                        <p className="text-xs text-muted-foreground">No. {c.houseNumber}</p>
                      </div>
                      <div className="col-span-3 min-w-0">
                        <p className="text-xs truncate">{c.email}</p>
                        <p className="text-xs text-muted-foreground">{c.phone}</p>
                      </div>
                      <div className="col-span-2 flex flex-col gap-1">
                        <TypeBadge type={c.commitmentType} />
                        {c.imported && (
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/20 text-xs w-fit" variant="outline">Imported</Badge>
                        )}
                      </div>
                      <div className="col-span-1">
                        <p className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(c.submittedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
                        </p>
                      </div>
                      <div className="col-span-1 flex justify-end">
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
            </CardHeader>
            <CardContent>
              {captainsLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
                    <div className="col-span-3">Street</div>
                    <div className="col-span-3">Captain</div>
                    <div className="col-span-2">Forms</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-2"></div>
                  </div>
                  {captains.map(c => {
                    const edit = captainEdits[c.id] ?? {};
                    const isDirty = Object.keys(edit).length > 0;
                    const currentStatus = edit.status ?? c.status;
                    const isSaving = updateCaptain.isPending && updateCaptain.variables?.id === c.id;
                    const wasSaved = savedCaptains.has(c.id);
                    return (
                      <div key={c.id} className="grid grid-cols-12 gap-3 items-center p-4 rounded-lg bg-background/50 border border-border">
                        <div className="col-span-3 font-semibold text-sm">{c.street}</div>
                        <div className="col-span-3">
                          <Input
                            defaultValue={c.captain}
                            key={`cap-${c.id}-${c.captain}`}
                            onChange={e => handleCaptainChange(c.id, "captain", e.target.value)}
                            placeholder="Captain name"
                            className="bg-card border-border text-sm h-8"
                          />
                        </div>
                        <div className="col-span-2">
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
                        <div className="col-span-2 flex items-center gap-2">
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
                    Click <Save className="inline h-3 w-3" /> on each row after editing to save individually.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {/* Volunteers Tab */}
        {activeTab === "volunteers" && (
          <Card className="bg-card border-card-border">
            <CardHeader>
              <CardTitle className="text-xl">Volunteer Applications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {volunteersLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : volunteers.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <Users className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                  <p className="text-muted-foreground text-sm">No volunteer applications yet. They'll appear here when residents submit the volunteer form.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-3 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
                    <div className="col-span-3">Name</div>
                    <div className="col-span-2">Street to Captain</div>
                    <div className="col-span-3">Contact</div>
                    <div className="col-span-3">Why they want to help</div>
                    <div className="col-span-1"></div>
                  </div>
                  {volunteers.map(v => (
                    <div key={v.id} className="grid grid-cols-12 gap-3 items-start px-3 py-3 rounded-lg bg-background/50 border border-border hover:border-border/80 transition-colors">
                      <div className="col-span-3">
                        <p className="font-medium text-sm">{v.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(v.submittedAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-sm">{v.street}</p>
                      </div>
                      <div className="col-span-3 min-w-0">
                        <p className="text-xs truncate">{v.email}</p>
                        <p className="text-xs text-muted-foreground">{v.phone}</p>
                      </div>
                      <div className="col-span-3">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {v.motivation ?? <span className="italic">No message provided</span>}
                        </p>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          onClick={() => {
                            if (confirm(`Remove application from ${v.fullName}?`)) deleteVolunteer.mutate(v.id);
                          }}
                          className="text-muted-foreground hover:text-red-400 transition-colors p-1 rounded"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-1">{volunteers.length} volunteer application{volunteers.length !== 1 ? "s" : ""}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

      </main>
    </div>
  );
}
