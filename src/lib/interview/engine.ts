// ---------------------------------------------------------------------------
// InterVue AI — adaptive interview engine (server-side state machine).
// ---------------------------------------------------------------------------

import type {
  CommunicationIndicators,
  Competency,
  Evaluation,
  Interview,
  InterviewBlueprint,
  InterviewPhase,
  QAEntry,
  Report,
} from "@/types/interview";
import {
  buildEvaluatorUserPrompt,
  buildReporterUserPrompt,
  EVALUATOR_SYSTEM_PROMPT,
  REPORTER_SYSTEM_PROMPT,
  OPENING_FALLBACK,
  generateJson,
} from "@/lib/ai/llm";

const DIFFICULTY_LABELS = ["", "warm-up", "easy", "moderate", "challenging", "hard"];

export function difficultyLabel(d: number): string {
  return DIFFICULTY_LABELS[Math.max(1, Math.min(5, Math.round(d)))];
}

export function normalizeBlueprint(bp: Partial<InterviewBlueprint>, fallbackRole: string, questionCount: number): InterviewBlueprint {
  const weightsSum = (bp.competencies ?? []).reduce((a, c) => a + (Number(c.weight) || 0), 0);
  let competencies: Competency[] = (bp.competencies ?? []).map((c) => ({
    name: String(c.name ?? "General").slice(0, 80),
    weight: Number(c.weight) || 0.1,
    score: null,
    asked: 0,
  }));
  if (competencies.length === 0) {
    competencies = [
      { name: "Core Fundamentals", weight: 0.3, score: null, asked: 0 },
      { name: "Applied Problem Solving", weight: 0.3, score: null, asked: 0 },
      { name: "Communication", weight: 0.2, score: null, asked: 0 },
      { name: "Behavioral", weight: 0.2, score: null, asked: 0 },
    ];
  }
  if (weightsSum > 0) {
    competencies = competencies.map((c) => ({ ...c, weight: c.weight / weightsSum }));
  }
  return {
    role: String(bp.role || fallbackRole).slice(0, 120),
    domain: String(bp.domain || "General").slice(0, 120),
    seniority: String(bp.seniority || "Entry").slice(0, 60),
    interview_style: String(bp.interview_style || "Realistic").slice(0, 60),
    difficulty: bp.difficulty || "Medium",
    question_count: Math.max(1, Math.min(20, Number(bp.question_count) || questionCount)),
    competencies,
    question_types: (bp.question_types ?? ["conceptual", "scenario", "behavioral"]).map(String),
    opening_line: typeof bp.opening_line === "string" ? bp.opening_line : OPENING_FALLBACK,
  };
}

