import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Loader2, ShieldCheck, ArrowLeft } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SITE_NAME = "kcea.co.za";

interface ConfirmInfo {
  id: number;
  fullName: string;
  street: string;
  houseNumber: string;
  commitmentType: string;
  alreadyConfirmed: boolean;
}

// Public, one-click confirmation page for residents who signed a paper
// consent form in 2025 but were never captured on the live site. Reached
// only via the personalised link in the "Confirm your KCEA commitment"
// email — the link itself carries the id + a token, so there's nothing to
// log in to and nothing to type beyond the one confirm button.
export default function Confirm() {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get("id");
  const id = idParam ? parseInt(idParam, 10) : NaN;
  const token = params.get("t") ?? "";

  const [info, setInfo] = useState<ConfirmInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (isNaN(id) || !token) {
      setLoadError("This link is missing or invalid. Please use the link sent to you by the KCEA team, or contact your street captain.");
      setLoading(false);
      return;
    }
    fetch(`${BASE}/api/commitments/${id}/confirm-info?t=${encodeURIComponent(token)}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Could not load your record (${r.status})`);
        }
        return r.json();
      })
      .then((rec: ConfirmInfo) => {
        setInfo(rec);
        if (rec.alreadyConfirmed) setConfirmed(true);
      })
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const monthlyLine = info?.commitmentType === "onceoff" ? "a once-off R3,000 contribution" : "the R250/month contribution";

  const onConfirm = async () => {
    if (!info) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch(`${BASE}/api/commitments/${id}/confirm-identity?t=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Could not confirm — please try again.");
      setConfirmed(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not confirm — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground dark font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight">
            <img src={`${BASE}/kcea-logo.png`} alt="KCEA" className="h-8 w-auto" />
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back to {SITE_NAME}
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Confirm your commitment</h1>
            <p className="text-sm text-muted-foreground mt-2">
              We found your street's original consent form — one click adds you to our official system.
            </p>
          </div>

          <Card className="bg-card border-card-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> KCEA — Kensington Central Enclosure Association
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading && (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your record…
                </div>
              )}

              {loadError && (
                <div className="flex items-start gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <p className="font-medium">Could not load this link</p>
                    <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
                  </div>
                </div>
              )}

              {info && !confirmed && (
                <div className="space-y-4">
                  <div className="text-sm bg-background/50 border border-border rounded-md p-3 space-y-1">
                    <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{info.fullName}</span></p>
                    <p><span className="text-muted-foreground">Address:</span> <span className="font-medium">{info.street} No. {info.houseNumber}</span></p>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    By clicking confirm, you're telling us you live at this address and will be responsible for {monthlyLine} towards the KCEA road-closure project.
                  </p>

                  {submitError && (
                    <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-2">
                      {submitError}
                    </div>
                  )}

                  <Button className="w-full" onClick={onConfirm} disabled={submitting} data-testid="button-confirm-commitment">
                    {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Confirming…</> : "Yes, I confirm — I'll be responsible for payment"}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    Not sure this is you, or think this is a mistake? Contact your street captain instead of clicking confirm.
                  </p>
                </div>
              )}

              {confirmed && (
                <div className="flex items-start gap-2 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-md p-3">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Thank you — you're confirmed!</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your commitment is now on our official system and ready for monthly invoicing. No further action is needed right now.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Not sure this is legit? Contact your street captain, or message KCEA on WhatsApp before clicking confirm.
            We'll never ask for passwords, card numbers, or bank details by email.
          </p>
        </div>
      </main>
    </div>
  );
}
