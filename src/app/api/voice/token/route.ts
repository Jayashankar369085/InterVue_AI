// ---------------------------------------------------------------------------
// POST /api/voice/token — mint a short-lived AssemblyAI streaming token.
// The permanent API key never leaves the server.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { AssemblyAI } from "assemblyai";

export const runtime = "nodejs";
export const maxDuration = 30;

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function POST() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice is not configured on the server (missing ASSEMBLYAI_API_KEY). Text input still works.", code: "NO_KEY" },
      { status: 503 }
    );
  }
  try {
    // Reuse a token until shortly before expiry to keep reconnects snappy.
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
      return NextResponse.json({ token: cachedToken.token, expires_in: Math.round((cachedToken.expiresAt - Date.now()) / 1000) });
    }
    const client = new AssemblyAI({ apiKey });
    const token = await client.streaming.createTemporaryToken({ expires_in_seconds: 600 });
    cachedToken = { token, expiresAt: Date.now() + 600_000 };
    return NextResponse.json({ token, expires_in: 600 });
  } catch (err) {
    console.error("[voice/token] failed:", (err as Error)?.message ?? err);
    return NextResponse.json(
      { error: "Could not create a voice session. Voice transcription may be unavailable — text input still works.", code: "TOKEN_FAILED" },
      { status: 502 }
    );
  }
}