/** Pick the next competency: highest weight among those probed least (relative to weight). */
export function pickNextCompetency(bp: InterviewBlueprint, qa: QAEntry[]): Competency {
  const counts = new Map<string, number>();
  for (const entry of qa) counts.set(entry.competency, (counts.get(entry.competency) ?? 0) + 1);
  let best: Competency | null = null;
  let bestScore = -Infinity;
  for (const c of bp.competencies) {
    const asked = counts.get(c.name) ?? 0;
    // Score = weight per question already asked; heavily weighted & untested first.
    const score = c.weight / (asked + 1);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ?? bp.competencies[0];
}

export function allCompetenciesProbed(bp: InterviewBlueprint, qa: QAEntry[]): boolean {
  const counts = new Set(qa.map((e) => e.competency));
  return bp.competencies.every((c) => counts.has(c.name));
}

export function clampDifficulty(d: number): number {
  return Math.max(1, Math.min(5, d));
}

// ---------------------------------------------------------------------------
// Interview lifecycle: warm-up → self-intro → substantive questions → done.
// Greeting / self-intro never consume question slots; every question asked
// during TECHNICAL (top-level or follow-up) is substantive and consumes one.
// ---------------------------------------------------------------------------

export type OpeningPlan = { greeting: string; selfIntroPrompt: string };

/** Deterministic warm-up script so the opening never burns question slots. */
export function buildOpeningPlan(blueprint: InterviewBlueprint): OpeningPlan {
  return {
    greeting: `Hey, thanks for making the time today. How's your day going so far?`,
    selfIntroPrompt: `Glad to hear it. Before we dive in, tell me a little about yourself and the background you'd bring to the ${blueprint.role} role.`,
  };
}

/** Natural closing line once the final substantive answer has been evaluated. */
export function buildClosingLine(blueprint: InterviewBlueprint): string {
  return `That brings us to the end of the interview. Thanks for walking me through your answers — I have everything I need. Wrapping up your evaluation now.`;
}

/**
 * Advance the phase machine after a turn. Returns the phase the interview
 * should be in once the AI's next reply has been spoken.
 */
export function advancePhase(current: InterviewPhase, hadSubstantiveQuestion: boolean): InterviewPhase {
  if (current === "COMPLETED") return "COMPLETED";
  if (current === "WARMUP") return "SELF_INTRO"; // after greeting answered → invite self-intro
  if (current === "SELF_INTRO") return hadSubstantiveQuestion ? "TECHNICAL" : "TECHNICAL"; // self-intro answered → begin Q1
  return hadSubstantiveQuestion ? "TECHNICAL" : "TECHNICAL";
}

// ---------------------------------------------------------------------------
// Voice / communication analysis
// ---------------------------------------------------------------------------

const FILLERS = /\b(um+|uh+|erm+|ah+|like|you\s+know|basically|actually|literally|sort\s+of|kind\s+of|i\s+mean|so\s+yeh+|right\?)\b/gi;

export function analyzeUtterance(text: string, durationSeconds: number | null): CommunicationIndicators {
  const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  let wpm: number | null = null;
  if (durationSeconds && durationSeconds > 1.5 && wordCount > 0) {
    wpm = Math.round((wordCount / durationSeconds) * 60);
  }
  const fillerCount = (text.match(FILLERS) ?? []).length;
  const fillerRate = wordCount === 0 ? null : fillerCount / Math.max(1, wordCount) > 0.08 ? "High" : fillerCount > 0 ? "Moderate" : "Low";
  const wpmLabel = wpm == null ? null : wpm < 100 ? "Low" : wpm <= 170 ? "Good" : "Fast";
  // Structure heuristic: presence of connectives and example markers.
  const structureMarkers = /\b(first|second|third|then|next|finally|for\s+example|for\s+instance|because|therefore|however|so\s+that|as\s+a\s+result)\b/gi;
  const markerCount = (text.match(structureMarkers) ?? []).length;
  const structure: CommunicationIndicators["structure"] =
    wordCount < 12 ? "Weak" : markerCount >= 2 ? "Strong" : markerCount === 1 ? "Ok" : wordCount > 60 ? "Ok" : "Weak";
  return {
    words_per_minute: wpm,
    words_per_minute_label: wpmLabel,
    filler_word_count: fillerCount,
    filler_rate: fillerRate,
    long_pause_count: 0,
    answer_duration_seconds: durationSeconds,
    structure,
  };
}

export function aggregateIndicators(list: CommunicationIndicators[]): {
  wpm: number | null;
  wpmLabel: string | null;
  fillers: number;
  fillerRate: string | null;
  pauses: number;
  structure: string | null;
} {
  const wpms = list.map((i) => i.words_per_minute).filter((v): v is number => v != null);
  const avgWpm = wpms.length ? Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length) : null;
  const fillers = list.reduce((a, i) => a + i.filler_word_count, 0);
  const pauses = list.reduce((a, i) => a + i.long_pause_count, 0);
  const words = list.reduce((a, i) => a + (i.answer_duration_seconds && i.words_per_minute ? (i.words_per_minute * i.answer_duration_seconds) / 60 : 0), 0);
  const dur = list.reduce((a, i) => a + (i.answer_duration_seconds ?? 0), 0);
  const fillerRate = words > 0 ? (fillers / words > 0.08 ? "High" : fillers > 0 ? "Moderate" : "Low") : null;
  const structures = list.map((i) => i.structure).filter((v): v is NonNullable<CommunicationIndicators["structure"]> => v != null);
  const structure = structures.length
    ? (["Strong", "Ok", "Weak"] as const).find((s) => structures.filter((x) => x === s).length >= structures.length / 2) ?? null
    : null;
  return {
    wpm: avgWpm,
    wpmLabel: avgWpm == null ? null : avgWpm < 100 ? "Low" : avgWpm <= 170 ? "Good" : "Fast",
    fillers,
    fillerRate,
    pauses,
    structure,
  };
}

