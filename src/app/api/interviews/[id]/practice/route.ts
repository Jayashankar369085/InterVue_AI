// ---------------------------------------------------------------------------
// POST /api/interviews/[id]/practice — "Practice my weak areas":
// derive a focused blueprint from the finished interview's report and create
// the new interview in one call.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createInterview, getInterview } from "@/lib/interview/store";
import { normalizeBlueprint, pickNextCompetency } from "@/lib/interview/engine";
import { PRACTICE_SYSTEM_PROMPT, generateJson, isDemoMode } from "@/lib/ai/llm";
import type { InterviewBlueprint } from "@/types/interview";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const previous = await getInterview(id);
    if (!previous) {
      return NextResponse.json({ error: "Previous interview not found." }, { status: 404 });
    }
    if (!previous.report) {
      return NextResponse.json({ error: "Finish and evaluate the interview before starting targeted practice." }, { status: 400 });
    }

    const report = previous.report;
    const prev = previous.blueprint;

    let partial: Partial<InterviewBlueprint> | null = null;
    if (!isDemoMode()) {
      const userPrompt = [
        `PREVIOUS INTERVIEW: ${prev.role} — ${prev.domain} (${prev.seniority}), ${previous.qa.length} questions, overall score ${report.overall_score}/100.`,
        `COMPETENCY MODEL (weights): ${prev.competencies.map((c) => `${c.name} w=${c.weight}`).join("; ")}`,
        `COMPETENCY SCORES: ${prev.competencies.map((c) => `${c.name}: ${c.score ?? "untested"}`).join("; ")}`,
        report.weaknesses.length ? `WEAKNESSES: ${report.weaknesses.join("; ")}` : "",
        report.knowledge_gaps.length ? `KNOWLEDGE GAPS: ${report.knowledge_gaps.join("; ")}` : "",
        report.misconceptions.length ? `MISCONCEPTIONS: ${report.misconceptions.join("; ")}` : "",
        report.next_session.focus_competencies.length ? `FOCUS COMPETENCIES: ${report.next_session.focus_competencies.join("; ")}` : "",
        `RECOMMENDED NEXT DIFFICULTY: ${report.next_session.recommended_difficulty}`,
        `TARGET QUESTION COUNT: ${prev.question_count}`,
        "Design the targeted practice blueprint now.",
      ]
        .filter(Boolean)
        .join("\n");

      partial = await generateJson<Partial<InterviewBlueprint>>({
        patient: true,
        system: PRACTICE_SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 1000,
        temperature: 0.7,
      });
    }

    // Deterministic fallback: double the weight of weak competencies.
    const fallback: Partial<InterviewBlueprint> = {
      role: `${prev.role} — targeted practice`,
      domain: prev.domain,
      seniority: prev.seniority,
      interview_style: prev.interview_style,
      difficulty: report.overall_score >= 75 ? "Hard" : report.overall_score >= 55 ? "Medium" : "Easy",
      question_types: prev.question_types,
      competencies: prev.competencies.map((c) => {
        const weak = c.score != null && c.score < 60;
        const untested = c.score == null;
        return { name: c.name, weight: weak || untested ? c.weight * 2.5 : c.weight * 0.5 };
      }),
      opening_line: `Welcome back. Last time we spotted some gaps in ${report.next_session.focus_competencies.slice(0, 2).join(" and ") || "a few areas"}. This session focuses exactly there — let's get started.`,
    };

    const blueprint = normalizeBlueprint(partial ?? fallback, prev.role, prev.question_count);
    // Normalize case/spacing so we never end up with "— Targeted Practice — targeted practice".
    blueprint.role = /targeted practice/i.test(blueprint.role) ? blueprint.role : `${blueprint.role} — targeted practice`;

    const interview = await createInterview({
      status: "planned",
      blueprint,
      candidate: previous.candidate,
      transcript: [],
      qa: [],
      current_question: 0,
      interview_phase: "WARMUP",
      substantive_asked: 0,
      current_competency: null,
      current_is_follow_up: false,
      difficulty: blueprint.difficulty === "Hard" ? 4 : blueprint.difficulty === "Easy" ? 2 : 3,
      covered_question_types: [],
      communication_indicators: [],
      report: null,
      mode: previous.mode,
      challenge_requested: false,
    });

    const firstCompetency = pickNextCompetency(blueprint, []).name;
    return NextResponse.json({ id: interview.id, blueprint, first_competency: firstCompetency });
  } catch (err) {
    console.error("[practice] failed:", err);
    return NextResponse.json({ error: "Could not create the practice interview. Please try again." }, { status: 500 });
  }
}
