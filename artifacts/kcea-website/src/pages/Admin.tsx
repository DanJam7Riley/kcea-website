import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Save, LogIn, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_OPTIONS = ["Strong", "Good", "Solid", "Steady", "In Progress", "Re-engaged", "Critical"];

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

function getStatusColor(status: string) {
  if (status === "Strong" || status === "Good") return "bg-green-500/20 text-green-400";
  if (status === "Solid" || status === "Steady") return "bg-blue-500/20 text-blue-400";
  if (status === "In Progress") return "bg-amber-500/20 text-amber-400";
  if (status === "Re-engaged") return "bg-purple-500/20 text-purple-400";
  return "bg-red-500/20 text-red-400";
}

export default function Admin() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [statsSaved, setStatsSaved] = useState(false);
  const [statsForm, setStatsForm] = useState<Partial<SiteStats>>({});
  const [captainEdits, setCaptainEdits] = useState<Record<number, Partial<StreetCaptain>>>({});
  const [savedCaptains, setSavedCaptains] = useState<Set<number>>(new Set());

  const qc = useQueryClient();

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

  const updateStats = useMutation({
    mutationFn: (data: Partial<SiteStats>) =>
      fetch(`${BASE}/api/stats`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify(data),
      }).then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
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
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify(data),
      }).then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["captains"] });
      setCaptainEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
      setSavedCaptains(prev => new Set([...prev, id]));
      setTimeout(() => setSavedCaptains(prev => { const n = new Set(prev); n.delete(id); return n; }), 3000);
    },
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const res = await fetch(`${BASE}/api/stats`, {
      headers: { "x-admin-password": password },
    });
    if (res.ok) {
      setAuthed(true);
    } else {
      setAuthError("Incorrect password. Please try again.");
    }
  };

  const handleStatsChange = (field: keyof SiteStats, value: string) => {
    setStatsForm(prev => ({ ...prev, [field]: parseInt(value, 10) || 0 }));
  };

  const handleSaveStats = () => {
    updateStats.mutate(statsForm);
  };

  const handleCaptainChange = (id: number, field: keyof StreetCaptain, value: string | number) => {
    setCaptainEdits(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [field]: value },
    }));
  };

  const handleSaveCaptain = (id: number) => {
    if (!captainEdits[id]) return;
    updateCaptain.mutate({ id, data: captainEdits[id] });
  };

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

      <main className="container mx-auto px-4 py-10 space-y-10 max-w-4xl">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Update stats and street captain data shown on the public site.</p>
        </div>

        {/* Stats Editor */}
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
                    onClick={handleSaveStats}
                    disabled={updateStats.isPending || Object.keys(statsForm).length === 0}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {updateStats.isPending ? "Saving…" : "Save Stats"}
                  </Button>
                  {statsSaved && (
                    <div className="flex items-center gap-1.5 text-green-400 text-sm">
                      <CheckCircle className="h-4 w-4" />
                      Saved!
                    </div>
                  )}
                  {updateStats.isError && (
                    <div className="flex items-center gap-1.5 text-red-400 text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      Save failed
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Street Captains Editor */}
        <Card className="bg-card border-card-border">
          <CardHeader>
            <CardTitle className="text-xl">Street Captains</CardTitle>
          </CardHeader>
          <CardContent>
            {captainsLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : (
              <div className="space-y-3">
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
                          onClick={() => handleSaveCaptain(c.id)}
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
                  Click <Save className="inline h-3 w-3" /> on each row after editing to save changes individually.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
