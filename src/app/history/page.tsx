"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, ArrowRight } from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  role: string;
  domain: string;
  status: string;
  mode: string;
  created_at: string;
  questions: number;
  score: number | null;
};

const statusBadge = (s: string) =>
  s === "completed"
    ? "border-success/30 bg-success-soft text-success"
    : s === "active" || s === "planned"
      ? "border-warning/30 bg-warning-soft text-warning"
      : "border-line bg-surface-2 text-muted-foreground";

export default function HistoryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/interviews/list");
        const data = await res.json();
        setRows(data.interviews ?? []);
      } catch {
        setRows([]);
      }
    })();
  }, []);

  return (
    <div className="relative min-h-dvh">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-aurora" />
      <SiteNav />

      <main className="relative mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fade-up">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Your interviews</h1>
            <p className="mt-1 text-sm text-muted-foreground">Resume an unfinished session or review a past report.</p>
          </div>
          <Link
            href="/setup"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-2 px-5 py-2.5 text-sm font-semibold text-on-accent shadow-glow-brand transition-all hover:brightness-110 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New interview
          </Link>
        </div>

        {rows === null ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-7 w-7 animate-spin text-brand" aria-hidden />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line-strong bg-surface/60 p-14 text-center animate-fade-up">
            <p className="text-sm font-medium text-foreground">No interviews yet</p>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Pick any role or domain and InterVue will build a realistic, adaptive mock interview.
            </p>
            <Link
              href="/setup"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-2 px-5 py-2.5 text-sm font-semibold text-on-accent shadow-glow-brand transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Start your first interview
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r, i) => (
              <Link
                key={r.id}
                href={r.status === "completed" ? `/results/${r.id}` : `/interview/${r.id}`}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-5 py-4 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-glow-brand animate-fade-up"
                style={{ animationDelay: `${Math.min(i * 50, 400)}ms` }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{r.role}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.domain} · {r.questions} answers · {new Date(r.created_at).toLocaleString()}
                    {r.mode === "demo" ? " · demo" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {r.score != null && (
                    <span className="text-lg font-bold tabular-nums text-brand">{r.score}</span>
                  )}
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider",
                      statusBadge(r.status)
                    )}
                  >
                    {r.status}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
