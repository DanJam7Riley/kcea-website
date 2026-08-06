import { useState, useEffect } from "react";
import { Lock, CheckCircle, XCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getTokenFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") ?? "";
}

export default function CaptainResetPin() {
  const [token] = useState(getTokenFromUrl);
  const [status, setStatus] = useState<"checking" | "valid" | "invalid">("checking");
  const [captainName, setCaptainName] = useState("");

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setStatus("invalid"); return; }
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/captain/reset-pin/info?token=${encodeURIComponent(token)}`);
        if (!res.ok) { setStatus("invalid"); return; }
        const data = await res.json() as { captainName: string };
        setCaptainName(data.captainName);
        setStatus("valid");
      } catch {
        setStatus("invalid");
      }
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    if (pin.length !== 4) { setSubmitError("PIN must be exactly 4 digits."); return; }
    if (pin !== confirmPin) { setSubmitError("PINs don't match. Please try again."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/captain/reset-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin }),
      });
      const data = await res.json() as { message?: string; ok?: boolean };
      if (!res.ok) {
        setSubmitError(data.message ?? "Something went wrong. Please request a new link.");
        return;
      }
      setDone(true);
    } catch {
      setSubmitError("Unable to connect. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary font-bold text-lg">
          <img src={`${BASE}/kcea-logo.png`} alt="KCEA" className="h-7 w-auto" />
        </div>
        <a href="/captain" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back to Captain Portal
        </a>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm bg-card border-border">
          <CardHeader className="text-center pb-2">
            <div className="h-14 w-14 bg-primary/20 rounded-full flex items-center justify-center text-primary mx-auto mb-3">
              <Lock className="h-7 w-7" />
            </div>
            <CardTitle className="text-2xl">Set Your PIN</CardTitle>
            {status === "valid" && (
              <p className="text-muted-foreground text-sm mt-1">Hi {captainName}, choose a new 4-digit PIN below.</p>
            )}
          </CardHeader>
          <CardContent>
            {status === "checking" && (
              <p className="text-sm text-muted-foreground text-center py-4">Checking your link…</p>
            )}

            {status === "invalid" && (
              <div className="space-y-4 text-center">
                <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <XCircle className="h-4 w-4 shrink-0" />
                  This link has expired or is invalid.
                </div>
                <p className="text-sm text-muted-foreground">
                  Go back to the Captain Portal and click "Forgot your PIN?" to request a new one.
                </p>
                <a href="/captain">
                  <Button variant="outline" className="w-full border-border">Back to Captain Portal</Button>
                </a>
              </div>
            )}

            {status === "valid" && !done && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-pin">New 4-Digit PIN</Label>
                  <Input
                    id="new-pin"
                    type="password"
                    placeholder="••••"
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    required
                    maxLength={4}
                    inputMode="numeric"
                    className="bg-background border-border tracking-[0.5em] text-center text-lg"
                    data-testid="input-new-pin"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-pin">Confirm PIN</Label>
                  <Input
                    id="confirm-pin"
                    type="password"
                    placeholder="••••"
                    value={confirmPin}
                    onChange={e => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    required
                    maxLength={4}
                    inputMode="numeric"
                    className="bg-background border-border tracking-[0.5em] text-center text-lg"
                    data-testid="input-confirm-pin"
                  />
                </div>
                {submitError && (
                  <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <XCircle className="h-4 w-4 shrink-0" />
                    {submitError}
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground"
                  disabled={submitting || pin.length < 4 || confirmPin.length < 4}
                  data-testid="button-set-pin"
                >
                  {submitting ? "Saving…" : "Set PIN"}
                </Button>
              </form>
            )}

            {done && (
              <div className="space-y-4 text-center">
                <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  Your PIN is set. You can sign in now.
                </div>
                <a href="/captain">
                  <Button className="w-full bg-primary text-primary-foreground">Go to Sign In</Button>
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
