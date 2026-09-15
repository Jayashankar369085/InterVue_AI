import { NextResponse } from "next/server";
import { AssemblyAI } from "assemblyai";

export async function POST() {
  try {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json({ error: "ASSEMBLYAI_API_KEY is not set" }, { status: 500 });
    }

    const client = new AssemblyAI({ apiKey });
    const token = await client.realtime.createTemporaryToken({ expires_in: 3600 });
    
    return NextResponse.json({ token });
  } catch (error) {
    console.error("Error generating AssemblyAI token:", error);
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}
