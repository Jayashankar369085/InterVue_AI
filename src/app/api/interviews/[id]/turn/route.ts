// ---------------------------------------------------------------------------
// POST /api/interviews/[id]/turn — submit an answer, evaluate it, get the
// adaptive next question. This is the heart of the interview loop.
//
// Lifecycle (spec 2A/2B/2F):
//   WARMUP     — AI asked "How's your day going?"    → answer not counted
//   SELF_INTRO — AI invited "tell me about yourself" → answer not counted;
//                the evaluator crafts Q1 from the self-intro (never hardcoded)
//   TECHNICAL  — every question asked (top-level OR follow-up) is substantive
//                and consumes exactly one question slot ON ASK
//
// Completion (spec 2C/2H): the interview ends the turn AFTER the target-th
// substantive question has been ANSWERED — that final answer is fully
// transcribed and evaluated first, then the AI speaks a natural closing line.
// No question #target+1 is ever generated, and the guard runs inside the
// state mutator against fresh persisted state (spec 2I race protection).
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { getInterview, updateInterview } from "@/lib/interview/store";
import {
  analyzeUtterance,
  buildClosingLine,
  buildOpeningPlan,
  clampDifficulty,
  pickNextCompetency,
  runEvaluationTurn,
  updateCompetencyScores,
} from "@/lib/interview/engine";
import { isDemoMode } from "@/lib/ai/llm";
import type { Evaluation, QAEntry, TurnRequest, TurnResponse } from "@/types/interview";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Neutral placeholder for warm-up turns — never recorded into qa. */
function warmupEvaluation(): Evaluation {
  return {
    scores: { relevance: 5, correctness: 5, completeness: 5, depth: 5, reasoning: 5, communication: 5, overall: 5 },
    strengths: [],
    weaknesses: [],
    missing_concepts: [],
    misconceptions: [],
    relevance_note: "Warm-up conversation — not evaluated.",
    next_action: "ASK_FOLLOW_UP",
    next_question_text: "",
    next_competency: "",
    acknowledgement: "",
    difficulty_delta: 0,
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const interview = await getInterview(id);
    if (!interview) {
      return NextResponse.json({ error: "Interview not found. It may have expired." }, { status: 404 });
    }
    if (interview.status === "completed" || interview.status === "aborted") {
      return NextResponse.json({ error: "This interview has already ended." }, { status: 409 });
    }

    const body = (await req.json()) as TurnRequest;
    const answer = String(body?.answer ?? "").slice(0, 8000);
    const challenge = Boolean(body?.challenge);
    const durationSeconds = Number.isFinite(Number(body?.duration_seconds)) ? Number(body.duration_seconds) : null;

    if (!answer.trim() && !challenge) {
      return NextResponse.json({ error: "Empty answer. Say or type a response first." }, { status: 400 });
    }

    const phase = interview.interview_phase ?? "WARMUP";

    // -------- 1. Produce the AI's reply for this turn --------
    let evaluation: Evaluation;
    let reply = "";
    let isFollowUp = false;
    let degraded = false;
    let degradedReason: string | undefined = undefined;

    if (phase === "WARMUP") {
      // Greeting answered → invite the self-intro. No LLM call needed.
      evaluation = warmupEvaluation();
      reply = buildOpeningPlan(interview.blueprint).selfIntroPrompt;
    } else {
      // SELF_INTRO and TECHNICAL both go through the evaluator. On SELF_INTRO
      // the "question" being answered is the intro invitation, and the
      // evaluator must craft substantive Q1 from it.
      const result = await runEvaluationTurn(interview, answer, {
        challenge,
        durationSeconds,
        demoMode: isDemoMode(),
        selfIntroContext: phase === "SELF_INTRO" ? answer : undefined,
        forceNewQuestion: phase === "SELF_INTRO",
      });
      evaluation = result.evaluation ?? warmupEvaluation();
      reply = result.reply;
      isFollowUp = result.isFollowUp;
      degraded = result.degraded;
      degradedReason = result.degradedReason;
    }

    // -------- 2. Atomically apply the turn to persisted state --------
    const turnPayload = { answer, challenge, durationSeconds, evaluation, reply, isFollowUp, phase };

    const updated = await updateInterview(id, (i) => {
      // Legacy interviews created before the phase machine have no phase —
      // treat anything with recorded answers (or a live conversation) as TECHNICAL.
      const freshPhase = i.interview_phase ?? (i.qa.length > 0 ? "TECHNICAL" : "WARMUP");
      const target = i.blueprint.question_count;
      const askedBefore = i.substantive_asked ?? Math.max(i.current_question ?? 0, i.qa.length);

      // -- Record the candidate's answer --
      if (answer.trim()) {
        i.transcript.push({ role: "user", text: answer, at: new Date().toISOString() });

        if (freshPhase === "TECHNICAL") {
          // The answered question is the last AI line BEFORE this answer.
          const aiLines = i.transcript.filter((t) => t.role === "ai");
          const currentQuestionText = aiLines[aiLines.length - 1]?.text ?? "";
          const competency = i.current_competency ?? pickNextCompetency(i.blueprint, i.qa).name;
          const entry: QAEntry = {
            id: crypto.randomUUID(),
            question: currentQuestionText,
            answer,
            question_index: Math.max(1, askedBefore),
            is_follow_up: i.current_is_follow_up ?? false,
            competency,
            difficulty: i.difficulty,
            evaluation,
            created_at: new Date().toISOString(),
            duration_seconds: durationSeconds,
          };
          i.qa.push(entry);
          if (durationSeconds != null) {
            i.communication_indicators.push(analyzeUtterance(answer, durationSeconds));
          }
          if (evaluation) {
            updateCompetencyScores(i, evaluation, competency);
          }
          i.difficulty = clampDifficulty(i.difficulty + (evaluation?.difficulty_delta || 0));
        }
      }

      // -- Phase transition & next question --
      let finalReply = reply;
      let complete = false;

      if (freshPhase === "WARMUP") {
        i.interview_phase = "SELF_INTRO";
      } else if (freshPhase === "SELF_INTRO") {
        // The evaluator's reply IS substantive question #1 — speak the
        // transition line then ask it (spec 2B: "Great. Let's get into it.").
        i.current_competency = evaluation.next_competency?.trim() || pickNextCompetency(i.blueprint, i.qa).name;
        i.current_is_follow_up = false;
        i.substantive_asked = askedBefore + 1;
        i.current_question = i.substantive_asked;
        i.interview_phase = "TECHNICAL";
        finalReply = `Great, thanks for that. Let's get into it. ${reply}`;
      } else {
        // TECHNICAL: the engine's reply is the next question — it consumes
        // the NEXT slot, but only if the plan isn't exhausted (guard below).
        i.interview_phase = "TECHNICAL";
      }

      // -- Completion guard (spec 2I): runs against FRESH state --
      const answeredSubstantive = i.qa.length; // every qa entry = one answered substantive question
      if (freshPhase === "TECHNICAL") {
        if (answeredSubstantive >= target) {
          // The target-th question has now been ANSWERED. Close the interview.
          // Never generate question #target+1.
          complete = true;
          i.interview_phase = "COMPLETED";
          finalReply = buildClosingLine(i.blueprint);
        } else if (reply) {
          // Ask the next question: it consumes slot askedBefore+1.
          i.current_competency = evaluation.next_competency?.trim() || pickNextCompetency(i.blueprint, i.qa).name;
          i.current_is_follow_up = isFollowUp;
          i.substantive_asked = askedBefore + 1;
          i.current_question = i.substantive_asked;
        }
      }

      if (finalReply) {
        i.transcript.push({ role: "ai", text: finalReply, at: new Date().toISOString() });
      }

      i.challenge_requested = false;
      i.status = complete ? "completed" : "active";
      return i;
    });

    if (!updated) {
      return NextResponse.json({ error: "Interview was deleted or could not be saved." }, { status: 500 });
    }

    const spokenReply = updated.transcript.filter((t) => t.role === "ai").slice(-1)[0]?.text ?? reply;

    const response: TurnResponse = {
      interview: updated,
      evaluation: updated.interview_phase === "WARMUP" || updated.interview_phase === "SELF_INTRO" ? null : evaluation,
      reply: spokenReply,
      interview_complete: updated.status === "completed",
      degraded,
      degraded_reason: degradedReason,
    };
    if (degraded) console.warn(`[turn] degraded reply served (demo=${isDemoMode()}): ${degradedReason ?? "unknown"}`);
    return NextResponse.json(response);
  } catch (err) {
    console.error("[turn] failed:", err);
    return NextResponse.json({ error: "The reasoning engine could not process that answer. Please try again." }, { status: 500 });
  }
}