// ---------------------------------------------------------------------------
// Evaluation turn
// ---------------------------------------------------------------------------

export type TurnResult = {
  evaluation: Evaluation | null;
  reply: string;
  interviewComplete: boolean;
  isFollowUp: boolean;
};

/** Server-side heuristic evaluation used in demo mode or when the LLM fails. */
function heuristicEvaluation(interview: Interview, answer: string, competency: string, challenge: boolean): Evaluation {
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const onTopic = words > 3;
  const score = Math.max(1, Math.min(9, Math.round(words / 12) + (onTopic ? 3 : 0)));
  return {
    scores: {
      relevance: onTopic ? 6 : 2,
      correctness: onTopic ? 6 : 2,
      completeness: Math.min(10, Math.round(words / 15) + 2),
      depth: Math.min(10, Math.round(words / 20) + 2),
      reasoning: onTopic ? 6 : 3,
      communication: words > 10 ? 7 : 4,
      overall: score,
    },
    strengths: onTopic ? ["Engaged with the question"] : [],
    weaknesses: onTopic ? ["Answer evaluated in demo mode (heuristic scoring)"] : ["Very brief or off-topic response"],
    missing_concepts: [],
    misconceptions: [],
    relevance_note: onTopic ? "Answer addressed the question" : "Answer may not address the question",
    next_action: !onTopic ? "PROBE_WEAKNESS" : challenge ? "INCREASE_DIFFICULTY" : words > 80 ? "CHANGE_COMPETENCY" : "ASK_FOLLOW_UP",
    next_question_text: "",
    next_competency: competency,
    acknowledgement: "",
    difficulty_delta: challenge ? 1 : 0,
  };
}

function probedCompetencies(interview: Interview): { name: string; asked: number; avgScore: number | null }[] {
  const acc = new Map<string, { asked: number; total: number; n: number }>();
  for (const entry of interview.qa) {
    const a = acc.get(entry.competency) ?? { asked: 0, total: 0, n: 0 };
    a.asked += 1;
    if (entry.evaluation?.scores?.overall != null) {
      a.total += entry.evaluation.scores.overall;
      a.n += 1;
    }
    acc.set(entry.competency, a);
  }
  return [...acc.entries()].map(([name, v]) => ({ name, asked: v.asked, avgScore: v.n ? v.total / v.n : null }));
}

