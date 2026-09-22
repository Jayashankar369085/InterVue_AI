// ---------------------------------------------------------------------------
// GET /api/interviews/list — recent interviews for the history page.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { listInterviews } from "@/lib/interview/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const interviews = await listInterviews(50);
    return NextResponse.json({
      interviews: interviews.map((i) => ({
        id: i.id,
        role: i.blueprint.role,
        domain: i.blueprint.domain,
        status: i.status,
        mode: i.mode,
        created_at: i.created_at,
        questions: i.qa.length,
        score: i.report?.overall_score ?? null,
      })),
    });
  } catch (err) {
    console.error("[list] failed:", err);
    return NextResponse.json({ interviews: [] });
  }
}
