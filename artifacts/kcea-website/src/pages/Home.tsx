import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { 
  ChevronDown, Check, AlertCircle, Mail, MapPin, Phone, 
  TrendingUp, Shield, Users, Menu, X, Search, Loader2, Heart
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  status: string;
  targetHouseholds?: number;
  committedHouseholds?: number;
}

const DEFAULT_STATS: SiteStats = {
  committedHouseholds: 191,
  monthlyContributions: 47750,
  targetHouseholds: 680,
  fundingPercent: 28,
};

const DEFAULT_CAPTAINS: StreetCaptain[] = [
  { id: 1,  street: "Derby",        captain: "Carina",          forms: 30, status: "Strong"      },
  { id: 2,  street: "Orion",        captain: "Ingrid",          forms: 19, status: "Strong"      },
  { id: 3,  street: "Protea",       captain: "Priscilla",       forms: 17, status: "Good"        },
  { id: 4,  street: "Osprey",       captain: "Jo-Anne",         forms: 15, status: "Solid"       },
  { id: 5,  street: "Onyx",         captain: "Maria D'Alves",   forms: 13, status: "Good"        },
  { id: 6,  street: "Westmoreland", captain: "Unassigned",      forms: 13, status: "Steady"      },
  { id: 7,  street: "Ocean",        captain: "Geoff",           forms: 12, status: "In Progress" },
  { id: 8,  street: "Nymphe",       captain: "Maria D'Alves",   forms: 11, status: "In Progress" },
  { id: 9,  street: "Highlands",    captain: "Unassigned",      forms: 11, status: "In Progress" },
  { id: 10, street: "Orwell",       captain: "Unassigned",      forms: 9,  status: "Good"        },
  { id: 11, street: "Nottingham",   captain: "Kerstin",         forms: 8,  status: "In Progress" },
  { id: 12, street: "Leicester",    captain: "Unassigned",      forms: 8,  status: "In Progress" },
  { id: 13, street: "Panther",      captain: "Paul Arokiam",    forms: 8,  status: "In Progress" },
  { id: 14, street: "Nile",         captain: "Unassigned",      forms: 7,  status: "In Progress" },
  { id: 15, street: "Phoenix",      captain: "Unassigned",      forms: 7,  status: "In Progress" },
  { id: 16, street: "Ernest",       captain: "Unassigned",      forms: 1,  status: "Critical"    },
  { id: 17, street: "Milner",       captain: "Unassigned",      forms: 1,  status: "Critical"    },
  { id: 18, street: "Patrol",       captain: "Unassigned",      forms: 1,  status: "Critical"    },
  { id: 19, street: "Mildura",      captain: "Garren / Feroze", forms: 0,  status: "Critical"    },
  { id: 20, street: "Earls Court",  captain: "Unassigned",      forms: 0,  status: "Critical"    },
];

// Streets shown in the commitment + captain application forms.
// "Earls Court" is a complex located on Nile Street, Kensington — tracked as its own area.
const STREET_OPTIONS: { value: string; label: string }[] = [
  { value: "Derby",        label: "Derby" },
  { value: "Earls Court",  label: "Earls Court (complex on Nile St)" },
  { value: "Ernest",       label: "Ernest" },
  { value: "Highlands",    label: "Highlands" },
  { value: "Leicester",    label: "Leicester" },
  { value: "Mildura",      label: "Mildura" },
  { value: "Milner",       label: "Milner" },
  { value: "Nile",         label: "Nile" },
  { value: "Nottingham",   label: "Nottingham" },
  { value: "Nymphe",       label: "Nymphe" },
  { value: "Ocean",        label: "Ocean" },
  { value: "Onyx",         label: "Onyx" },
  { value: "Orion",        label: "Orion" },
  { value: "Orwell",       label: "Orwell" },
  { value: "Osprey",       label: "Osprey" },
  { value: "Panther",      label: "Panther" },
  { value: "Patrol",       label: "Patrol" },
  { value: "Phoenix",      label: "Phoenix" },
  { value: "Protea",       label: "Protea" },
  { value: "Westmoreland", label: "Westmoreland" },
  { value: "Other",        label: "My street is not listed" },
];

