import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import {
  Mic, ArrowRight, Brain, Target, MessageSquare, Sparkles, Play,
} from "lucide-react";

const quickStarts = [
  "ML Engineer",
  "Mechanical Design Engineer",
  "Investment Banking Analyst",
  "History Professor",
  "Cybersecurity Analyst",
];

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-aurora" />
      <SiteNav />

      <main className="relative flex-1">
        {/* Hero */}
        <section className="mx-auto flex max-w-4xl flex-col items-center px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-24">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-3.5 py-1.5 text-xs font-semibold text-brand animate-fade-up">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Any domain · Real conversation · Real feedback
          </span>
          <h1 className="mt-6 text-balance text-4xl font-bold leading-[1.05] tracking-tight text-foreground animate-fade-up sm:text-6xl md:text-7xl" style={{ animationDelay: "60ms" }}>
            Your AI interviewer
            <br />
            <span className="text-gradient">for any role.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground animate-fade-up sm:text-lg" style={{ animationDelay: "120ms" }}>
            Practice realistic interviews that adapt to what you actually say — not a fixed list of questions. Voice-first, domain-aware, brutally honest feedback.
          </p>

          {/* CTA */}
          <div className="mt-9 flex w-full max-w-md flex-col gap-3 animate-fade-up sm:flex-row sm:justify-center" style={{ animationDelay: "180ms" }}>
            <Link
              href="/setup"
              className="group inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-brand to-brand-2 px-7 py-4 text-base font-semibold text-on-accent shadow-glow-brand transition-all duration-300 hover:shadow-glow-strong hover:brightness-110 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Mic className="h-5 w-5 transition-transform group-hover:scale-110" aria-hidden />
              Start practicing
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
            </Link>
            <Link
              href="/history"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface-2 px-7 py-4 text-base font-medium text-foreground transition-all duration-300 hover:border-line-strong hover:bg-surface-3 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Play className="h-4 w-4 text-brand" aria-hidden />
              View past sessions
            </Link>
          </div>

          {/* Quick-start chips */}
          <div className="mt-10 flex flex-col items-center gap-3 text-sm text-muted-foreground animate-fade-up" style={{ animationDelay: "240ms" }}>
            <p>Or try:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {quickStarts.map((s) => (
                <Link
                  key={s}
                  href={`/setup?q=${encodeURIComponent(s)}`}
                  className="rounded-full border border-line bg-surface-2/80 px-3.5 py-1.5 text-[13px] font-medium text-foreground/80 transition-all duration-200 hover:border-brand/50 hover:bg-brand-soft hover:text-brand active:scale-95"
                >
                  {s}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Value props */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                icon: Brain,
                title: "Adaptive questioning",
                body: "The AI listens to your answers and dynamically generates follow-ups to probe your depth of knowledge — strong answers earn harder questions.",
              },
              {
                icon: Target,
                title: "Any domain",
                body: "From Machine Learning to Law to Investment Banking, InterVue builds a competency model for whatever you're preparing for.",
              },
              {
                icon: MessageSquare,
                title: "Voice first",
                body: "Talk naturally, interrupt when you need to, and experience the pressure of a real conversation — with typed answers as a fallback.",
              },
            ].map((f, i) => (
              <div
                key={f.title}
                className="group rounded-3xl border border-line bg-surface p-7 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-glow-brand animate-fade-up"
                style={{ animationDelay: `${300 + i * 80}ms` }}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand transition-transform duration-300 group-hover:scale-110">
                  <f.icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative border-t border-line/60 py-8">
        <p className="text-center text-xs text-muted-foreground">
          InterVue AI · Groq intelligence · AssemblyAI hearing · ElevenLabs voice
        </p>
      </footer>
    </div>
  );
}
