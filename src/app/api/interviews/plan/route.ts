// ---------------------------------------------------------------------------
// POST /api/interviews/plan — create an interview blueprint for ANY domain.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createInterview } from "@/lib/interview/store";
import { normalizeBlueprint, pickNextCompetency } from "@/lib/interview/engine";
import { PLANNER_SYSTEM_PROMPT, generateJson, isDemoMode } from "@/lib/ai/llm";
import type { InterviewBlueprint, PlanRequest } from "@/types/interview";

export const runtime = "nodejs";
export const maxDuration = 60;

const LENGTH_MAP: Record<string, number> = { quick: 5, standard: 10, deep: 15 };

function demoBlueprint(req: PlanRequest): InterviewBlueprint {
  // Strip conversational wrappers so the demo role label reads cleanly.
  const role =
    req.description?.trim()
      .replace(/^(please\s+)?(interview me|mock interview)\s+(for|about|on)\s+/i, "")
      .replace(/^(i\s+(want|need|have)\s+)(a|an|my|the)?\s*(interview|preparation)\s*(for|about|tomorrow\s+for)?\s*/i, "")
      .replace(/^(i\s+want\s+(a|an)\s+)(difficult|hard|easy)\s+interview\s+about\s+/i, "")
      .replace(/[.?!]+$/, "")
      .trim() || "Professional";
  const count = LENGTH_MAP[req.length ?? "standard"] ?? 10;
  return {
    role,
    domain: "General",
    seniority: req.experience || "Entry",
    interview_style: req.style || "Realistic",
    difficulty: /difficult|hard|stress/i.test(req.style ?? "") || /difficult|hard/i.test(req.description ?? "") ? "Hard" : "Medium",
    question_count: count,
    competencies: [
      { name: "Core Fundamentals", weight: 0.3, score: null, asked: 0 },
      { name: "Applied Problem Solving", weight: 0.25, score: null, asked: 0 },
      { name: "Role-specific Knowledge", weight: 0.2, score: null, asked: 0 },
      { name: "Communication", weight: 0.15, score: null, asked: 0 },
      { name: "Behavioral", weight: 0.1, score: null, asked: 0 },
    ],
    question_types: ["conceptual", "scenario", "behavioral"],
    opening_line: `Hi, I'm InterVue AI. Today we'll do a ${req.style || "realistic"} interview for the ${role} role. Let's begin — tell me about the background you bring to this role.`,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlanRequest & {
      resumeText?: string;
      resumeSummary?: string;
      resumeSkills?: string[];
      jobDescription?: string;
      jdSummary?: string;
      jdSkills?: string[];
    };
    const description = String(body?.description ?? "").trim();
    if (!description) {
      return NextResponse.json({ error: "Please describe the interview you want (role or domain)." }, { status: 400 });
    }
    if (description.length > 2000) {
      return NextResponse.json({ error: "Description too long (max 2000 chars)." }, { status: 400 });
    }

    const planRequest: PlanRequest = {
      description,
      experience: body.experience ?? "entry",
      style: body.style ?? "realistic",
      length: body.length ?? "standard",
      company: body.company ?? "",
    };
    const targetCount = LENGTH_MAP[planRequest.length ?? "standard"] ?? 10;
    const resumeSummary = typeof body.resumeSummary === "string" ? body.resumeSummary : null;
    const jdSummary = typeof body.jdSummary === "string" ? body.jdSummary : null;

    let blueprintPartial: Partial<InterviewBlueprint> | null = null;
    if (!isDemoMode()) {
      const userPrompt = [
        `CANDIDATE REQUEST: "${description}"`,
        `EXPERIENCE LEVEL: ${planRequest.experience}`,
        `INTERVIEW STYLE: ${planRequest.style}`,
        `TARGET QUESTION COUNT: ${targetCount}`,
        planRequest.company ? `COMPANY CONTEXT: ${planRequest.company}` : "",
        resumeSummary ? `CANDIDATE RESUME SUMMARY: ${resumeSummary}` : "",
        jdSummary ? `JOB DESCRIPTION SUMMARY: ${jdSummary}` : "",
        "Build the interview blueprint now.",
      ]
        .filter(Boolean)
        .join("\n");

      blueprintPartial = await generateJson<Partial<InterviewBlueprint>>({
        patient: true,
        system: PLANNER_SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 1200,
        temperature: 0.8,
      });
    }

    if (!isDemoMode() && !blueprintPartial) {
      // In real mode the LLM planner IS the product — never silently serve a
      // generic fallback blueprint labeled "real". Ask the candidate to retry.
      console.error("[plan] LLM planner unavailable (quota/timeout); refusing to serve a fake blueprint.");
      return NextResponse.json(
        { error: "The AI planner is temporarily overloaded. Please try again in a few seconds — your interview hasn't started yet." },
        { status: 503 }
      );
    }

    const blueprint = normalizeBlueprint(
      blueprintPartial ?? demoBlueprint(planRequest),
      description,
      targetCount
    );
    if (blueprintPartial) blueprint.question_count = targetCount;

    const firstCompetency = pickNextCompetency(blueprint, []);
    const interview = await createInterview({
      status: "planned",
      blueprint,
      candidate: {
        resume_text: typeof body.resumeText === "string" ? body.resumeText.slice(0, 20000) : null,
        resume_summary: resumeSummary,
        resume_skills: Array.isArray(body.resumeSkills) ? body.resumeSkills.map(String).slice(0, 60) : [],
        job_description: typeof body.jobDescription === "string" ? body.jobDescription.slice(0, 20000) : null,
        jd_summary: jdSummary,
        jd_skills: Array.isArray(body.jdSkills) ? body.jdSkills.map(String).slice(0, 60) : [],
        company: planRequest.company || null,
      },
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
      mode: isDemoMode() ? "demo" : "real",
      challenge_requested: false,
    });

    return NextResponse.json({ id: interview.id, blueprint, mode: interview.mode, first_competency: firstCompetency.name });
  } catch (err) {
    console.error("[plan] failed:", err);
    return NextResponse.json({ error: "Could not create the interview plan. Please try again." }, { status: 500 });
  }
}
