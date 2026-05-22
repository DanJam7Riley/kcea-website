import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertCircle, Loader2, Shield, MessageSquare, ArrowLeft } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SITE_NAME = "kcea.co.za";

const STREET_OPTIONS = [
  "Albemarle Street", "Boundary Road", "Boyes Drive", "Chamberlain Road", "Charles Street",
  "Clovelly Avenue", "Cumberland Avenue", "Devon Street", "Dorset Street", "Durham Avenue",
  "Eaton Road", "Essex Avenue", "Hampton Road", "Highbury Road", "Highstead Road",
  "Kensington Crescent", "Kitchener Avenue", "Lancaster Road", "Lincoln Road", "Norfolk Avenue",
  "Norwich Avenue", "Plymouth Road", "Queens Road", "Roberts Avenue", "Salisbury Avenue",
  "Stafford Road", "Surrey Avenue", "Sussex Avenue", "Wellington Avenue", "York Road",
  "Other",
];

type Stage = "phone" | "code" | "edit" | "done";

interface RecordData {
  fullName: string;
  email: string;
  phone: string;
  street: string;
  houseNumber: string;
}

export default function MeUpdate() {
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [record, setRecord] = useState<RecordData | null>(null);
  const [customStreet, setCustomStreet] = useState("");
  const [streetIsOther, setStreetIsOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null);
    if (!phone.trim()) { setError("Please enter your phone number."); return; }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/me/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) { setError(data.message ?? "Something went wrong."); return; }
      setInfo(data.message ?? "If that number is on our list, we've sent a 4-digit code via WhatsApp. It expires in 10 minutes.");
      setStage("code");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{4}$/.test(code.trim())) { setError("Please enter the 4-digit code."); return; }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/me/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string; sessionToken?: string; record?: RecordData;
      };
      if (!res.ok || !data.sessionToken || !data.record) {
        setError(data.message ?? "Invalid or expired code. Please try again.");
        return;
      }
      setSessionToken(data.sessionToken);
      setRecord(data.record);
      setStreetIsOther(!STREET_OPTIONS.includes(data.record.street));
      if (!STREET_OPTIONS.includes(data.record.street)) {
        setCustomStreet(data.record.street);
      }
      setInfo(null);
      setStage("edit");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;
    setError(null);
    const resolvedStreet = streetIsOther ? customStreet.trim() : record.street;
    if (!record.fullName.trim() || !record.email.trim() || !resolvedStreet || !record.houseNumber.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/me/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken,
          fullName: record.fullName.trim(),
          email: record.email.trim(),
          street: resolvedStreet,
          houseNumber: record.houseNumber.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) { setError(data.message ?? "Couldn't save your changes."); return; }
      setStage("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground dark font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight">
            <Shield className="h-6 w-6" />
            KCEA
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back to {SITE_NAME}
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Update My Details</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Already on the KCEA list? Verify with WhatsApp and update what's changed.
            </p>
          </div>

          <Card className="bg-card border-card-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                {stage === "phone" && (<><MessageSquare className="h-4 w-4 text-primary" /> Step 1 — Verify your phone</>)}
                {stage === "code" && (<><MessageSquare className="h-4 w-4 text-primary" /> Step 2 — Enter your code</>)}
                {stage === "edit" && (<><CheckCircle2 className="h-4 w-4 text-primary" /> Step 3 — Update your details</>)}
                {stage === "done" && (<><CheckCircle2 className="h-4 w-4 text-green-400" /> All done</>)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {info && stage !== "done" && (
                <div className="mb-4 flex items-start gap-2 text-sm text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-md p-3">
                  <MessageSquare className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>{info}</p>
                </div>
              )}
              {error && (
                <div className="mb-4 flex items-start gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md p-3" data-testid="banner-me-update-error">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-400" />
                  <p>{error}</p>
                </div>
              )}

              {stage === "phone" && (
                <form onSubmit={requestOtp} className="space-y-4" data-testid="form-me-phone">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone number</Label>
                    <Input
                      id="phone"
                      type="tel"
                      required
                      placeholder="082 123 4567"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className="bg-background border-border"
                      data-testid="input-me-phone"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use the same number you signed up with. We'll send a 4-digit code via WhatsApp.
                    </p>
                  </div>
                  <Button type="submit" className="w-full" disabled={busy} data-testid="button-me-request-otp">
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending…</> : "Send WhatsApp Code"}
                  </Button>
                </form>
              )}

              {stage === "code" && (
                <form onSubmit={verifyOtp} className="space-y-4" data-testid="form-me-code">
                  <div className="space-y-1.5">
                    <Label htmlFor="code">4-digit code</Label>
                    <Input
                      id="code"
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      maxLength={4}
                      required
                      placeholder="1234"
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      className="bg-background border-border text-center text-2xl tracking-[0.5em] font-mono"
                      data-testid="input-me-code"
                      autoComplete="one-time-code"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => { setStage("phone"); setCode(""); setError(null); setInfo(null); }} disabled={busy}>
                      Back
                    </Button>
                    <Button type="submit" className="flex-1" disabled={busy} data-testid="button-me-verify-otp">
                      {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Verifying…</> : "Verify Code"}
                    </Button>
                  </div>
                </form>
              )}

              {stage === "edit" && record && (
                <form onSubmit={saveChanges} className="space-y-4" data-testid="form-me-edit">
                  <div className="space-y-1.5">
                    <Label htmlFor="fullName">Full name</Label>
                    <Input id="fullName" required value={record.fullName}
                      onChange={e => setRecord({ ...record, fullName: e.target.value })}
                      className="bg-background border-border" data-testid="input-me-fullname" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" required value={record.email}
                      onChange={e => setRecord({ ...record, email: e.target.value })}
                      className="bg-background border-border" data-testid="input-me-email" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="street">Street</Label>
                      <Select
                        value={streetIsOther ? "Other" : record.street}
                        onValueChange={v => {
                          if (v === "Other") {
                            setStreetIsOther(true);
                          } else {
                            setStreetIsOther(false);
                            setRecord({ ...record, street: v });
                          }
                        }}
                      >
                        <SelectTrigger id="street" className="bg-background border-border" data-testid="select-me-street">
                          <SelectValue placeholder="Select street" />
                        </SelectTrigger>
                        <SelectContent>
                          {STREET_OPTIONS.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="houseNumber">House no.</Label>
                      <Input id="houseNumber" required value={record.houseNumber}
                        onChange={e => setRecord({ ...record, houseNumber: e.target.value })}
                        className="bg-background border-border" data-testid="input-me-housenumber" />
                    </div>
                  </div>
                  {streetIsOther && (
                    <div className="space-y-1.5">
                      <Label htmlFor="customStreet">Type street name</Label>
                      <Input id="customStreet" required value={customStreet}
                        onChange={e => setCustomStreet(e.target.value)}
                        className="bg-background border-border" />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Your phone number stays linked to this record. To change it, contact your street captain.
                  </p>
                  <Button type="submit" className="w-full" disabled={busy} data-testid="button-me-save">
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…</> : "Save Changes"}
                  </Button>
                </form>
              )}

              {stage === "done" && (
                <div className="space-y-4" data-testid="panel-me-done">
                  <div className="flex items-start gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-md p-3">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Your details have been updated. Thank you!</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Your record on {SITE_NAME} now reflects the latest information.
                      </p>
                    </div>
                  </div>
                  <Link href="/" className="block">
                    <Button variant="outline" className="w-full">Back to {SITE_NAME}</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Need help? Contact your street captain or visit <span className="text-foreground">{SITE_NAME}</span>.
          </p>
        </div>
      </main>
    </div>
  );
}
