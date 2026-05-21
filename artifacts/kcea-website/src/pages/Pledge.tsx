import { useState } from "react";
import { Link } from "wouter";
import { Heart, ArrowLeft, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STREETS = [
  "Derby", "Orion", "Protea", "Osprey", "Onyx", "Nile", "Ocean", "Nymphe",
  "Westmoreland", "Highlands", "Leicester", "Panther", "Nottingham", "Phoenix",
  "Orwell", "Mildura", "Ernest", "Milner", "Patrol",
];

export default function Pledge() {
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [linked, setLinked] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [isResident, setIsResident] = useState<"yes" | "no" | "">("");
  const [street, setStreet] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !phone.trim() || !email.trim() || !amount.trim() || !isResident) {
      toast({ title: "Missing details", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    const amt = parseInt(amount.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Invalid amount", description: "Pledge amount must be a positive number in Rands.", variant: "destructive" });
      return;
    }
    if (isResident === "yes" && (!street || !houseNumber.trim())) {
      toast({ title: "Address required", description: "Please add your street and house number.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/pledges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          amount: amt,
          isResident: isResident === "yes",
          street: isResident === "yes" ? street : "",
          houseNumber: isResident === "yes" ? houseNumber.trim() : "",
          message: message.trim(),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to save pledge");
      }
      const data = await r.json();
      setLinked(Boolean(data.linkedCommitmentId));
      setSubmitted(true);
    } catch (err) {
      toast({ title: "Could not save pledge", description: err instanceof Error ? err.message : "Please try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full bg-card border-card-border">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-green-400 mx-auto" />
            <h2 className="text-2xl font-bold">Thank you for your pledge!</h2>
            <p className="text-muted-foreground text-sm">
              Your pledge of <span className="font-bold text-foreground">R{parseInt(amount.replace(/[^\d]/g, ""), 10).toLocaleString("en-ZA")}</span> has been recorded.
              {linked && " We've linked it to your existing resident commitment."}
            </p>
            <p className="text-xs text-muted-foreground">
              An admin will be in touch about payment details.
            </p>
            <Link href="/">
              <Button className="mt-4 gap-2"><ArrowLeft className="h-4 w-4" /> Back to home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link href="/">
          <button className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </button>
        </Link>

        <Card className="bg-card border-card-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Heart className="h-6 w-6 text-primary" /> Make a Pledge
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Pledges are donations toward the KCEA project — separate from monthly household commitments.
              Pledge any amount; an admin will follow up on payment details.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name *</Label>
                <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} required />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Contact number *</Label>
                  <Input id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="amount">Pledge amount (in Rands) *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R</span>
                  <Input
                    id="amount"
                    inputMode="numeric"
                    placeholder="e.g. 500"
                    value={amount}
                    onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                    className="pl-7"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Are you a Kensington resident? *</Label>
                <RadioGroup
                  value={isResident}
                  onValueChange={(v) => setIsResident(v as "yes" | "no")}
                  className="flex gap-6"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="yes" id="res-yes" />
                    <Label htmlFor="res-yes" className="font-normal cursor-pointer">Yes</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="no" id="res-no" />
                    <Label htmlFor="res-no" className="font-normal cursor-pointer">No</Label>
                  </div>
                </RadioGroup>
              </div>

              {isResident === "yes" && (
                <div className="grid sm:grid-cols-2 gap-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="space-y-1.5">
                    <Label htmlFor="street">Street *</Label>
                    <Select value={street} onValueChange={setStreet}>
                      <SelectTrigger id="street"><SelectValue placeholder="Select street" /></SelectTrigger>
                      <SelectContent>
                        {STREETS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="houseNumber">House number *</Label>
                    <Input id="houseNumber" value={houseNumber} onChange={e => setHouseNumber(e.target.value)} />
                  </div>
                  <p className="sm:col-span-2 text-[11px] text-muted-foreground -mt-1">
                    We'll link this pledge to your existing resident commitment if one is on record.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="message">Message (optional)</Label>
                <Textarea id="message" value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="Anything you'd like to share..." />
              </div>

              <Button type="submit" size="lg" disabled={saving} className="w-full gap-2">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : <><Heart className="h-4 w-4" /> Submit Pledge</>}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
