// ---------------------------------------------------------------------------
// POST /api/documents/parse — upload a resume or job description.
// Extracts text from PDF/DOCX/TXT and structures it with the LLM.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { DOC_ANALYZER_SYSTEM_PROMPT, generateJson, isDemoMode } from "@/lib/ai/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

type DocKind = "resume" | "job_description";
type DocAnalysis = {
  summary: string;
  skills: string[];
  projects?: { name: string; description?: string; technologies?: string[] }[];
  experience?: { role: string; company?: string; period?: string; details?: string }[];
  education?: string[];
  certifications?: string[];
  highlights: string[];
  seniority?: string;
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

async function extractText(file: File): Promise<string> {
  const name = (file.name || "upload").toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { extractText: unpdfExtract, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await unpdfExtract(pdf, { mergePages: true });
    return String(text ?? "");
  }
  if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return String(value ?? "");
  }
  if (name.endsWith(".doc")) {
    throw new Error("Legacy .doc files are not supported. Please save as .docx or PDF.");
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return new TextDecoder().decode(bytes);
  }
  throw new Error("Unsupported file type. Upload a PDF, DOCX, TXT or MD file.");
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const kind = (String(formData.get("kind") || "resume") as DocKind) ?? "resume";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 5 MB)." }, { status: 413 });
    }

    const text = (await extractText(file)).replace(/\s+/g, " ").trim();
    if (!text || text.length < 20) {
      return NextResponse.json(
        { error: "Could not read any text from this file. It may be a scanned image — try a text-based PDF or paste the content instead." },
        { status: 422 }
      );
    }

    const clipped = text.slice(0, 12000);

    if (isDemoMode()) {
      return NextResponse.json({
        text: clipped,
        analysis: {
          summary: clipped.slice(0, 240),
          skills: [],
          projects: [],
          experience: [],
          education: [],
          certifications: [],
          highlights: [],
        } satisfies DocAnalysis,
        demo: true,
        demo_notice: "LLM parsing unavailable — resume context will be limited to raw text matching.",
        demo_notice_paste: "For full AI parsing without an LLM key, paste key skills and projects into the role field.",
      });
    }

    const analysis = await generateJson<DocAnalysis>({
      patient: true,
      system: DOC_ANALYZER_SYSTEM_PROMPT,
      user: `DOCUMENT TYPE: ${kind === "resume" ? "CANDIDATE RESUME" : "JOB DESCRIPTION"}\n\nTEXT:\n${clipped}\n\nExtract the structured summary now.`,
      maxTokens: 900,
      temperature: 0.3,
    });

    return NextResponse.json({
      text: clipped,
      analysis: analysis ?? { summary: clipped.slice(0, 240), skills: [], projects: [], experience: [], education: [], certifications: [], highlights: [] },
      demo: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse document.";
    console.error("[documents/parse] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
