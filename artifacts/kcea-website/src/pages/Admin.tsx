import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Save, LogIn, AlertTriangle, CheckCircle, Check, Key, Pencil,
  Trash2, Download, Upload, Users, ClipboardList, BarChart3, Search, MessageSquare, RefreshCw, Phone, ExternalLink, Settings as SettingsIcon, Heart, Mail
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_OPTIONS = ["Strong", "Good", "Solid", "Steady", "In Progress", "Re-engaged", "Critical"];
const TABS = ["submissions", "stats", "captains", "incomplete", "captain-mgmt", "pledges", "settings"] as const;
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
  createdAt: string;
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
    return captains.filter(c => {
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
    });
  }, [captains, captainSearch, captainStatusFilter]);
  const filtersActive = captainSearch.trim() !== "" || captainStatusFilter !== "all";

  const knownStreets = useMemo(() => {
    const set = new Set<string>();
    for (const c of captains) set.add(c.street.trim().toLowerCase());
    return set;
  }, [captains]);
  const isNewStreet = (street: string) => {
    const s = (street ?? "").trim().toLowerCase();
    return s.length > 0 && !knownStreets.has(s);
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

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    commitments.forEach(c => {
      const key = `${c.fullName.toLowerCase()}|${c.street.toLowerCase()}|${c.houseNumber.toLowerCase()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [commitments]);

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
          {([ ["submissions", ClipboardList, "Submissions"], ["stats", BarChart3, "Stats"], ["captains", Users, "Captains"], ["incomplete", AlertTriangle, "Incomplete"], ["captain-mgmt", Key, "Captain Portal"], ["pledges", Heart, "Pledges"], ["settings", SettingsIcon, "Settings"] ] as const).map(([tab, Icon, label]) => (
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
                  {filtered.map(c => {
                    const newStreet = isNewStreet(c.street);
                    return (
                    <div key={c.id} className={`grid grid-cols-12 gap-3 items-center px-3 py-3 rounded-lg border transition-colors ${newStreet ? "bg-amber-500/5 border-amber-500/40 hover:border-amber-500/60" : "bg-background/50 border-border hover:border-border/80"}`} data-testid={`submission-row-${c.id}`}>
                      <div className="col-span-2">
                        <p className="font-medium text-sm">{c.fullName}</p>
                        <p className="text-xs text-muted-foreground">#{c.id}</p>
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm">{c.street}</p>
                          {newStreet && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5 py-0 h-4" variant="outline" data-testid={`badge-new-street-${c.id}`}>
                              New Street
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">No. {c.houseNumber}</p>
                        {newStreet && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Add "${c.street}" to the streets list with a default of 20 households? You can edit the target later in the Captains tab.`)) {
                                addStreet.mutate(c.street.trim());
                              }
                            }}
                            disabled={addStreet.isPending}
                            className="mt-1 text-[11px] text-amber-300 hover:text-amber-200 underline underline-offset-2 disabled:opacity-50"
                            data-testid={`btn-add-street-${c.id}`}
                          >
                            Add {c.street} to streets list
                          </button>
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
                    const currentStatus = edit.status ?? c.status;
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
                          <select
                            defaultValue={c.status}
                            key={`status-${c.id}-${c.status}`}
                            onChange={e => handleCaptainChange(c.id, "status", e.target.value)}
                            className="w-full h-8 rounded-md border border-border bg-card text-foreground text-sm px-1 focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            {STATUS_OPTIONS.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
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
                            <Badge className={`text-xs shrink-0 ${getStatusColor(currentStatus)}`} variant="secondary">
                              {currentStatus}
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
                    <Button size="sm" className="h-8" disabled={!newProfileName.trim() || createCaptainProfile.isPending} onClick={() => createCaptainProfile.mutate({ name: newProfileName.trim(), phone: newProfilePhone.trim() })}>
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
    </div>
  );
}