export async function runEvaluationTurn(
  interview: Interview,
  answer: string,
  opts: {
    challenge: boolean;
    durationSeconds: number | null;
    demoMode: boolean;
    /** Set when the answered "question" was the self-intro invitation — the evaluator must craft Q1. */
    selfIntroContext?: string;
    /** Require a next question even if the model omits one (self-intro → Q1 transition). */
    forceNewQuestion?: boolean;
  }
): Promise<TurnResult> {
  const { challenge, durationSeconds, demoMode, selfIntroContext, forceNewQuestion } = opts;

  const currentQuestion =
    interview.transcript.filter((t) => t.role === "ai").slice(-1)[0]?.text ??
    interview.blueprint.opening_line ??
    OPENING_FALLBACK;
  const lastCompetency =
    interview.qa.length > 0 ? interview.qa[interview.qa.length - 1].competency : pickNextCompetency(interview.blueprint, interview.qa).name;

  const demo = demoMode || !answer.trim();
  let evaluation: Evaluation | null = null;

  if (!demo) {
    evaluation = await generateJson<Evaluation>({
      system: EVALUATOR_SYSTEM_PROMPT,
      user: buildEvaluatorUserPrompt({
        blueprint: interview.blueprint,
        question: currentQuestion,
        competency: lastCompetency,
        answer,
        recentHistory: interview.qa.slice(-6).map((e) => ({
          question: e.question,
          answer: e.answer,
          overall: e.evaluation?.scores?.overall ?? null,
          competency: e.competency,
        })),
        questionIndex: Math.max(1, interview.substantive_asked ?? interview.current_question),
        questionCount: interview.blueprint.question_count,
        difficulty: interview.difficulty,
        probedCompetencies: probedCompetencies(interview),
        challengeRequested: challenge,
        candidateSummary: interview.candidate.resume_summary ?? null,
        jdSummary: interview.candidate.jd_summary ?? null,
        selfIntroContext: selfIntroContext ?? null,
      }),
      maxTokens: 1400,
      temperature: 0.7,
    });
    if (evaluation && !evaluation?.scores?.overall && !evaluation?.next_question_text) evaluation = null;
  }

  if (!evaluation) {
    evaluation = heuristicEvaluation(interview, answer, lastCompetency, challenge);
  }

  // --- validate & clamp the evaluation ---
  const clamp10 = (n: unknown, d = 5) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.max(0, Math.min(10, Math.round(v))) : d;
  };
  const s = evaluation.scores;
  const scores = {
    relevance: clamp10(s?.relevance),
    correctness: clamp10(s?.correctness),
    completeness: clamp10(s?.completeness),
    depth: clamp10(s?.depth),
    reasoning: clamp10(s?.reasoning),
    communication: clamp10(s?.communication ?? s?.overall),
    overall: clamp10(s?.overall ?? (s as unknown as Record<string, number> | undefined)?.technical_score),
  };
  const actions = ["ASK_FOLLOW_UP", "PROBE_WEAKNESS", "INCREASE_DIFFICULTY", "DECREASE_DIFFICULTY", "CHANGE_COMPETENCY", "END_INTERVIEW"] as const;
  const nextAction = actions.includes(evaluation.next_action as (typeof actions)[number]) ? evaluation.next_action : "ASK_FOLLOW_UP";
  const nextQuestion = String(evaluation.next_question_text ?? "").trim();
  const ack = String(evaluation.acknowledgement ?? "").trim();

  // Question-count rule: the interview MUST end once question_target
  // substantive questions have been asked — regardless of probed coverage.
  const asked = interview.substantive_asked ?? interview.current_question;
  const planDone = asked >= interview.blueprint.question_count;
  const mustEnd = planDone;

  let interviewComplete = false;
  let reply = "";

  if (!nextQuestion || mustEnd) {
    // Synthesize a graceful wrap-up question / closing line.
    if (mustEnd) {
      interviewComplete = true;
      reply = buildClosingLine(interview.blueprint);
      evaluation.next_action = "END_INTERVIEW";
    } else if (forceNewQuestion) {
      // Self-intro answered: the FIRST substantive question must exist.
      const firstComp = pickNextCompetency(interview.blueprint, interview.qa);
      evaluation.next_action = "ASK_FOLLOW_UP";
      evaluation.next_competency = firstComp.name;
      reply = nextQuestion || `Let's get into it. Tell me how you'd approach ${firstComp.name.toLowerCase()} in this role.`;
    } else {
      evaluation.next_action = nextAction;
      // Rotate fallback follow-ups so the interviewer never repeats verbatim.
      const FALLBACK_FOLLOWUPS = [
        `Let's go one level deeper: what part of ${lastCompetency.toLowerCase()} do you find hardest to explain to someone new?`,
        `Can you give me a concrete example where ${lastCompetency.toLowerCase()} really made a difference?`,
        `Suppose I push back on that — what's the strongest counterargument to what you just said?`,
        `Walk me through how you'd approach ${lastCompetency.toLowerCase()} if you had half the usual time.`,
        `That's a start. What would you do differently if the stakes were much higher?`,
      ];
      reply = nextQuestion || FALLBACK_FOLLOWUPS[interview.qa.length % FALLBACK_FOLLOWUPS.length];
    }
  } else {
    const structured = (evaluation as unknown as { acknowledgement?: string }).acknowledgement;
    reply = structured && !nextQuestion.startsWith(structured) ? `${structured} ${nextQuestion}` : nextQuestion;
    // Strip duplicated "AI:" prefixes that models sometimes emit.
    reply = reply.replace(/^(interviewer|ai)\s*:\s*/i, "").trim();
  }

  return { evaluation: { ...evaluation, scores, next_action: nextAction }, reply, interviewComplete, isFollowUp: nextAction === "ASK_FOLLOW_UP" || nextAction === "PROBE_WEAKNESS" };
}

// ---------------------------------------------------------------------------
// Competency score maintenance
// ---------------------------------------------------------------------------

