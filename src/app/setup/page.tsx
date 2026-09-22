"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles, GraduationCap, Briefcase, Skull, Flame, Zap, Timer, Layers, BookOpen,
} from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { OptionPills, Segmented } from "@/components/ui/option-pills";
import { UploadCard, type UploadState } from "@/components/ui/upload-card";
import { cn } from "@/lib/utils";

type Experience = "student" | "junior" | "mid" | "senior";
type Style = "friendly" | "realistic" | "difficult" | "stress";
type Length = "quick" | "standard" | "deep";

const LENGTH_QUESTIONS: Record<Length, number> = { quick: 5, standard: 10, deep: 15 };

function SetupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [goal, setGoal] = React.useState(() => searchParams.get("q") ?? "");
  const [experience, setExperience] = React.useState<Experience>("student");
  const [style, setStyle] = React.useState<Style>("realistic");
  const [length, setLength] = React.useState<Length>("standard");
  const [resume, setResume] = React.useState<{ name: string; size: number } | null>(null);
  const [jd, setJd] = React.useState<{ name: string; size: number } | null>(null);
  const [resumeState, setResumeState] = React.useState<UploadState>("empty");
  const [jdState, setJdState] = React.useState<UploadState>("empty");
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const fileCache = React.useRef<{ resume?: File; jd?: File }>({});
  const parsed = React.useRef<{
    resume?: { text: string; summary?: string; skills?: string[] };
    jd?: { text: string; summary?: string; skills?: string[] };
  }>({});

  const lengthMeta: Record<Length, { label: string; hint: string; icon: React.ReactNode }> = {
    quick: { label: "Quick", hint: "5 questions", icon: <Timer className="h-4 w-4" aria-hidden /> },
    standard: { label: "Standard", hint: "10 questions", icon: <Layers className="h-4 w-4" aria-hidden /> },
    deep: { label: "Deep", hint: "15 questions", icon: <BookOpen className="h-4 w-4" aria-hidden /> },
  };

  async function upload(kind: "resume" | "jd", file: File) {
    const setState = kind === "resume" ? setResumeState : setJdState;
    setState("processing");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind === "jd" ? "job_description" : "resume");
      const res = await fetch("/api/documents/parse", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not read that file");
      parsed.current[kind] = { text: data.text, summary: data.analysis?.summary, skills: data.analysis?.skills };
      fileCache.current[kind] = file;
      (kind === "resume" ? setResume : setJd)({ name: file.name, size: file.size });
      setState("done");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  function removeDoc(kind: "resume" | "jd") {
    fileCache.current[kind] = undefined;
    parsed.current[kind] = undefined;
    (kind === "resume" ? setResume : setJd)(null);
    (kind === "resume" ? setResumeState : setJdState)("empty");
  }

  async function start() {
    if (creating) return;
    if (!goal.trim()) {
      setError("Tell me what you're preparing for — even one line is enough.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/interviews/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: goal.trim(),
          experience,
          style,
          length,
          resumeText: parsed.current.resume?.text,
          resumeSummary: parsed.current.resume?.summary,
          resumeSkills: parsed.current.resume?.skills,
          jobDescription: parsed.current.jd?.text,
          jdSummary: parsed.current.jd?.summary,
          jdSkills: parsed.current.jd?.skills,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.id) throw new Error(data?.error || "Could not create the interview");
      router.push(`/interview/${data.id}`);
    } catch (e) {
      setCreating(false);
      setError(e instanceof Error ? e.message : "Something went wrong starting the interview");
    }
  }

  const busy = creating || resumeState === "processing" || jdState === "processing";

  return (
    <div className="relative min-h-dvh">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-aurora" />
      <SiteNav />

      <main className="relative mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        {/* Hero */}
        <div className="mb-12 text-center sm:mb-16">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-3.5 py-1.5 text-xs font-semibold text-brand animate-fade-up">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            AI-powered mock interviews
          </span>
          <h1 className="mt-5 text-balance text-4xl font-bold leading-[1.1] tracking-tight text-foreground animate-fade-up sm:text-5xl" style={{ animationDelay: "60ms" }}>
            Prepare like the<br className="sm:hidden" /> interview is <span className="text-gradient">tomorrow</span>.
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground animate-fade-up" style={{ animationDelay: "120ms" }}>
            Tell us your target. Get a real interviewer that listens, adapts, and tells you exactly what to fix.
          </p>
        </div>

        {/* Configuration card */}
        <section
          aria-labelledby="config-heading"
          className="rounded-3xl border border-line bg-surface p-6 shadow-card animate-fade-up sm:p-8"
          style={{ animationDelay: "180ms" }}
        >
          <h2 id="config-heading" className="text-lg font-semibold tracking-tight text-foreground">Configure your interview</h2>
          <p className="mt-1 text-sm text-muted-foreground">Any domain. Any role. The AI builds the plan.</p>

          {/* Conversational goal input */}
          <div className="group mt-7">
            <label htmlFor="goal" className="mb-2.5 block text-sm font-medium text-foreground">
              What are you preparing for?
            </label>
            <div className={cn(
              "relative rounded-2xl border bg-surface-2 transition-all duration-300",
              "focus-within:border-brand/60 focus-within:shadow-glow-brand focus-within:bg-surface-3"
            )}>
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-brand">
                <Sparkles className="h-4.5 w-4.5" aria-hidden />
              </span>
              <input
                id="goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value.slice(0, 140))}
                placeholder="ML Engineer internship at an automotive company"
                autoComplete="off"
                maxLength={140}
                className="w-full rounded-2xl bg-transparent py-4 pl-12 pr-16 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
              />
              <span aria-hidden className="absolute bottom-3 right-4 text-[11px] tabular-nums text-muted-foreground/60">
                {goal.length}/140
              </span>
            </div>
          </div>

          {/* Experience */}
          <div className="mt-7">
            <OptionPills<Experience>
              label="Experience level"
              name="experience"
              value={experience}
              onChange={setExperience}
              columns={2}
              options={[
                { value: "student", label: "Student / Fresher", hint: "Campus & entry roles", icon: <GraduationCap className="h-4 w-4" aria-hidden /> },
                { value: "junior", label: "1–3 years", hint: "Early career", icon: <Briefcase className="h-4 w-4" aria-hidden /> },
                { value: "mid", label: "3–5 years", hint: "Solid individual contributor", icon: <Briefcase className="h-4 w-4" aria-hidden /> },
                { value: "senior", label: "5+ years", hint: "Senior / lead track", icon: <Briefcase className="h-4 w-4" aria-hidden /> },
              ]}
            />
          </div>

          {/* Interview style */}
          <div className="mt-7">
            <OptionPills<Style>
              label="Interview style"
              name="style"
              value={style}
              onChange={setStyle}
              columns={2}
              options={[
                { value: "friendly", label: "Practice", hint: "Friendly & encouraging", icon: <Sparkles className="h-4 w-4" aria-hidden /> },
                { value: "realistic", label: "Realistic", hint: "A real interview", icon: <Briefcase className="h-4 w-4" aria-hidden /> },
                { value: "difficult", label: "Difficult", hint: "Pushes you hard", icon: <Skull className="h-4 w-4" aria-hidden /> },
                { value: "stress", label: "Stress interview", hint: "Pressure & challenges", icon: <Flame className="h-4 w-4" aria-hidden /> },
              ]}
            />
          </div>

          {/* Length — segmented */}
          <div className="mt-7">
            <Segmented<Length>
              label="Length"
              name="length"
              value={length}
              onChange={setLength}
              options={(Object.keys(lengthMeta) as Length[]).map((k) => ({ value: k, label: lengthMeta[k].label, hint: lengthMeta[k].hint }))}
            />
            <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
              {LENGTH_QUESTIONS[length]} questions · warm-up conversation not counted
            </p>
          </div>

          {/* Uploads */}
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <UploadCard
              title="Upload resume"
              hint="Drop your file here, or click to browse. Used to personalize questions."
              accept=".pdf,.docx,.txt,.md"
              state={resumeState}
              fileName={resume?.name}
              fileSize={resume?.size}
              onFile={(f) => upload("resume", f)}
              onRemove={() => removeDoc("resume")}
            />
            <UploadCard
              title="Upload job description"
              hint="Optional. The AI aligns questions to the role's requirements."
              accept=".pdf,.docx,.txt,.md"
              state={jdState}
              fileName={jd?.name}
              fileSize={jd?.size}
              onFile={(f) => upload("jd", f)}
              onRemove={() => removeDoc("jd")}
            />
          </div>

          {/* Error */}
          {error && (
            <div role="alert" className="mt-6 rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm text-foreground animate-fade-up">
              {error}
            </div>
          )}

          {/* CTA */}
          <div className="mt-8">
            <button
              type="button"
              onClick={start}
              disabled={busy}
              className={cn(
                "group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl px-6 py-4 text-base font-semibold text-on-accent",
                "bg-gradient-to-r from-brand to-brand-2 shadow-glow-brand transition-all duration-300",
                "hover:shadow-glow-strong hover:brightness-110 active:scale-[0.98]",
                "disabled:pointer-events-none disabled:opacity-60",
                "outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              )}
            >
              {creating ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-on-accent/40 border-t-on-accent" aria-hidden />
                  Building your interview…
                </>
              ) : (
                <>
                  <Zap className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" aria-hidden />
                  Start interview
                  <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </>
              )}
            </button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Voice-first · runs in your browser · nothing is shared
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <SetupInner />
    </Suspense>
  );
}
