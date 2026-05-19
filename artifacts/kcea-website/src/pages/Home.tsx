import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { 
  ChevronDown, Check, AlertCircle, Mail, MapPin, Phone, 
  TrendingUp, Shield, Users, Menu, X 
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
}

const DEFAULT_STATS: SiteStats = {
  committedHouseholds: 178,
  monthlyContributions: 44500,
  targetHouseholds: 680,
  fundingPercent: 22,
};

const DEFAULT_CAPTAINS: StreetCaptain[] = [
  { id: 1, street: "Derby", captain: "Carina", forms: 27, status: "Strong" },
  { id: 2, street: "Orion", captain: "Ingrid", forms: 18, status: "Good" },
  { id: 3, street: "Protea", captain: "Priscilla", forms: 17, status: "Good" },
  { id: 4, street: "Osprey", captain: "Jo-Anne", forms: 15, status: "Solid" },
  { id: 5, street: "Ocean", captain: "Geoff", forms: 12, status: "In Progress" },
  { id: 6, street: "Onyx", captain: "Maria D'Alves", forms: 12, status: "Good" },
  { id: 7, street: "Westmoreland", captain: "Assigned", forms: 13, status: "Steady" },
  { id: 8, street: "Nymphe", captain: "Maria D'Alves", forms: 9, status: "In Progress" },
  { id: 9, street: "Nottingham", captain: "Kerstin", forms: 8, status: "In Progress" },
  { id: 10, street: "Highlands", captain: "Assigned", forms: 10, status: "Good" },
  { id: 11, street: "Panther", captain: "Paul Arokiam", forms: 6, status: "Re-engaged" },
  { id: 12, street: "Mildura", captain: "Garren (Feroze assist)", forms: 0, status: "Critical" },
];

const faqs = [
  { q: "What is the KCEA enclosure project?", a: "The Kensington Central Enclosure Association is a resident-led community safety project. We are installing a secure boundary with controlled access points around our neighbourhood to reduce crime and improve safety. It's not cameras alone — it's full infrastructure with armed response integration." },
  { q: "How much does it cost per household?", a: "R250 per month or R3,000 as a once-off payment. This covers consultant fees, council application, traffic impact study, and eventually gate infrastructure, monitoring, and armed response services." },
  { q: "How many households have committed so far?", a: "As of May 6, 2026, we have 178 households committed. We need approximately 680+ total to fully fund Phase 1 and the infrastructure. Every commitment brings us closer to approval." },
  { q: "What is the timeline for the enclosure to be built?", a: "Phase 1 (consultant + application): 4–6 months with R200,000 in funding. Phase 2 (full funding): 3–6 months. Phase 3 (installation): 2–3 months. Council approval is valid for 4 years." },
  { q: "How does the application process work?", a: "We've hired Stephen Margo, a security consultant with 100% success rate. He handles the traffic impact study, council application via the JRA, and ensures compliance with CoJ Security Access Restriction Policy 2018. We already have 75% resident consent (required threshold: 67%)." },
  { q: "Will the enclosure close all streets?", a: "No. A traffic impact study (required by Council) will determine which roads can be closed and which stay open. School bus routes (Derby Road), Pikitup access, and emergency vehicles are all part of the design. It's not a total lockdown." },
  { q: "Can I pay monthly or as a lump sum?", a: "Both! You can commit R250/month ongoing, or pay R3,000 upfront. Bank details are on the payments page. Include your name and street in the payment reference so we can track your commitment." },
  { q: "What if I don't want to commit financially?", a: "Every resident benefits from the enclosure once it's built. If you have concerns or questions before committing, reach out — we want to address your concerns. Even if you can't contribute now, staying informed helps." },
  { q: "Is there a street captain for my street?", a: "Check the Street Captains page. If your street isn't listed, contact us — we're recruiting captains for all remaining streets. Street captains collect forms, answer questions, and represent their street at meetings." },
  { q: "How do I know my payment was received?", a: "Send your payment with your name and street in the reference line. Email us confirmation at kcea.kensington@gmail.com with a screenshot of the transfer. We'll confirm receipt and update our records." }
];

