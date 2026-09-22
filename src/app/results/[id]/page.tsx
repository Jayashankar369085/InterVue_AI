"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import {
  ArrowLeft, CheckCircle2, XCircle, TrendingUp, Loader2, AlertCircle, BookOpen,
  Target, MessageSquare, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Report } from "@/types/interview";

const verdictStyles = (v: string) =>
  v === "Strong"
    ? "text-success border-success/30 bg-success-soft"
    : v === "Ok"
      ? "text-warning border-warning/30 bg-warning-soft"
      : "text-error border-error/30 bg-error-soft";

const barColor = (score: number) => (score >= 75 ? "bg-success" : score >= 55 ? "bg-warning" : "bg-error");

/** Animated count-up number — eases to the real value, respects reduced motion. */
function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function ScoreRing({ score }: { score: number }) {
  const shown = useCountUp(score);
  const r = 54;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  return (
    <div className="relative mx-auto h-[150px] w-[150px]">
      <svg width="150" height="150" viewBox="0 0 140 140" className="h-full w-full">
        <circle cx="70" cy="70" r={r} stroke="currentColor" className="text-line" strokeWidth="10" fill="none" />
        <circle
          cx="70" cy="70" r={r} stroke="url(#scoreGrad)" strokeWidth="10" fill="none" strokeLinecap="round"
          className="transition-[stroke-dasharray] duration-1000 ease-out"
          strokeDasharray={`${filled} ${circ - filled}`}
          transform="rotate(-90 70 70)"
        />
        <defs>
          <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <text x="70" y="68" textAnchor="middle" className="fill-foreground text-3xl font-black tabular-nums">{shown}</text>
        <text x="70" y="90" textAnchor="middle" className="fill-muted-foreground text-xs">/ 100</text>
      </svg>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3.5 transition-all duration-300 hover:border-line-strong hover:shadow-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-1 text-sm font-semibold",
        tone === "good" && "text-success",
        tone === "warn" && "text-warning",
        tone === "bad" && "text-error",
        !tone && "text-foreground"
      )}>
        {value}
      </p>
    </div>
  );
}