export function updateCompetencyScores(interview: Interview, evaluation: Evaluation, competency: string): void {
  const comp = interview.blueprint.competencies.find((c) => c.name === competency) ??
    interview.blueprint.competencies.find((c) => c.name === evaluation.next_competency);
  if (!comp) return;
  comp.asked = (comp.asked ?? 0) + 1;
  const overall10 = evaluation.scores.overall;
  const pct = Math.round((overall10 / 10) * 100);
  comp.score = comp.score == null ? pct : Math.round(comp.score * 0.6 + pct * 0.4);
}

// ---------------------------------------------------------------------------
// Final report (LLM with deterministic fallback)
// ---------------------------------------------------------------------------

export async function generateFinalReport(interview: Interview, demoMode: boolean): Promise<Report> {
  const durationMs = Date.now() - new Date(interview.created_at).getTime();
  const durationMinutes = durationMs > 0 ? Math.max(1, Math.round(durationMs / 60000)) : null;

  let report: Report | null = null;
  if (!demoMode && interview.qa.some((q) => q.evaluation)) {
    report = await generateJson<Report>({
      patient: true,
      system: REPORTER_SYSTEM_PROMPT,
      user: buildReporterUserPrompt({
        blueprint: interview.blueprint,
        qa: interview.qa.map((e) => ({
          question: e.question,
          answer: e.answer,
          competency: e.competency,
          is_follow_up: e.is_follow_up,
          scores: e.evaluation?.scores ?? null,
          ...(e.evaluation
            ? {
                strengths: e.evaluation.strengths,
                weaknesses: e.evaluation.weaknesses,
                missing_concepts: e.evaluation.missing_concepts,
                misconceptions: e.evaluation.misconceptions,
              }
            : {}),
        })),
        indicators: interview.communication_indicators,
        durationMinutes,
      }),
      maxTokens: 3000,
      temperature: 0.5,
    });
  }

  if (!report) {
    report = buildFallbackReport(interview, durationMinutes);
  }

  // Normalize & guarantee required fields.
  report.overall_score = Math.max(0, Math.min(100, Math.round(Number(report.overall_score) || 0)));
  report.category_scores = (report.category_scores ?? [])
    .filter((c) => c && typeof c.name === "string")
    .map((c) => ({ name: String(c.name).slice(0, 60), score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 0))) }));
  // Reporters sometimes assign 0 to competencies that were never probed — an
  // unprobed area is not a 0/100, so drop those (as long as probed ones remain).
  const probedNames = interview.qa.map((e) => e.competency.toLowerCase()).filter(Boolean);
  const wasProbed = (name: string) => {
    const n = name.toLowerCase();
    return probedNames.some((p) => n.includes(p) || p.includes(n));
  };
  const probedCats = report.category_scores.filter((c) => c.score > 0 || wasProbed(c.name));
  if (probedCats.length) report.category_scores = probedCats;
  if (!report.category_scores.length) {
    report.category_scores = interview.blueprint.competencies.map((c) => ({ name: c.name, score: Math.round((c.score ?? 50) * 1) }));
  }
  report.question_review = (report.question_review ?? []).slice(0, interview.qa.length);
  report.next_session = report.next_session ?? {
    recommended_difficulty: "Similar difficulty",
    rationale: "Based on your current performance.",
    focus_competencies: [],
  };
  const finalIndicators = aggregateIndicators(interview.communication_indicators);
  report.communication = {
    words_per_minute: finalIndicators.wpm,
    words_per_minute_label: finalIndicators.wpmLabel as Report["communication"]["words_per_minute_label"],
    filler_word_count: finalIndicators.fillers,
    filler_rate: finalIndicators.fillerRate as Report["communication"]["filler_rate"],
    long_pause_count: finalIndicators.pauses,
    answer_duration_seconds: null,
    structure: finalIndicators.structure as Report["communication"]["structure"],
    summary:
      finalIndicators.wpm != null
        ? `Average speaking pace ${finalIndicators.wpm} wpm (${finalIndicators.wpmLabel}); filler words: ${finalIndicators.fillerRate ?? "n/a"}; answer structure: ${finalIndicators.structure ?? "n/a"}.`
        : String(report.communication?.summary ?? "Not enough voice data was captured for pace analysis."),
  };
  return report;
}

function scoreTo100(avg10: number | null): number {
  return avg10 == null ? 50 : Math.round((avg10 / 10) * 100);
}

