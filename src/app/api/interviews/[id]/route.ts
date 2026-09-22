// ---------------------------------------------------------------------------
// GET /api/interviews/[id] — fetch interview state (refresh recovery).
// DELETE /api/interviews/[id] — abort an interview.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { getInterview, updateInterview } from "@/lib/interview/store";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const interview = await getInterview(id);
  if (!interview) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }
  return NextResponse.json({ interview, mode: interview.mode });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const updated = await updateInterview(id, (i) => ({ ...i, status: i.status === "completed" ? i.status : "aborted" }));
  if (!updated) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

// PATCH — persist client-side conversation lines (e.g. the spoken greeting)
// so a refresh restores the EXACT conversation including warm-up turns.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { append_ai_line?: string };
    const line = String(body?.append_ai_line ?? "").trim();
    if (!line) {
      return NextResponse.json({ error: "Nothing to append." }, { status: 400 });
    }
    const updated = await updateInterview(id, (i) => {
      // Don't double-append after a refresh.
      if (!i.transcript.some((t) => t.role === "ai" && t.text === line)) {
        i.transcript.push({ role: "ai", text: line, at: new Date().toISOString() });
      }
      return i;
    });
    if (!updated) {
      return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update the interview." }, { status: 500 });
  }
}