function SectionCard({ icon, title, description, children, className }: {
  icon: React.ReactNode; title: string; description?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-3xl border border-line bg-surface p-6 shadow-card animate-fade-up sm:p-7", className)}>
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [meta, setMeta] = useState<{ role: string; domain: string; seniority: string; questions: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingPractice, setStartingPractice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Try the stored report first; if absent, generate it now.
        let res = await fetch(`/api/interviews/${id}/report`);
        if (res.status === 404) {
          res = await fetch(`/api/interviews/${id}/report`, { method: "POST" });
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load the report.");
        if (cancelled) return;
        setReport(data.report);
        setMeta({
          role: data.interview.blueprint.role,
          domain: data.interview.blueprint.domain,
          seniority: data.interview.blueprint.seniority,
          questions: data.interview.qa.length,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function startPractice() {
    setStartingPractice(true);
    try {
      const res = await fetch(`/api/interviews/${id}/practice`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the practice session.");
      window.location.href = `/interview/${data.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the practice session.");
      setStartingPractice(false);
    }
  }

  if (loading) {
    return (
      <div className="relative min-h-dvh">
        <div aria-hidden className="pointer-events-none fixed inset-0 bg-aurora" />
        <SiteNav />
        <main className="relative flex min-h-[70vh] flex-col items-center justify-center gap-4">
          <div className="relative">
            <Loader2 className="h-9 w-9 animate-spin text-brand" aria-hidden />
          </div>
          <p className="text-sm font-medium text-muted-foreground">Analyzing your interview…</p>
        </main>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="relative min-h-dvh">
        <div aria-hidden className="pointer-events-none fixed inset-0 bg-aurora" />
        <SiteNav backHref="/history" />
        <main className="relative mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center px-4">
          <div className="w-full rounded-3xl border border-error/30 bg-surface p-10 text-center shadow-card animate-fade-up">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-error-soft text-error">
              <AlertCircle className="h-6 w-6" aria-hidden />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-foreground">Report unavailable</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error || "No report available."}</p>
            <Link
              href="/setup"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-brand to-brand-2 px-5 py-2.5 text-sm font-semibold text-on-accent shadow-glow-brand transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Start a new interview
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const comm = report.communication;
  const commRows: { label: string; value: string | null }[] = [
    { label: "Speaking pace", value: comm?.words_per_minute != null ? `${comm.words_per_minute} wpm · ${comm.words_per_minute_label ?? ""}` : null },
    { label: "Filler words", value: comm?.filler_rate ?? null },
    { label: "Answer structure", value: comm?.structure ?? null },
    { label: "Long pauses", value: comm?.long_pause_count != null ? (comm.long_pause_count === 0 ? "Low" : comm.long_pause_count < 4 ? "Occasional" : "Frequent") : null },
  ];
  const misses = [...(report.weaknesses ?? []), ...(report.misconceptions ?? [])];
  const study = [...new Set([...(report.knowledge_gaps ?? []), ...(report.study_topics ?? [])])];

  return (
    <div className="relative min-h-dvh">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-aurora" />
      <SiteNav backHref="/history" />

      <main className="relative mx-auto w-full max-w-4xl px-4 pb-28 pt-8 sm:px-6 sm:pt-12">
        {/* Header */}
        <div className="mb-8 text-center animate-fade-up">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Interview report</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{meta?.role}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {meta?.domain} · {meta?.seniority} · {meta?.questions} answers evaluated
          </p>
        </div>

        {/* Score + summary */}
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <div className="flex flex-col items-center rounded-3xl border border-line bg-surface p-7 shadow-card animate-fade-up">
            <ScoreRing score={report.overall_score} />
            <p className="mt-4 text-center text-sm font-medium leading-relaxed text-foreground">{report.headline}</p>
            <p className="mt-3 border-t border-line pt-3 text-center text-xs leading-relaxed text-muted-foreground">{report.summary}</p>
          </div>

          <SectionCard icon={<Target className="h-4.5 w-4.5" aria-hidden />} title="Performance breakdown" description="Scores per category, measured from your answers.">
            <div className="space-y-4">
              {(report.category_scores ?? []).map((c, i) => (
                <div key={c.name} className="animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="font-semibold tabular-nums text-foreground">{c.score}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-1000 ease-out", barColor(c.score))}
                      style={{ width: `${Math.max(2, c.score)}%` }}
                    />
                  </div>
                </div>
              ))}
              {!report.category_scores?.length && <p className="text-sm text-muted-foreground">No category scores available.</p>}
            </div>
          </SectionCard>
        </div>

        {/* Strengths / weaknesses */}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <SectionCard icon={<CheckCircle2 className="h-4.5 w-4.5" aria-hidden />} title="What you did well" className="border-success/25">
            <ul className="space-y-2.5 text-sm">
              {report.strengths?.map((s, i) => (
                <li key={i} className="flex gap-2.5 leading-relaxed text-foreground/90">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                  {s}
                </li>
              ))}
              {!report.strengths?.length && <li className="text-muted-foreground">Nothing notable recorded.</li>}
            </ul>
          </SectionCard>
          <SectionCard icon={<XCircle className="h-4.5 w-4.5" aria-hidden />} title="What you missed" className="border-error/25">
            <ul className="space-y-2.5 text-sm">
              {misses.map((s, i) => (
                <li key={i} className="flex gap-2.5 leading-relaxed text-foreground/90">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden />
                  {s}
                </li>
              ))}
              {!misses.length && <li className="text-muted-foreground">No significant misses recorded.</li>}
            </ul>
          </SectionCard>
        </div>

        {/* Communication indicators */}
        <div className="mt-6">
          <SectionCard icon={<MessageSquare className="h-4.5 w-4.5" aria-hidden />} title="Voice & communication" description={comm?.summary || "Measured from your recorded answers."}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {commRows.map((row) => (
                <StatCard
                  key={row.label}
                  label={row.label}
                  value={row.value ?? "No data"}
                  tone={row.value ? undefined : "warn"}
                />
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Question review */}
        {report.question_review?.length > 0 && (
          <div className="mt-6">
            <SectionCard icon={<Target className="h-4.5 w-4.5" aria-hidden />} title="Question-by-question review" description="Every question with the verdict your answers earned.">
              <div className="space-y-3">
                {report.question_review.map((q, i) => (
                  <div key={i} className="rounded-2xl border border-line bg-surface-2 p-4 transition-all duration-300 hover:border-line-strong">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-relaxed text-foreground">{q.question}</p>
                      <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums", verdictStyles(q.verdict))}>
                        {q.score}
                      </span>
                    </div>
                    <p className="mt-2 border-l-2 border-line-strong pl-3 text-xs italic leading-relaxed text-muted-foreground">
                      &ldquo;{q.answer.slice(0, 220)}{q.answer.length > 220 ? "…" : ""}&rdquo;
                    </p>
                    {q.note && <p className="mt-2 text-xs leading-relaxed text-foreground/80">{q.note}</p>}
                    <span className="mt-2.5 inline-block rounded-full border border-line bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {q.competency}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        )}

        {/* Study + recommendations */}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <SectionCard icon={<BookOpen className="h-4.5 w-4.5" aria-hidden />} title="Topics to study">
            <ul className="space-y-2.5 text-sm">
              {study.map((s, i) => (
                <li key={i} className="flex gap-2.5 leading-relaxed text-foreground/90">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                  {s}
                </li>
              ))}
              {!study.length && <li className="text-muted-foreground">Nothing specific — keep practicing broadly.</li>}
            </ul>
          </SectionCard>
          <SectionCard icon={<TrendingUp className="h-4.5 w-4.5" aria-hidden />} title="Recommendations">
            <ol className="list-inside list-decimal space-y-2.5 text-sm">
              {(report.recommendations ?? []).map((r, i) => (
                <li key={i} className="leading-relaxed text-foreground/90">{r}</li>
              ))}
            </ol>
          </SectionCard>
        </div>

        {/* Practice questions */}
        {report.practice_questions?.length > 0 && (
          <div className="mt-6">
            <SectionCard icon={<Zap className="h-4.5 w-4.5" aria-hidden />} title="Practice before your next session" description="Rehearse these out loud, then try them in a new interview.">
              <ul className="space-y-2.5">
                {report.practice_questions.map((q, i) => (
                  <li key={i} className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed text-foreground/90 transition-colors hover:border-brand/40">
                    {q}
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>
        )}

        {/* Next session + practice CTA */}
        <div className="mt-6 overflow-hidden rounded-3xl border border-brand/30 bg-gradient-to-tr from-brand-soft via-surface to-surface p-7 shadow-glow-brand animate-fade-up sm:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand">Next session</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{report.next_session?.recommended_difficulty}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{report.next_session?.rationale}</p>
              {report.next_session?.focus_competencies?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {report.next_session.focus_competencies.map((c) => (
                    <span key={c} className="rounded-full border border-brand/30 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">{c}</span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={startPractice}
              disabled={startingPractice}
              className="group flex shrink-0 items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-brand to-brand-2 px-7 py-4 text-base font-semibold text-on-accent shadow-glow-brand transition-all duration-300 hover:shadow-glow-strong hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {startingPractice ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  Preparing session…
                </>
              ) : (
                <>
                  <Zap className="h-5 w-5 transition-transform group-hover:scale-110" aria-hidden />
                  Practice my weak areas
                  <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
