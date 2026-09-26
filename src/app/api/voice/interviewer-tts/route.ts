// ---------------------------------------------------------------------------
// POST /api/voice/interviewer-tts — ElevenLabs text-to-speech for the
// interviewer. The API key never leaves the server; the browser receives only
// the generated audio stream. On any failure the client falls back to the
// browser's built-in speechSynthesis, so the interview never breaks.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// The user-selected interviewer voice (existing ElevenLabs library voice).
export const INTERVIEWER_VOICE_ID = "oClOrzqamOXmtcB8iqTj";

// ElevenLabs' free plan cannot use library/community voices over the API
// (upstream 402 paid_plan_required). When the selected voice is unavailable
// we fall back to a built-in voice so the interviewer still speaks with an
// ElevenLabs voice today; after a plan upgrade the primary voice works again
// with no code change. Override with INTERVIEWER_VOICE_ID_FALLBACK if needed.
const FALLBACK_VOICE_ID = process.env.INTERVIEWER_VOICE_ID_FALLBACK?.trim() || "JBFqnCBsd6RMkjVDRZzb";

// eleven_flash_v2_5: ElevenLabs' lowest-latency speech model — the right fit
// for a live interview where each question must start playing quickly.
const TTS_MODEL = "eleven_flash_v2_5";

const VOICE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.8,
  style: 0.25,
  use_speaker_boost: true,
  speed: 1.02,
};

/** Speak `text` with `voiceId`. Returns the upstream Response or failure details. */
async function elevenTts(
  text: string,
  apiKey: string,
  voiceId: string
): Promise<{ ok: true; res: Response } | { ok: false; status: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: TTS_MODEL, voice_settings: VOICE_SETTINGS }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      return { ok: false, status: res.status, detail };
    }
    return { ok: true, res };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Interviewer voice is not configured on the server (missing ELEVENLABS_API_KEY).", code: "NO_KEY" },
      { status: 503 }
    );
  }

  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = String(body?.text ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Missing text to speak." }, { status: 400 });
  }
  if (text.length > 2000) {
    text = text.slice(0, 2000); // interviewer lines are short; hard cap for safety
  }

  try {
    // Primary: the user-selected voice.
    let attempt = await elevenTts(text, apiKey, INTERVIEWER_VOICE_ID);
    let usedFallback = false;
    // Fallback: free plans cannot use library voices via the API (402
    // paid_plan_required) — speak with a built-in ElevenLabs voice instead of
    // silence. After a plan upgrade the primary voice simply works again.
    if (!attempt.ok && attempt.status === 402) {
      console.warn("[voice/interviewer-tts] selected voice unavailable on this plan (402 paid_plan_required); using built-in ElevenLabs voice fallback.");
      attempt = await elevenTts(text, apiKey, FALLBACK_VOICE_ID);
      usedFallback = attempt.ok;
    }
    if (!attempt.ok) {
      console.error(`[voice/interviewer-tts] ElevenLabs HTTP ${attempt.status}: ${attempt.detail.slice(0, 200)}`);
      return NextResponse.json({ error: "Interviewer voice is temporarily unavailable.", code: "TTS_FAILED" }, { status: 502 });
    }

    return new NextResponse(attempt.res.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        // Observable in devtools for verification; contains only a voice ID, no secret.
        "X-Interviewer-Voice": usedFallback ? FALLBACK_VOICE_ID : INTERVIEWER_VOICE_ID,
      },
    });
  } catch (err) {
    console.error("[voice/interviewer-tts] failed:", (err as Error)?.message ?? err);
    return NextResponse.json({ error: "Interviewer voice is temporarily unavailable.", code: "TTS_FAILED" }, { status: 502 });
  }
}
