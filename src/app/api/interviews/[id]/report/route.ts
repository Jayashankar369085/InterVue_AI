// ---------------------------------------------------------------------------
// POST /api/interviews/[id]/report — finish the interview and generate the
// final report. GET returns the stored report if it exists.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { getInterview, saveReport } from "@/lib/interview/store";
import { generateFinalReport } from "@/lib/interview/engine";
import { isDemoMode } from "@/lib/ai/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const interview = await getInterview(id);
  if (!interview) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }
  if (!interview.report) {
    return NextResponse.json({ error: "Report not generated yet." }, { status: 404 });
  }
  return NextResponse.json({ interview, report: interview.report });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const interview = await getInterview(id);
    if (!interview) {
      return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    }
    if (interview.report) {
      return NextResponse.json({ interview, report: interview.report });
    }
    if (interview.qa.length === 0) {
      return NextResponse.json({ error: "No answers were recorded in this interview, so there is nothing to evaluate." }, { status: 400 });
    }

    // Mirrors the engine's own LLM-attempt condition, so the client can tell an
    // AI-generated report from the deterministic fallback (shown honestly, never faked).
    const usedLlm = !isDemoMode() && interview.qa.some((q) => q.evaluation);
    const report = await generateFinalReport(interview, isDemoMode());
    const saved = await saveReport(id, report);
    if (!saved) {
      return NextResponse.json({ error: "Could not save the report." }, { status: 500 });
    }
    if (!usedLlm) {
      console.warn(`[report] fallback report served for ${id} (LLM unavailable or no evaluated answers).`);
    }
    return NextResponse.json({ interview: saved, report: saved.report, generated_with_llm: usedLlm });
  } catch (err) {
    console.error("[report] failed:", err);
    return NextResponse.json({ error: "Could not generate the final report. Please retry." }, { status: 500 });
  }
}
