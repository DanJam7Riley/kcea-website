import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PublicRecord {
  id: number;
  complete: boolean;
  missing: string[];
  fullName?: string;
  email?: string;
  phone?: string;
  street?: string;
  houseNumber?: string;
}

export default function Update() {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get("id");
  const id = idParam ? parseInt(idParam, 10) : NaN;
  const token = params.get("t") ?? "";

  const [record, setRecord] = useState<PublicRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (isNaN(id) || !token) {
      setLoadError("This link is missing or invalid. Please use the link sent to you by the KCEA team.");
      setLoading(false);
      return;
    }
    fetch(`${BASE}/api/commitments/${id}/public?t=${encodeURIComponent(token)}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Could not load record (${r.status})`);
        }
        return r.json();
      })
      .then((rec: PublicRecord) => {
        setRecord(rec);
        setFullName(rec.fullName ?? "");
        setPhone(rec.phone ?? "");
        setEmail(rec.email ?? "");
      })
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, string> = {};
      if (record.missing.includes("Name") && fullName.trim()) body.fullName = fullName.trim();
      if (record.missing.includes("Phone") && phone.trim()) body.phone = phone.trim();
      if (record.missing.includes("Email") && email.trim()) body.email = email.trim();
      const r = await fetch(`${BASE}/api/commitments/${id}/self-update?t=${encodeURIComponent(token)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Update failed");
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">KCEA — Update Your Details</h1>
          <p className="text-sm text-muted-foreground mt-2">Kensington Central Enclosure Association</p>
        </div>

        <Card className="bg-card border-card-border">
          <CardHeader>
            <CardTitle className="text-lg">Complete your record</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && (
              <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your record…
              </div>
            )}

            {loadError && (
              <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Could not load record</p>
                  <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
                  <p className="text-xs text-muted-foreground mt-2">Please contact the KCEA team for help.</p>
                </div>
              </div>
            )}

            {record?.complete && !submitted && (
              <div className="flex items-start gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-md p-3">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">All details on file</p>
                  <p className="text-xs text-muted-foreground mt-1">Your record is already complete — nothing further is needed. Thank you!</p>
                </div>
              </div>
            )}

            {submitted && (
              <div className="flex items-start gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-md p-3">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Thank you!</p>
                  <p className="text-xs text-muted-foreground mt-1">Your details have been updated. The KCEA team will be in touch if anything else is needed.</p>
                </div>
              </div>
            )}

            {record && !record.complete && !submitted && (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="text-xs text-muted-foreground bg-background/50 border border-border rounded-md p-3">
                  <p>We have your commitment on record for <span className="font-medium text-foreground">{record.street} No. {record.houseNumber}</span> but are missing: <span className="font-medium text-amber-400">{record.missing.join(", ")}</span>.</p>
                </div>

                {record.missing.includes("Name") && (
                  <div className="space-y-1.5">
                    <Label htmlFor="fullName">Full name <span className="text-amber-400">*</span></Label>
                    <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Jane Smith" required />
                  </div>
                )}

                {record.missing.includes("Phone") && (
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Mobile number <span className="text-amber-400">*</span></Label>
                    <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 082 123 4567" required />
                  </div>
                )}

                {record.missing.includes("Email") && (
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email <span className="text-amber-400">*</span></Label>
                    <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. you@example.com" required />
                  </div>
                )}

                {/* Already-on-file fields shown as read-only reference */}
                {((!record.missing.includes("Name") && record.fullName) ||
                  (!record.missing.includes("Phone") && record.phone) ||
                  (!record.missing.includes("Email") && record.email)) && (
                  <div className="text-xs text-muted-foreground bg-background/30 border border-border rounded-md p-3 space-y-1">
                    <p className="font-medium text-foreground/80 mb-1">Already on file (no action needed):</p>
                    {!record.missing.includes("Name") && record.fullName && (
                      <p>Name: <span className="text-foreground">{record.fullName}</span></p>
                    )}
                    {!record.missing.includes("Phone") && record.phone && (
                      <p>Phone: <span className="text-foreground">{record.phone}</span></p>
                    )}
                    {!record.missing.includes("Email") && record.email && (
                      <p>Email: <span className="text-foreground">{record.email}</span></p>
                    )}
                  </div>
                )}

                {submitError && (
                  <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-2">
                    {submitError}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…</> : "Update my details"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
