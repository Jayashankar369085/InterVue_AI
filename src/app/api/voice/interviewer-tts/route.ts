// ---------------------------------------------------------------------------
// POST /api/voice/interviewer-tts — ElevenLabs text-to-speech for the
// interviewer. The API key never leaves the server; the browser receives only
// the generated audio stream. On any failure the client falls back to the
// browser's built-in speechSynthesis, so the interview never breaks.
//
// Voice selection (in strict priority):
//   1. INTERVIEWER_VOICE_ID env var          — the configured primary voice
//   2. INTERVIEWER_VOICE_ID_FALLBACK env var — used ONLY when the primary
//      voice is rejected by ElevenLabs (e.g. 402 paid_plan_required: free
//      plans cannot use library voices via the API)
// The primary voice is ALWAYS attempted first; a successful primary attempt
// (HTTP 200) means the fallback is never used.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Primary interviewer voice. The env var always wins; the constant is only the
// default when INTERVIEWER_VOICE_ID is not configured.
const PRIMARY_VOICE_ID = process.env.INTERVIEWER_VOICE_ID?.trim() || "kdmDKE6EkgrWrrykO9Qt";

// Emergency fallback voice — an ElevenLabs built-in that works on every plan.
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
  // Non-secret diagnostics only — never log key values or auth headers.
  console.log(`[voice/interviewer-tts] key=${apiKey ? "present" : "MISSING"} requestedVoice=${PRIMARY_VOICE_ID} fallbackVoice=${FALLBACK_VOICE_ID}`);
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
    // 1. The configured primary voice — always attempted first.
    let attempt = await elevenTts(text, apiKey, PRIMARY_VOICE_ID);
    let usedVoiceId = PRIMARY_VOICE_ID;
    let source: "primary" | "fallback" = "primary";
    console.log(`[voice/interviewer-tts] requestedVoice=${PRIMARY_VOICE_ID} status=${attempt.ok ? 200 : attempt.status}`);

    // 2. Only when ElevenLabs rejects the primary voice (402 paid_plan_required:
    //    free plans cannot use library voices via the API) do we use the
    //    fallback — explicitly identified, never silently.
    if (!attempt.ok && attempt.status === 402) {
      console.warn(`[voice/interviewer-tts] primary voice unavailable (402 paid_plan_required) for voice=${PRIMARY_VOICE_ID}; using fallbackVoice=${FALLBACK_VOICE_ID}`);
      attempt = await elevenTts(text, apiKey, FALLBACK_VOICE_ID);
      console.log(`[voice/interviewer-tts] requestedVoice=${FALLBACK_VOICE_ID} status=${attempt.ok ? 200 : attempt.status}`);
      if (attempt.ok) {
        usedVoiceId = FALLBACK_VOICE_ID;
        source = "fallback";
      }
    }

    if (!attempt.ok) {
      console.error(`[voice/interviewer-tts] ElevenLabs HTTP ${attempt.status} for voice=${usedVoiceId}: ${attempt.detail.slice(0, 200)}`);
      return NextResponse.json({ error: "Interviewer voice is temporarily unavailable.", code: "TTS_FAILED" }, { status: 502 });
    }

    console.log(`[voice/interviewer-tts] servedVoice=${usedVoiceId} source=${source}`);
    return new NextResponse(attempt.res.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        // Observability headers — voice IDs only, never secrets. The client
        // chip and devtools both read these to verify the actual voice used.
        "X-Interviewer-Voice-Id": usedVoiceId,
        "X-Interviewer-Voice-Source": source,
        "X-Interviewer-Voice": usedVoiceId, // legacy alias, same value
      },
    });
  } catch (err) {
    console.error("[voice/interviewer-tts] failed:", (err as Error)?.message ?? err);
    return NextResponse.json({ error: "Interviewer voice is temporarily unavailable.", code: "TTS_FAILED" }, { status: 502 });
  }
}
