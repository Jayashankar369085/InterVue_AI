// ---------------------------------------------------------------------------
// POST /api/voice/transcribe — transcribe a recorded answer blob.
// Uses the CURRENT AssemblyAI SDK (v4) sync transcription API:
//   client.sync.transcribe(audio: Blob, config)  // positional args
//   config.model + config.conversation_context are the v4 fields.
// The old `client.transcripts.transcribe(...)` call used previously does not
// exist in this SDK version and always failed.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { AssemblyAI } from "assemblyai";
import { analyzeUtterance } from "@/lib/interview/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024; // ~15 MB, several minutes of compressed audio

export async function POST(req: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Voice transcription is not configured on the server. Type your answer instead.", code: "NO_KEY" }, { status: 503 });
  }
  try {
    const formData = await req.formData();
    const file = formData.get("audio");
    const context = String(formData.get("context") || "");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No audio received. Try recording again." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Recording too long (max ~4 minutes). Please answer more briefly." }, { status: 413 });
    }
    if (file.size < 2000) {
      // Too small to contain meaningful speech; avoids pointless API calls.
      return NextResponse.json({ text: "", duration_seconds: 0, indicators: null });
    }

    const client = new AssemblyAI({ apiKey });
    const blob = new Blob([await file.arrayBuffer()], { type: file.type || "audio/webm" });

    const transcript = await client.sync.transcribe(blob, {
      model: "universal-3-5-pro",
      timestamps: true,
      // Give the decoder conversational context for better accuracy on
      // domain-specific vocabulary (capped by the SDK itself).
      ...(context ? { conversation_context: context.slice(-4000) } : {}),
    });

    const text = String(transcript?.text ?? "").trim();
    const durationSeconds =
      transcript?.audio_duration_ms && transcript.audio_duration_ms > 0 ? Math.round(transcript.audio_duration_ms / 100) / 10 : null;

    return NextResponse.json({
      text,
      duration_seconds: durationSeconds,
      indicators: text ? analyzeUtterance(text, durationSeconds) : null,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? "Transcription failed";
    console.error("[voice/transcribe] failed:", message);
    return NextResponse.json(
      { error: "Voice transcription failed. Check your connection or type your answer instead.", detail: message.slice(0, 200) },
      { status: 502 }
    );
  }
}