function buildFallbackReport(interview: Interview, durationMinutes: number | null): Report {
  const competencyScores = interview.blueprint.competencies.map((c) => ({
    name: c.name,
    score: c.score ?? null,
    weight: c.weight,
  }));
  const scored = competencyScores.filter((c) => c.score != null) as { name: string; score: number; weight: number }[];
  const overall = scored.length
    ? Math.round(scored.reduce((a, c) => a + c.score * c.weight, 0) / scored.reduce((a, c) => a + c.weight, 0))
    : 0;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const gaps: string[] = [];
  const misconceptions: string[] = [];
  const review = interview.qa.map((e) => {
    const pct = scoreTo100(e.evaluation?.scores?.overall ?? null);
    if (e.evaluation) {
      for (const s of e.evaluation.strengths ?? []) if (!strengths.includes(s)) strengths.push(s);
      for (const w of e.evaluation.weaknesses ?? []) if (!weaknesses.includes(w)) weaknesses.push(w);
      for (const m of e.evaluation.missing_concepts ?? []) if (!gaps.includes(m)) gaps.push(m);
      for (const m of e.evaluation.misconceptions ?? []) if (!misconceptions.includes(m)) misconceptions.push(m);
    }
    return {
      question: e.question,
      answer: e.answer,
      competency: e.competency,
      score: pct,
      verdict: (pct >= 75 ? "Strong" : pct >= 55 ? "Ok" : "Needs improvement") as "Strong" | "Ok" | "Needs improvement",
      note: e.evaluation?.relevance_note ?? "",
    };
  });

  const weak = competencyScores.filter((c) => c.score != null && c.score < 60).map((c) => c.name);
  const indicators = aggregateIndicators(interview.communication_indicators);
  // Only show competencies that were actually probed; unprobed ones would
  // misleadingly read as 0/100 in the UI.
  const probedCategories = competencyScores
    .filter((c) => c.score != null)
    .map((c) => ({ name: c.name, score: c.score as number }));

  return {
    overall_score: overall,
    headline: overall >= 75 ? "Solid performance across most areas" : overall >= 55 ? "Reasonable base with clear gaps to close" : "Foundational stage — focus on fundamentals first",
    summary: `You answered ${interview.qa.length} questions as a ${interview.blueprint.role} candidate. This report was generated from per-answer evaluations${
      demoNote()
    }.`,
    category_scores: probedCategories.length
      ? probedCategories
      : competencyScores.map((c) => ({ name: c.name, score: 50 })),
    competency_scores: competencyScores,
    strengths: strengths.slice(0, 6),
    weaknesses: weaknesses.slice(0, 6),
    knowledge_gaps: gaps.slice(0, 6),
    misconceptions: misconceptions.slice(0, 6),
    communication: {
      words_per_minute: indicators.wpm,
      words_per_minute_label: indicators.wpmLabel as Report["communication"]["words_per_minute_label"],
      filler_word_count: indicators.fillers,
      filler_rate: indicators.fillerRate as Report["communication"]["filler_rate"],
      long_pause_count: indicators.pauses,
      answer_duration_seconds: null,
      structure: indicators.structure as Report["communication"]["structure"],
      summary:
        indicators.wpm != null
          ? `Average speaking pace ${indicators.wpm} wpm (${indicators.wpmLabel}); filler words: ${indicators.fillerRate ?? "n/a"}; answer structure: ${indicators.structure ?? "n/a"}.`
          : "Not enough voice data was captured for pace analysis.",
    },
    question_review: review,
    recommendations: [
      ...(weak.length ? [`Rebuild confidence in: ${weak.join(", ")}.`] : ["Keep sharpening the strong areas with harder scenarios."]),
      "Rehearse answers aloud and time yourself to keep pace steady.",
    ],
    study_topics: [...new Set([...gaps, ...weak])].slice(0, 6),
    practice_questions: interview.qa.slice(-3).map((e) => `Re-answer: ${e.question}`),
    next_session: {
      recommended_difficulty: overall >= 75 ? "Harder technical interview" : overall >= 55 ? "Similar difficulty with tougher follow-ups" : "Easier fundamentals-focused interview",
      rationale: "Based on your final score and weak competencies.",
      focus_competencies: weak.slice(0, 3),
    },
  };
}

function demoNote(): string {
  return "";
}
