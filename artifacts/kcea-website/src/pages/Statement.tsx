import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ArrowLeft, Loader2, Receipt } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SITE_NAME = "kcea.co.za";

interface StatementLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

interface StatementPayment {
  amount: number;
  paymentDate: string;
  method: string;
  reference: string | null;
}

interface StatementInvoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  total: number;
  amountPaid: number;
  balance: number;
  lineItems: StatementLineItem[];
  payments: StatementPayment[];
}

interface StatementCredit { id: number; amount: number; paymentDate: string; method: string; reference: string | null }

interface StatementData {
  commitment: { id: number; fullName: string; street: string; houseNumber: string; commitmentType: string };
  invoices: StatementInvoice[];
  unappliedCredits: StatementCredit[];
  totalOutstanding: number;
  invoiceCount: number;
}

const rands = (n: number) => `R${n.toLocaleString("en-ZA")}`;
// Positive = owed to KCEA; negative = KCEA owes them (paid more than
// invoiced) — shown as credit rather than a confusing negative number.
const balanceLabel = (n: number) => (n < 0 ? `${rands(Math.abs(n))} in credit` : rands(n));
const shortDate = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });

function statusBadge(status: string) {
  const map: Record<string, string> = {
    paid: "bg-green-500/20 text-green-400 border-green-500/20",
    partial: "bg-amber-500/20 text-amber-400 border-amber-500/20",
    unpaid: "bg-red-500/20 text-red-400 border-red-500/20",
    overdue: "bg-red-500/20 text-red-400 border-red-500/20",
    draft: "bg-muted/40 text-muted-foreground border-border",
    cancelled: "bg-muted/40 text-muted-foreground border-border",
  };
  return <Badge variant="outline" className={`${map[status] ?? map.draft} text-xs capitalize`}>{status}</Badge>;
}

// Public, no-login self-service statement — reached via the personalised
// link ("View your full statement") included in every invoice email.
// Purpose: residents kept asking KCEA to resend individual invoices; this
// lets them check their own full history and running balance any time.
export default function Statement() {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get("id");
  const id = idParam ? parseInt(idParam, 10) : NaN;
  const token = params.get("t") ?? "";

  const [data, setData] = useState<StatementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isNaN(id) || !token) {
      setError("This link is missing or invalid. Please use the link from your invoice email, or contact your street captain.");
      setLoading(false);
      return;
    }
    fetch(`${BASE}/api/commitments/${id}/statement?t=${encodeURIComponent(token)}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Could not load your statement (${r.status})`);
        }
        return r.json();
      })
      .then((rec: StatementData) => setData(rec))
      .catch(err => setError(err instanceof Error ? err.message : "Could not load your statement."))
      .finally(() => setLoading(false));
  }, [id]);

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
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight flex items-center justify-center gap-2">
              <Receipt className="h-7 w-7 text-primary" /> Your KCEA Statement
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Every invoice and payment on record for your household, updated live.
            </p>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your statement…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-400" />
              <div>
                <p className="font-medium">Could not load this link</p>
                <p className="text-xs text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          )}

          {data && (
            <>
              <Card className="bg-card border-card-border">
                <CardContent className="p-6 flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <p className="font-medium">{data.commitment.fullName}</p>
                    <p className="text-sm text-muted-foreground">{data.commitment.street} No. {data.commitment.houseNumber}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">{data.totalOutstanding < 0 ? "Credit balance" : "Total outstanding"}</p>
                    <p className={`text-2xl font-bold ${data.totalOutstanding > 0 ? "text-red-400" : "text-green-400"}`}>
                      {balanceLabel(data.totalOutstanding)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {data.unappliedCredits.length > 0 && (
                <Card className="bg-green-500/10 border-green-500/30">
                  <CardContent className="p-4 space-y-1">
                    <p className="text-xs font-semibold text-green-400 uppercase tracking-wide">
                      Unapplied credit — {rands(data.unappliedCredits.reduce((s, c) => s + c.amount, 0))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Payment received but not yet matched to an invoice — this will automatically apply to your next invoice.
                    </p>
                  </CardContent>
                </Card>
              )}

              {data.invoices.length === 0 && data.unappliedCredits.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No invoices on record yet.</p>
              ) : data.invoices.length === 0 ? null : (
                <div className="space-y-3">
                  {[...data.invoices].reverse().map(inv => (
                    <Card key={inv.id} className="bg-card border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
                          <span>{inv.invoiceNumber}</span>
                          {statusBadge(inv.status)}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Invoiced {shortDate(inv.invoiceDate)} · Due {shortDate(inv.dueDate)}
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        {inv.lineItems.map((li, i) => (
                          <div key={i} className="flex justify-between text-muted-foreground">
                            <span>{li.description}{li.quantity > 1 ? ` x${li.quantity}` : ""}</span>
                            <span>{rands(li.amount)}</span>
                          </div>
                        ))}
                        <div className="border-t border-border pt-2 flex justify-between font-medium">
                          <span>Total</span>
                          <span>{rands(inv.total)}</span>
                        </div>
                        {inv.payments.length > 0 && (
                          <div className="pt-1 space-y-1">
                            {inv.payments.map((p, i) => (
                              <div key={i} className="flex justify-between text-green-400 text-xs">
                                <span>Payment received {shortDate(p.paymentDate)} ({p.method})</span>
                                <span>-{rands(p.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex justify-between font-semibold pt-1">
                          <span>Balance</span>
                          <span className={inv.balance > 0 ? "text-red-400" : "text-green-400"}>{rands(inv.balance)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          <p className="text-center text-xs text-muted-foreground pt-4">
            Questions about your statement? Contact your street captain, or message KCEA on WhatsApp.
            We'll never ask for passwords, card numbers, or bank details by email.
          </p>
        </div>
      </main>
    </div>
  );
}