const faqs = [
  { q: "What is the KCEA enclosure project?", a: "The Kensington Central Enclosure Association (KCEA) is a resident-led initiative to secure our neighbourhood through controlled access points, LPR cameras, and armed response integration. We are applying to the City of Johannesburg under the Security Access Restriction Policy 2018. The project is entirely community-funded and community-driven." },
  { q: "How much does it cost per household?", a: "R250 per month on an ongoing basis, or R3,000 as a once-off upfront payment (equivalent to 12 months paid in advance). The R250 is a permanent monthly levy — it funds Phase 1 right now (consultant, Traffic Impact Study, Council application) and then continues after installation to cover ongoing security staffing, maintenance, and monitoring. Speak to your street captain if cost is a concern." },
  { q: "How many households have committed so far?", a: "191 households as of 19 May 2026, generating approximately R47,750 per month. Our target is 680+ households." },
  { q: "What is the timeline for the enclosure to be built?", a: "Phase 1 (now–5 months): Raise R200,000 for the consultant, Traffic Impact Study, and application. Phase 2 (5–8 months): City approval and raise remaining R1.8 million. Phase 3 (8–11 months): Install gates, cameras, and armed response — go live." },
  { q: "How does the application process work?", a: "We apply under the CoJ Security Access Restriction Policy 2018 via the JRA. Requirements: 60% property owner consent, a Traffic Impact Study, and full financial backing." },
  { q: "Will the enclosure close all streets?", a: "No — boom gates will be installed at key entry and exit points only. Emergency vehicles, Pikitup, and public transport maintain access at all times. Pedestrian access is legally required at every point and will be provided." },
  { q: "Can I pay monthly or as a lump sum?", a: "Both. R250/month ongoing, or R3,000 once-off (equivalent to 12 months in advance). Paying upfront gives us a lump sum to kickstart Phase 1 faster. Submit the form and your street captain will be in touch with payment details." },
  { q: "What if I don't want to commit financially?", a: "The project depends on community funding. If you're not ready, you can still help by sharing this site, supporting your street captain, or volunteering as a captain yourself." },
  { q: "Is there a street captain for my street?", a: "Most streets are listed above. If yours shows 'Assigned' or is missing, email Jomartins111@gmail.com or use the volunteer form to step up." },
  { q: "How do I know my payment was received?", a: "Email proof of payment to Jomartins111@gmail.com with your name and street in the subject line. Your street captain will confirm receipt." }
];