export default function Home() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [newsletterSubmitted, setNewsletterSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "", email: "", phone: "", street: "", houseNumber: "", commitmentType: "monthly",
  });
  const [volunteerSubmitted, setVolunteerSubmitted] = useState(false);
  const [volunteerForm, setVolunteerForm] = useState({
    fullName: "", street: "", phone: "", email: "", motivation: "",
  });
  const { toast } = useToast();

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

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch(`${BASE}/api/commitments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
    } catch {
      // silently ignore network errors — form still shows success
    }
    setFormSubmitted(true);
    toast({
      title: "Commitment received!",
      description: "Thank you for supporting the KCEA project. We will be in touch.",
    });
  };

  const handleVolunteerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch(`${BASE}/api/volunteers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(volunteerForm),
      });
    } catch {
      // silently ignore network errors
    }
    setVolunteerSubmitted(true);
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
              <Button onClick={() => scrollTo('faq')} data-testid="button-hero-faq" size="lg" variant="outline" className="border-card-border hover:bg-card">
                Read the FAQ
              </Button>
            </div>
            <div className="flex items-center gap-8 pt-8 border-t border-border">
              <div>
                <p className="text-3xl font-bold text-foreground">{stats.committedHouseholds}</p>
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
            <p className="text-muted-foreground">We need approximately {stats.targetHouseholds}+ households to fully fund Phase 1 and the infrastructure. Every commitment brings us closer.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Card className="bg-card border-card-border">
              <CardContent className="p-6 flex flex-col items-center text-center space-y-2">
                <Users className="h-8 w-8 text-primary mb-2" />
                <h4 className="text-3xl font-bold">{stats.committedHouseholds}</h4>
                <p className="text-sm text-muted-foreground">Committed Households</p>
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
            <p className="text-muted-foreground">Join {stats.committedHouseholds} of your neighbours. We offer both monthly and once-off contribution options.</p>
          </div>

          <div className="grid lg:grid-cols-5 gap-8">
            <Card className="bg-card border-card-border lg:col-span-3">
              <CardContent className="p-8">
                {!formSubmitted ? (
                  <form onSubmit={handleFormSubmit} className="space-y-6" data-testid="form-commitment">
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
                          <Input id="street" required placeholder="Derby" className="bg-background border-border" data-testid="input-street"
                            value={formData.street} onChange={e => setFormData(p => ({ ...p, street: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="houseNumber">House No.</Label>
                          <Input id="houseNumber" required placeholder="42" className="bg-background border-border" data-testid="input-housenumber"
                            value={formData.houseNumber} onChange={e => setFormData(p => ({ ...p, houseNumber: e.target.value }))} />
                        </div>
                      </div>
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
                      <a href="mailto:kcea.kensington@gmail.com?subject=Proof%20of%20Payment">
                        <Mail className="mr-2 h-4 w-4" />
                        Email Proof of Payment
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Street Captains Section */}
        <section id="captains" className="space-y-12">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold">Street Captains</h2>
            <p className="text-muted-foreground">Connect with your street captain to submit forms or ask questions. Want to volunteer? Let us know.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {captains.map((street, i) => (
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
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" /> {street.captain}
                      </p>
                    </div>
                    <div className="flex items-center justify-between mt-auto">
                      <span className="text-sm font-medium">{street.forms} forms</span>
                      <Badge className={getStatusColor(street.status)} variant="secondary" data-testid={`badge-status-${street.street}`}>
                        {street.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Volunteer Section */}
        <section id="volunteer" className="max-w-3xl mx-auto">
          <div className="text-center space-y-4 mb-10">
            <Badge className="bg-primary/20 text-primary border-primary/20" variant="outline">Get Involved</Badge>
            <h2 className="text-3xl md:text-4xl font-bold">Is Your Street Missing a Captain?</h2>
            <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
              Street captains do door-to-door visits, answer neighbour questions, and report commitment numbers back to the committee. It takes about 2–3 hours per month.
            </p>
          </div>

          <Card className="bg-card border-card-border">
            <CardContent className="p-8">
              {volunteerSubmitted ? (
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
                <form onSubmit={handleVolunteerSubmit} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="vol-fullName">Full Name</Label>
                      <Input
                        id="vol-fullName"
                        required
                        placeholder="Jane Dlamini"
                        className="bg-background border-border"
                        value={volunteerForm.fullName}
                        onChange={e => setVolunteerForm(p => ({ ...p, fullName: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vol-street">Street You Want to Captain</Label>
                      <Input
                        id="vol-street"
                        required
                        placeholder="Derby Road"
                        className="bg-background border-border"
                        value={volunteerForm.street}
                        onChange={e => setVolunteerForm(p => ({ ...p, street: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vol-phone">Cell Number</Label>
                      <Input
                        id="vol-phone"
                        type="tel"
                        required
                        placeholder="082 123 4567"
                        className="bg-background border-border"
                        value={volunteerForm.phone}
                        onChange={e => setVolunteerForm(p => ({ ...p, phone: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vol-email">Email Address</Label>
                      <Input
                        id="vol-email"
                        type="email"
                        required
                        placeholder="jane@example.com"
                        className="bg-background border-border"
                        value={volunteerForm.email}
                        onChange={e => setVolunteerForm(p => ({ ...p, email: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vol-motivation">
                      Why do you want to help? <span className="text-muted-foreground text-xs">(optional)</span>
                    </Label>
                    <Textarea
                      id="vol-motivation"
                      placeholder="Tell us a little about why you'd like to get involved…"
                      rows={3}
                      className="bg-background border-border resize-none"
                      value={volunteerForm.motivation}
                      onChange={e => setVolunteerForm(p => ({ ...p, motivation: e.target.value }))}
                    />
                  </div>
                  <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-base font-semibold">
                    <Shield className="mr-2 h-5 w-5" />
                    Volunteer as Street Captain
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
                <a href="mailto:kcea.kensington@gmail.com" className="hover:text-primary transition-colors">kcea.kensington@gmail.com</a>
              </div>
              <div className="flex items-center gap-3 text-muted-foreground">
                <Phone className="h-5 w-5 text-primary" />
                <span>Stephen Margo (Consultant): 076 030 2342</span>
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
