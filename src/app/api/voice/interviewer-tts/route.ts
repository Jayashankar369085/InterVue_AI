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

// eleven_flash_v2_5: ElevenLabs' lowest-latency speech model — the right fit
// for a live interview where each question must start playing quickly.
const TTS_MODEL = "eleven_flash_v2_5";

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${INTERVIEWER_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: TTS_MODEL,
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.8,
            style: 0.25,
            use_speaker_boost: true,
            speed: 1.02,
          },
        }),
      }
    );
    clearTimeout(timer);

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error(`[voice/interviewer-tts] ElevenLabs HTTP ${upstream.status}: ${detail.slice(0, 200)}`);
      return NextResponse.json(
        { error: "Interviewer voice is temporarily unavailable.", code: "TTS_FAILED" },
        { status: 502 }
      );
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    console.error("[voice/interviewer-tts] failed:", (err as Error)?.message ?? err);
    return NextResponse.json(
      { error: "Interviewer voice is temporarily unavailable.", code: "TTS_FAILED" },
      { status: 502 }
    );
  }
}