export default function Home() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [duplicateNotice, setDuplicateNotice] = useState<string>("");
  const [newsletterSubmitted, setNewsletterSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "", email: "", phone: "", street: "", houseNumber: "", commitmentType: "monthly",
  });
  const [customStreet, setCustomStreet] = useState("");
  const [captainAppSubmitted, setCaptainAppSubmitted] = useState(false);
  const [captainAppForm, setCaptainAppForm] = useState({
    fullName: "", street: "", phone: "", email: "", motivation: "",
  });
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{
    found: boolean;
    paymentConfirmed?: boolean;
    incomplete?: boolean;
    count?: number;
    names?: string[];
    records?: { name: string; street: string; houseNumber: string; paymentConfirmed: boolean; incomplete: boolean }[];
  } | null>(null);

  const { toast } = useToast();

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = lookupQuery.trim();
    if (q.length < 2) return;
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const res = await fetch(`${BASE}/api/commitments/lookup?q=${encodeURIComponent(q)}`);
      const data = await res.json() as { found: boolean; paymentConfirmed?: boolean; incomplete?: boolean; count?: number; names?: string[]; records?: { name: string; street: string; houseNumber: string; paymentConfirmed: boolean; incomplete: boolean }[] };
      setLookupResult(data);
    } catch {
      toast({ title: "Lookup failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setLookupLoading(false);
    }
  };

  const { data: stats = DEFAULT_STATS } = useQuery<SiteStats>({
    queryKey: ["stats"],
    queryFn: () => fetch(`${BASE}/api/stats`).then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: captains = DEFAULT_CAPTAINS } = useQuery<StreetCaptain[]>({
    queryKey: ["captains"],
    queryFn: () => fetch(`${BASE}/api/captains`).then(r => r.json()),
    staleTime: 30_000,
  });

  const { data: pledgeTotal } = useQuery<{ total: number }>({
    queryKey: ["pledge-total"],
    queryFn: () => fetch(`${BASE}/api/pledges/total`).then(r => r.json()),
    staleTime: 30_000,
  });

  // Per-street committed counts and totals derived from /api/captains (one row per captain).
  // Co-captain streets have multiple rows, so we group by street: max target, sum committed (same
  // count is reported on every row for a street so we just take the max), and join captain names.
  const streetCommittedCounts: Record<string, number> = {};
  const streetTargets: Record<string, number> = {};
  const streetGroups: Array<{ street: string; captains: string; status: string; targetHouseholds: number }> = [];
  const streetIndex: Record<string, number> = {};
  for (const c of captains) {
    streetCommittedCounts[c.street] = Math.max(streetCommittedCounts[c.street] ?? 0, c.committedHouseholds ?? 0);
    streetTargets[c.street] = Math.max(streetTargets[c.street] ?? 0, c.targetHouseholds ?? 30);
    const idx = streetIndex[c.street];
    if (idx === undefined) {
      streetIndex[c.street] = streetGroups.length;
      streetGroups.push({ street: c.street, captains: c.captain, status: c.status, targetHouseholds: streetTargets[c.street] });
    } else {
      const g = streetGroups[idx]!;
      if (c.captain && !g.captains.split(" & ").includes(c.captain)) {
        g.captains = `${g.captains} & ${c.captain}`;
      }
      g.targetHouseholds = streetTargets[c.street];
    }
  }
  // Show the raw total of all submissions (matches the admin Submissions tab count).
  // The per-street breakdown above is still used for the street roster cards, but the
  // public headline number must include every submission, even those for streets that
  // don't yet have a captain row.
  const totalCommittedHouseholds = stats.committedHouseholds;
  const totalTargetHouseholds = Object.values(streetTargets).reduce((a, b) => a + b, 0);
  const overallPct = totalTargetHouseholds > 0
    ? Math.min(100, Math.round((totalCommittedHouseholds / totalTargetHouseholds) * 100))
    : 0;

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isOther = formData.street === "Other";
    const resolvedStreet = isOther ? customStreet.trim() : formData.street;
    if (isOther && !resolvedStreet) {
      toast({ title: "Please type your street name", variant: "destructive" });
      return;
    }
    setDuplicateNotice("");
    try {
      const res = await fetch(`${BASE}/api/commitments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, street: resolvedStreet }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setDuplicateNotice(data.message ?? "It looks like you've already signed up.");
        return;
      }
      if (!res.ok) throw new Error("Server error");
    } catch {
      toast({ title: "Submission failed", description: "Please try again or contact your street captain.", variant: "destructive" });
      return;
    }
    setFormSubmitted(true);
    toast({
      title: "Commitment received!",
      description: "Thank you for supporting the KCEA project. We will be in touch.",
    });
  };

  const handleCaptainAppSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch(`${BASE}/api/captains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(captainAppForm),
      });
    } catch {
      // silently ignore network errors
    }
    setCaptainAppSubmitted(true);
    toast({
      title: "Thanks for putting your hand up!",
      description: "The KCEA committee will be in touch shortly.",
    });
  };

  const handleNewsletterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setNewsletterSubmitted(true);
    toast({
      title: "Subscribed!",
      description: "You've been added to our mailing list.",
    });
  };

  const getStatusColor = (status: string) => {
    if (status === "Strong" || status === "Good") return "bg-green-500/20 text-green-400 hover:bg-green-500/30";
    if (status === "Solid" || status === "Steady") return "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30";
    if (status === "In Progress") return "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30";
    if (status === "Re-engaged") return "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30";
    return "bg-red-500/20 text-red-400 hover:bg-red-500/30";
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      setIsMobileMenuOpen(false);
    }
  };

  const fmtRand = (n: number) => {
    if (n >= 1000) return `R${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
    return `R${n.toLocaleString()}`;
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground dark font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight" data-testid="logo-brand">
            <Shield className="h-6 w-6" />
            KCEA
          </div>
          
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <button onClick={() => scrollTo('project')} data-testid="link-nav-project" className="hover:text-primary transition-colors">Project</button>
            <button onClick={() => scrollTo('progress')} data-testid="link-nav-progress" className="hover:text-primary transition-colors">Progress</button>
            <button onClick={() => scrollTo('captains')} data-testid="link-nav-captains" className="hover:text-primary transition-colors">Captains</button>
            <button onClick={() => scrollTo('faq')} data-testid="link-nav-faq" className="hover:text-primary transition-colors">FAQ</button>
            <a href="/captain" className="text-sm hover:text-primary transition-colors text-muted-foreground">Captain Login</a>
            <Button onClick={() => scrollTo('commit')} data-testid="button-nav-commit" size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">Commit Now</Button>
          </nav>

          <button data-testid="button-mobile-menu" className="md:hidden text-foreground" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background px-4 py-4 space-y-4">
            <button onClick={() => scrollTo('project')} data-testid="link-mobile-project" className="block w-full text-left py-2 text-muted-foreground hover:text-primary">Project</button>
            <button onClick={() => scrollTo('progress')} data-testid="link-mobile-progress" className="block w-full text-left py-2 text-muted-foreground hover:text-primary">Progress</button>
            <button onClick={() => scrollTo('captains')} data-testid="link-mobile-captains" className="block w-full text-left py-2 text-muted-foreground hover:text-primary">Captains</button>
            <button onClick={() => scrollTo('faq')} data-testid="link-mobile-faq" className="block w-full text-left py-2 text-muted-foreground hover:text-primary">FAQ</button>
            <a href="/captain" className="block w-full text-left py-2 text-muted-foreground hover:text-primary text-sm">Captain Login</a>
            <Button onClick={() => scrollTo('commit')} data-testid="button-mobile-commit" className="w-full bg-primary text-primary-foreground">Commit Now</Button>
          </div>
        )}
      </header>

      <main className="container mx-auto px-4 py-12 space-y-24">
        
        {/* Hero Section */}
        <section id="project" className="grid lg:grid-cols-2 gap-12 items-center min-h-[60vh] pt-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-6"
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-accent/10 text-accent border-accent/20">Action Required</Badge>
              <span className="text-sm text-muted-foreground">Kensington Central Enclosure</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tighter">
              Securing our <span className="text-primary">streets</span>,<br />protecting our <span className="text-primary">families</span>.
            </h1>
            <p className="text-lg text-muted-foreground max-w-lg">
              The KCEA is a resident-led community safety project installing a secure boundary with controlled access points around our neighbourhood.
            </p>
            <div className="flex flex-wrap gap-4 pt-4">
              <Button onClick={() => scrollTo('commit')} data-testid="button-hero-commit" size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                Commit Your Household
              </Button>
              <Button asChild data-testid="button-hero-pledge" size="lg" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10 gap-2">
                <a href={`${BASE}/pledge`}><Heart className="h-4 w-4" /> Make a Pledge</a>
              </Button>
              <Button onClick={() => scrollTo('faq')} data-testid="button-hero-faq" size="lg" variant="outline" className="border-card-border hover:bg-card">
                Read the FAQ
              </Button>
            </div>
            <div className="flex items-center gap-8 pt-8 border-t border-border">
              <div>
                <p className="text-3xl font-bold text-foreground">{totalCommittedHouseholds}</p>
                <p className="text-sm text-muted-foreground">Households</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">R200k</p>
                <p className="text-sm text-muted-foreground">Phase 1 Target</p>
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="bg-card border-card-border shadow-xl">
              <CardContent className="p-8 space-y-6">
                <h3 className="text-2xl font-bold">What We're Building</h3>
                <ul className="space-y-4">
                  {[
                    "Secure boundary infrastructure",
                    "Controlled access points",
                    "Armed response integration",
                    "Dedicated monitoring team",
                    "Increased property values"
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-muted-foreground">
                      <div className="bg-primary/20 p-1 rounded-full text-primary">
                        <Check className="h-4 w-4" />
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        </section>

        {/* Progress Section */}
        <section id="progress" className="space-y-12">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold">Project Progress</h2>
            <p className="text-muted-foreground">We need approximately {totalTargetHouseholds}+ households to fully fund Phase 1 and the infrastructure. Every commitment brings us closer.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Card className="bg-card border-card-border">
              <CardContent className="p-6 flex flex-col items-center text-center space-y-2">
                <Users className="h-8 w-8 text-primary mb-2" />
                <h4 className="text-3xl font-bold">{totalCommittedHouseholds}<span className="text-base text-muted-foreground font-normal"> / {totalTargetHouseholds}</span></h4>
                <p className="text-sm text-muted-foreground">Committed Households ({overallPct}%)</p>
                <Progress value={overallPct} className="h-1.5 w-full mt-1" />
              </CardContent>
            </Card>
            <Card className="bg-card border-card-border relative overflow-hidden">
              <CardContent className="p-6 flex flex-col items-center text-center space-y-2">
                <TrendingUp className="h-8 w-8 text-primary mb-2" />
                <h4 className="text-3xl font-bold">{fmtRand(stats.monthlyContributions)}</h4>
                <p className="text-sm text-muted-foreground">Monthly Contributions</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-card-border">
              <CardContent className="p-6 flex flex-col items-center text-center space-y-2">
                <Shield className="h-8 w-8 text-primary mb-2" />
                <h4 className="text-3xl font-bold">R200k</h4>
                <p className="text-sm text-muted-foreground">Phase 1 Target</p>
              </CardContent>
            </Card>
          </div>

          {(pledgeTotal?.total ?? 0) > 0 && (
            <div className="flex justify-center">
              <a
                href={`${BASE}/pledge`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium hover:bg-primary/15 transition-colors"
                data-testid="link-pledge-total"
              >
                <Heart className="h-4 w-4" />
                {fmtRand(pledgeTotal?.total ?? 0)} pledged in donations
                <span className="text-muted-foreground font-normal">— add yours</span>
              </a>
            </div>
          )}

          <Card className="bg-card border-card-border">
            <CardContent className="p-8 space-y-6">
              <div className="flex justify-between items-end">
                <div>
                  <h3 className="text-xl font-bold">Phase 1 Funding</h3>
                  <p className="text-sm text-muted-foreground">Consultant & Application Fees</p>
                </div>
                <span className="text-2xl font-bold text-primary">{stats.fundingPercent}%</span>
              </div>
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: "100%" }}
                viewport={{ once: true }}
              >
                <Progress value={stats.fundingPercent} className="h-3 bg-background" data-testid="progress-funding" />
              </motion.div>
              
              <div className="grid md:grid-cols-3 gap-8 pt-8">
                <div className="space-y-2">
                  <Badge variant="outline" className="bg-primary/20 text-primary border-primary/20">Current</Badge>
                  <h4 className="font-bold">Phase 1 (4-6 months)</h4>
                  <p className="text-sm text-muted-foreground">Traffic impact study & JRA council application.</p>
                </div>
                <div className="space-y-2">
                  <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">Upcoming</Badge>
                  <h4 className="font-bold">Phase 2 (3-6 months)</h4>
                  <p className="text-sm text-muted-foreground">Securing full funding for physical infrastructure.</p>
                </div>
                <div className="space-y-2">
                  <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">Future</Badge>
                  <h4 className="font-bold">Phase 3 (2-3 months)</h4>
                  <p className="text-sm text-muted-foreground">Installation of gates, cameras, and booms.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Commitment Section */}
        <section id="commit" className="space-y-12">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold">Make Your Commitment</h2>
            <p className="text-muted-foreground">Join {totalCommittedHouseholds} of your neighbours. We offer both monthly and once-off contribution options.</p>
          </div>

          {/* Where your money goes — transparency explainer */}
          <Card className="bg-card border-card-border max-w-4xl mx-auto" data-testid="card-payment-explainer">
            <CardContent className="p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-6 w-6 text-accent shrink-0" />
                <h3 className="text-xl font-bold">Where your contribution goes — and what you're signing up for</h3>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-background/50 border border-border rounded-lg p-4 space-y-2">
                  <h4 className="font-semibold text-foreground flex items-center gap-2"><span className="text-primary">R250 / month</span> — what it pays for right now</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Your monthly contribution is being collected <strong className="text-foreground">immediately</strong> to fund Phase&nbsp;1: the consultant
                    fees, the Traffic Impact Study, and the Council application. It is <strong className="text-foreground">not</strong> sitting
                    aside waiting for hardware — it is actively paying to get the project approved.
                  </p>
                </div>

                <div className="bg-background/50 border border-border rounded-lg p-4 space-y-2">
                  <h4 className="font-semibold text-foreground flex items-center gap-2"><span className="text-primary">R3,000 once-off</span> — why it helps</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    The once-off option gives us a lump sum to <strong className="text-foreground">kickstart Phase&nbsp;1 faster</strong>.
                    It's equivalent to 12 months of R250 paid in advance, so the same contribution, just sooner — which means we reach
                    the consultant and application milestones quicker.
                  </p>
                </div>

                <div className="bg-background/50 border border-border rounded-lg p-4 space-y-2">
                  <h4 className="font-semibold text-foreground">R250 / month is an <span className="text-primary">ongoing levy</span></h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Even <strong className="text-foreground">after</strong> the gates and cameras are installed, the R250/month
                    continues. It covers ongoing operational costs — security staffing, maintenance, and monitoring. Please
                    sign up knowing this is a <strong className="text-foreground">permanent monthly commitment</strong>, not a
                    once-off installation fee.
                  </p>
                </div>

              </div>

              <p className="text-xs text-muted-foreground">Questions? Speak to your street captain or email Jomartins111@gmail.com.</p>
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-5 gap-8">
            <Card className="bg-card border-card-border lg:col-span-3">
              <CardContent className="p-4 sm:p-8">
                {!formSubmitted ? (
                  <form onSubmit={handleFormSubmit} className="space-y-6" data-testid="form-commitment">
                    {duplicateNotice && (
                      <div
                        className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200"
                        data-testid="banner-duplicate-submission"
                      >
                        <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
                        <div className="space-y-1">
                          <p className="font-semibold text-amber-300">Already on our list</p>
                          <p className="leading-relaxed">{duplicateNotice}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDuplicateNotice("")}
                          className="ml-auto text-amber-300/70 hover:text-amber-200 text-lg leading-none"
                          aria-label="Dismiss"
                        >×</button>
                      </div>
                    )}
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="fullName">Full Name</Label>
                        <Input id="fullName" required placeholder="John Doe" className="bg-background border-border" data-testid="input-fullname"
                          value={formData.fullName} onChange={e => setFormData(p => ({ ...p, fullName: e.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address</Label>
                        <Input id="email" type="email" required placeholder="john@example.com" className="bg-background border-border" data-testid="input-email"
                          value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone Number</Label>
                        <Input id="phone" type="tel" required placeholder="082 123 4567" className="bg-background border-border" data-testid="input-phone"
                          value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="street">Street Name</Label>
                          <Select required value={formData.street} onValueChange={v => setFormData(p => ({ ...p, street: v }))}>
                            <SelectTrigger id="street" className="bg-background border-border" data-testid="select-street">
                              <SelectValue placeholder="Select street" />
                            </SelectTrigger>
                            <SelectContent>
                              {STREET_OPTIONS.map(o => (
                                <SelectItem key={o.value} value={o.value} data-testid={`select-option-street-${o.value}`}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="houseNumber">House No.</Label>
                          <Input id="houseNumber" required placeholder="42" className="bg-background border-border" data-testid="input-housenumber"
                            value={formData.houseNumber} onChange={e => setFormData(p => ({ ...p, houseNumber: e.target.value }))} />
                        </div>
                      </div>
                      {formData.street === "Other" && (
                        <div className="space-y-2">
                          <Label htmlFor="customStreet">Type your street name</Label>
                          <Input
                            id="customStreet"
                            required
                            placeholder="Type your street name"
                            className="bg-background border-border"
                            data-testid="input-custom-street"
                            value={customStreet}
                            onChange={e => setCustomStreet(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            We'll log this as a new street and follow up with you. Please double-check the spelling.
                          </p>
                        </div>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Commitment Type</Label>
                      <Select required value={formData.commitmentType} onValueChange={v => setFormData(p => ({ ...p, commitmentType: v }))}>
                        <SelectTrigger className="bg-background border-border" data-testid="select-commitment-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly" data-testid="select-option-monthly">R250 per month</SelectItem>
                          <SelectItem value="onceoff" data-testid="select-option-onceoff">R3,000 once-off</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button type="submit" data-testid="button-submit-commitment" className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                      Submit Commitment Form
                    </Button>
                  </form>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-12">
                    <div className="h-16 w-16 bg-primary/20 rounded-full flex items-center justify-center text-primary">
                      <Check className="h-8 w-8" />
                    </div>
                    <h3 className="text-2xl font-bold">Form Submitted</h3>
                    <p className="text-muted-foreground">Thank you! Please proceed with the payment instructions to complete your commitment.</p>
                    <Button variant="outline" onClick={() => setFormSubmitted(false)} data-testid="button-reset-form" className="mt-4 border-card-border">
                      Submit another form
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="lg:col-span-2 space-y-6">
              <Card className="bg-card border-card-border">
                <CardContent className="p-8 space-y-6">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-6 w-6 text-accent" />
                    <h3 className="text-xl font-bold">Payment Details</h3>
                  </div>
                  <div className="bg-background/50 p-4 rounded-lg border border-border text-sm text-muted-foreground leading-relaxed">
                    Bank details will be shared directly by your street captain once your commitment form is submitted.
                  </div>
                  <div className="pt-4 space-y-4">
                    <p className="text-sm text-muted-foreground">After making your payment, please email your proof of payment to us.</p>
                    <Button asChild variant="outline" data-testid="link-email-pop" className="w-full border-card-border hover:bg-background">
                      <a href="mailto:Jomartins111@gmail.com?subject=Proof%20of%20Payment">
                        <Mail className="mr-2 h-4 w-4" />
                        Email Proof of Payment
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Commitment Lookup */}
          <div className="max-w-2xl mx-auto">
            <Card className="bg-card/60 border-border/50 backdrop-blur-sm">
              <CardContent className="p-6 space-y-4">
                <div className="text-center space-y-1">
                  <h3 className="text-lg font-semibold text-foreground">Already Committed? Check Your Status</h3>
                  <p className="text-sm text-muted-foreground">Enter your name or street address to verify your commitment.</p>
                </div>

                <form onSubmit={handleLookup} className="flex gap-2">
                  <Input
                    value={lookupQuery}
                    onChange={e => { setLookupQuery(e.target.value); setLookupResult(null); }}
                    placeholder="e.g. Smith or Derby Road 12"
                    className="bg-background border-border flex-1"
                    minLength={2}
                    required
                  />
                  <Button type="submit" disabled={lookupLoading || lookupQuery.trim().length < 2} className="gap-2 shrink-0">
                    {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Check
                  </Button>
                </form>

                {lookupResult && (
                  lookupResult.found && lookupResult.count && lookupResult.count > 1 ? (
                    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3 text-sm">
                      <p className="font-medium text-foreground">
                        We found {lookupResult.count} records matching your search — please identify which is yours:
                      </p>
                      <div className="space-y-2">
                        {lookupResult.records?.map((r, i) => (
                          <div key={i} className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 border ${
                            r.paymentConfirmed
                              ? "bg-green-500/10 border-green-500/30"
                              : "bg-amber-500/10 border-amber-500/30"
                          }`}>
                            <span>
                              <span className="font-medium">{r.name}</span>
                              <span className="text-muted-foreground"> — {r.street}, No. {r.houseNumber}</span>
                            </span>
                            <span className={`text-xs font-medium shrink-0 ${r.paymentConfirmed ? "text-green-400" : "text-amber-400"}`}>
                              {r.paymentConfirmed ? "✓ Confirmed" : r.incomplete ? "⚠ Incomplete" : "⚠ Pending"}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">If your record shows as pending, your street captain will be in touch about payment details.</p>
                    </div>
                  ) : (
                    <div className={`rounded-lg px-4 py-3 flex items-start gap-3 text-sm border ${
                      !lookupResult.found
                        ? "bg-red-500/10 border-red-500/30 text-red-300"
                        : lookupResult.incomplete
                          ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                          : lookupResult.paymentConfirmed
                            ? "bg-green-500/10 border-green-500/30 text-green-300"
                            : "bg-amber-500/10 border-amber-500/30 text-amber-300"
                    }`}>
                      <span className="text-base leading-none mt-0.5">
                        {!lookupResult.found ? "✗" : lookupResult.incomplete ? "⚠" : lookupResult.paymentConfirmed ? "✓" : "⚠"}
                      </span>
                      <div className="space-y-1">
                        <p className="font-medium">
                          {!lookupResult.found
                            ? "We don't have a record for you."
                            : lookupResult.incomplete
                              ? "We have a partial record for your address, but some details are missing."
                              : lookupResult.paymentConfirmed
                                ? "You're on the list — thank you for your commitment!"
                                : "We have your name but no payment recorded yet."}
                        </p>
                        <p className="text-xs opacity-80">
                          {!lookupResult.found
                            ? "Please submit the commitment form above or contact your street captain."
                            : lookupResult.incomplete
                              ? "Please contact your street captain or email jomartins111@gmail.com to complete your registration."
                              : lookupResult.paymentConfirmed
                                ? `Found: ${lookupResult.names?.join("; ")}`
                                : "Your street captain will be in touch to confirm payment."}
                        </p>
                      </div>
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Street Captains Section */}
        <section id="captains" className="space-y-12">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold">Street Captains</h2>
            <p className="text-muted-foreground">Connect with your street captain to submit forms or ask questions. Want to volunteer? Let us know.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {streetGroups.map((street, i) => (
              <motion.div
                key={street.street}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="bg-card border-card-border h-full">
                  <CardContent className="p-5 flex flex-col h-full justify-between gap-4">
                    <div className="space-y-1">
                      <h4 className="font-bold text-lg">{street.street}</h4>
                      {street.street === "Earls Court" && (
                        <p className="text-xs text-muted-foreground/80 italic">Complex on Nile St</p>
                      )}
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" /> {street.captains}
                      </p>
                    </div>
                    <div className="space-y-2 mt-auto">
                      {(() => {
                        const target = street.targetHouseholds ?? 30;
                        const committed = streetCommittedCounts[street.street] ?? 0;
                        const pct = target > 0 ? Math.min(100, Math.round((committed / target) * 100)) : 0;
                        return (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{committed} of {target} households</span>
                              <Badge className={getStatusColor(street.status)} variant="secondary" data-testid={`badge-status-${street.street}`}>
                                {street.status}
                              </Badge>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Become a Street Captain Section */}
        <section id="volunteer" className="max-w-3xl mx-auto">
          <div className="text-center space-y-4 mb-10">
            <Badge className="bg-primary/20 text-primary border-primary/20" variant="outline">Get Involved</Badge>
            <h2 className="text-3xl md:text-4xl font-bold">Become a Street Captain</h2>
            <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
              Street captains do door-to-door visits, answer neighbour questions, and report commitment numbers back to the committee. It takes about 2–3 hours per month.
            </p>
          </div>

          <Card className="bg-card border-card-border">
            <CardContent className="p-8">
              {captainAppSubmitted ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-10 space-y-4"
                >
                  <div className="flex justify-center">
                    <div className="bg-primary/20 rounded-full p-5">
                      <Check className="h-10 w-10 text-primary" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold">Thanks for putting your hand up!</h3>
                  <p className="text-muted-foreground max-w-sm mx-auto">
                    The KCEA committee will reach out to you shortly to discuss next steps.
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleCaptainAppSubmit} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="cap-fullName">Full Name</Label>
                      <Input
                        id="cap-fullName"
                        required
                        placeholder="Jane Dlamini"
                        className="bg-background border-border"
                        value={captainAppForm.fullName}
                        onChange={e => setCaptainAppForm(p => ({ ...p, fullName: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cap-street">Street You Want to Captain</Label>
                      <Select required value={captainAppForm.street} onValueChange={v => setCaptainAppForm(p => ({ ...p, street: v }))}>
                        <SelectTrigger id="cap-street" className="bg-background border-border" data-testid="select-cap-street">
                          <SelectValue placeholder="Select street" />
                        </SelectTrigger>
                        <SelectContent>
                          {STREET_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cap-phone">Cell Number</Label>
                      <Input
                        id="cap-phone"
                        type="tel"
                        required
                        placeholder="082 123 4567"
                        className="bg-background border-border"
                        value={captainAppForm.phone}
                        onChange={e => setCaptainAppForm(p => ({ ...p, phone: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cap-email">Email Address</Label>
                      <Input
                        id="cap-email"
                        type="email"
                        required
                        placeholder="jane@example.com"
                        className="bg-background border-border"
                        value={captainAppForm.email}
                        onChange={e => setCaptainAppForm(p => ({ ...p, email: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cap-motivation">
                      Why do you want to help? <span className="text-muted-foreground text-xs">(optional)</span>
                    </Label>
                    <Textarea
                      id="cap-motivation"
                      placeholder="Tell us a little about why you'd like to get involved…"
                      rows={3}
                      className="bg-background border-border resize-none"
                      value={captainAppForm.motivation}
                      onChange={e => setCaptainAppForm(p => ({ ...p, motivation: e.target.value }))}
                    />
                  </div>
                  <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-base font-semibold">
                    <Shield className="mr-2 h-5 w-5" />
                    Apply to Become a Street Captain
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="space-y-12 max-w-4xl mx-auto">
          <div className="text-center space-y-4">
            <h2 className="text-3xl md:text-4xl font-bold">Frequently Asked Questions</h2>
            <p className="text-muted-foreground">Everything you need to know about the KCEA project.</p>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border-border">
                <AccordionTrigger data-testid={`button-faq-${i}`} className="text-left hover:text-primary transition-colors py-4">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed pb-6">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* Newsletter & Contact */}
        <section className="grid lg:grid-cols-2 gap-8 border-t border-border pt-24 pb-12">
          <div className="space-y-6">
            <h3 className="text-2xl font-bold">Stay Updated</h3>
            <p className="text-muted-foreground">Join our mailing list to receive project updates, meeting notices, and important announcements.</p>
            {!newsletterSubmitted ? (
              <form onSubmit={handleNewsletterSubmit} className="flex gap-2" data-testid="form-newsletter">
                <Input required type="email" placeholder="Your email address" data-testid="input-newsletter-email" className="bg-card border-card-border" />
                <Button type="submit" data-testid="button-submit-newsletter" className="bg-primary text-primary-foreground hover:bg-primary/90">Subscribe</Button>
              </form>
            ) : (
              <div className="flex items-center gap-2 text-primary font-medium p-3 bg-primary/10 rounded-md border border-primary/20">
                <Check className="h-5 w-5" />
                Thanks for subscribing!
              </div>
            )}
          </div>
          
          <div className="space-y-6 lg:pl-12 lg:border-l border-border">
            <h3 className="text-2xl font-bold">Contact Us</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Mail className="h-5 w-5 text-primary" />
                <a href="mailto:Jomartins111@gmail.com" className="hover:text-primary transition-colors">Jomartins111@gmail.com</a>
              </div>
              <div className="flex items-center gap-3 text-muted-foreground">
                <MapPin className="h-5 w-5 text-primary" />
                <span>Meetings: 5 Osprey Street</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card py-8">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 text-primary font-bold">
            <Shield className="h-5 w-5" />
            KCEA
          </div>
          <p>© 2026 Kensington Central Enclosure Association. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
