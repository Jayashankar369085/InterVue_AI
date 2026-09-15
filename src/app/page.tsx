import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mic, ArrowRight, Sparkles, Brain, Target, MessageSquare } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="flex-1 flex flex-col">
      {/* Navbar */}
      <header className="border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            <span className="text-xl font-bold tracking-tight">INTERVUE AI</span>
          </div>
          <nav className="hidden md:flex gap-6">
            <Link href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</Link>
            <Link href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How it works</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/history">
              <Button variant="ghost" className="text-sm">History</Button>
            </Link>
            <Link href="/setup">
              <Button size="sm">Start Interview</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-24 md:py-32 relative overflow-hidden">
        {/* Abstract background gradient */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/20 blur-[120px] rounded-full pointer-events-none -z-10" />
        
        <div className="max-w-4xl mx-auto space-y-8 relative z-10">
          <div className="space-y-4">
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
              Your AI interviewer <br className="hidden md:block" /> for any role.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Practice realistic interviews that adapt to what you actually say — not a fixed list of questions.
            </p>
          </div>

          {/* Quick Start Input */}
          <form action="/setup" className="max-w-xl mx-auto bg-card/50 backdrop-blur-sm border border-white/10 p-2 rounded-2xl flex flex-col md:flex-row gap-2 shadow-2xl">
            <div className="relative flex-1">
              <Input 
                name="q"
                placeholder="I'm preparing for an ML Engineer internship..." 
                className="w-full h-12 bg-transparent border-none focus-visible:ring-0 text-base placeholder:text-muted-foreground/70"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="icon" className="h-12 w-12 shrink-0 rounded-xl" title="Tell me instead">
                <Mic className="w-5 h-5" />
              </Button>
              <Button type="submit" size="lg" className="h-12 rounded-xl shrink-0 px-6 font-semibold">
                Start <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </div>
          </form>
          
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-muted-foreground">
            <p>Or try:</p>
            <div className="flex gap-2">
              <Link href="/setup?q=Software+Engineer" className="px-3 py-1 bg-white/5 rounded-full border border-white/10 cursor-pointer hover:bg-white/10 transition-colors">Software Engineer</Link>
              <Link href="/setup?q=Product+Manager" className="px-3 py-1 bg-white/5 rounded-full border border-white/10 cursor-pointer hover:bg-white/10 transition-colors">Product Manager</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section id="features" className="py-24 bg-black/40 border-t border-white/5">
        <div className="container max-w-6xl mx-auto px-4 grid md:grid-cols-3 gap-8">
          <div className="space-y-4 bg-card/30 p-6 rounded-2xl border border-white/5">
            <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center text-primary">
              <Brain className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold">Adaptive Questioning</h3>
            <p className="text-muted-foreground">The AI listens to your answers and dynamically generates follow-ups to probe your depth of knowledge.</p>
          </div>
          <div className="space-y-4 bg-card/30 p-6 rounded-2xl border border-white/5">
            <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center text-primary">
              <Target className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold">Any Domain</h3>
            <p className="text-muted-foreground">From Machine Learning to Law to Investment Banking, InterVue understands the competencies required.</p>
          </div>
          <div className="space-y-4 bg-card/30 p-6 rounded-2xl border border-white/5">
            <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center text-primary">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold">Voice First</h3>
            <p className="text-muted-foreground">Talk naturally, interrupt when you need to, and experience the pressure of a real conversation.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
