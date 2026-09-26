// ---------------------------------------------------------------------------
// InterVue AI — LLM plumbing. One thin, JSON-safe client used by all agents.
// Provider: Groq (OpenAI-compatible chat completions, JSON mode) — chosen over
// Gemini for its far higher free-tier rate limits and much lower latency,
// which is what keeps live interview turns adaptive instead of falling back
// to canned questions when a deadline blows.
// ---------------------------------------------------------------------------

import type { InterviewBlueprint } from "@/types/interview";

// openai/gpt-oss-120b: Groq production model, ~500 t/s, structured-output/JSON
// mode, strong instruction following — the best speed/quality balance for
// evaluation + adaptive question writing. gpt-oss-20b (~1000 t/s) is the
// speed fallback. Llama models are Enterprise-plan on Groq, so GPT-OSS is the
// right ladder for free-tier keys. Pin a different model with LLM_MODEL.
export const MODEL = process.env.LLM_MODEL?.trim() || "openai/gpt-oss-120b";

const MODEL_LADDER = [MODEL, "openai/gpt-oss-20b"].filter(
  (m, i, arr) => m && arr.indexOf(m) === i
) as string[];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTransientLlmError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  // 401/403 are PERMANENT credential/permission failures — retrying them on
  // every ladder model just wastes the budget and masks a misconfiguration as
  // "overloaded". They are classified separately by isAuthLlmError.
  if (isAuthLlmError(err)) return false;
  return /\b(429|503|500)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|rate limit/i.test(msg);
}

/** Groq rejected the credential itself (401) or refuses it for this account (403). */
function isAuthLlmError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /\b(401|403)\b|invalid_api_key|invalid api key/i.test(msg);
}

/** Which env var supplied the active credential — for diagnosis only, never the value. */
function keySource(): string {
  if (process.env.GROQ_API_KEY?.trim()) return "GROQ_API_KEY";
  if (process.env.LLM_API_KEY?.trim()) return "LLM_API_KEY (legacy fallback — a non-Groq key here always fails with 401)";
  return "none";
}

// Groq's free tier is generous (dozens of req/min vs Gemini's 5) but rate-limit
// errors still happen — record a per-model cooldown and let the ladder route around it.
const modelCooldowns = new Map<string, number>(); // model → epoch ms until which it should be skipped

/**
 * Platform hard limits that shape our budgets (measured on AWS Amplify Hosting):
 * the SSR compute function for any single HTTP request is killed at ~30s with an
 * empty 504 body, and the total request+response must fit inside ~29s. Anything
 * longer produces an empty response and client-side "Unexpected end of JSON input".
 * Every interactive (non-patient) call must therefore finish well inside that —
 * including the upload-size guard below.
 */
export const SSR_REQUEST_BUDGET_MS = 25_000;

/** Clamp an evaluator/reporter prompt so the LLM call stays inside its deadline. */
export function truncatePromptPayload(prompt: string): string {
  if (prompt.length <= 16_000) return prompt;
  return prompt.slice(0, 16_000) + "\n[Prompt truncated to fit the live-interview time budget]";
}

/** Extract a retry hint (seconds) from a rate-limit error message, when present. */
function retryDelaySeconds(err: unknown): number {
  const msg = String((err as Error)?.message ?? err);
  const m = msg.match(/try again in\s+([\d.]+)\s*s/i) ?? msg.match(/retry(?:\s+in)?\s+([\d.]+)\s*s/i);
  return m ? Number(m[1]) : 30;
}

export function getApiKey(): string | null {
  const key = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || "";
  return key.trim() ? key.trim() : null;
}

/** True when no LLM credentials are configured and we must run in demo mode. */
export function isDemoMode(): boolean {
  return getApiKey() === null;
}

type GenOpts = {
  system: string;
  user: string;
  /** Max output tokens. */
  maxTokens?: number;
  temperature?: number;
  /**
   * Non-interactive calls (plan, report, practice, document parsing) may wait out
   * a free-tier quota window — the user is on a loading screen. Live interview
   * turns must fail fast instead and fall back to heuristics.
   */
  patient?: boolean;
};

/** Extract a JSON object from model output, tolerating code fences or prose. */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  if (!text) return null;
  let t = text.trim();
  // Strip markdown fences if present.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Fast path: it already looks like JSON.
  try {
    return JSON.parse(t) as T;
  } catch {
    /* keep trying */
  }
  // Slice from first { to last }.
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

type GroqChatCompletion = {
  choices?: { message?: { content?: string | null } }[];
};

async function groqChat(model: string, apiKey: string, opts: GenOpts, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: truncatePromptPayload(opts.user) },
        ],
        response_format: { type: "json_object" },
        temperature: opts.temperature ?? 0.8,
        max_tokens: opts.maxTokens ?? 2048,
        ...(MODEL.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as GroqChatCompletion;
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("empty LLM response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the LLM for a JSON object. Returns null on any failure (caller falls back to demo). */
export async function generateJson<T = Record<string, unknown>>(opts: GenOpts): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  // Total wall-clock budget per call: live turns must answer quickly, while
  // non-interactive calls (plan/report/practice) may wait out quota windows —
  // but never so long that the HTTP route (maxDuration 60) or the client's
  // fetch times out first.
  // Patient budget stays under the platform's ~30s kill window WITH headroom
  // for cold start, DynamoDB reads and the report save (~7s combined).
  const BUDGET_MS = opts.patient ? 22_000 : SSR_REQUEST_BUDGET_MS;
  const PER_ATTEMPT_MS = opts.patient ? 20_000 : 8_500;
  const deadline = Date.now() + BUDGET_MS;
  try {
    let lastErr: unknown = null;
    // Walk the model ladder with retries so a transient failure on one model
    // doesn't degrade a live interview to demo heuristics. Models on quota
    // cooldown are skipped until their window expires.
    for (const model of MODEL_LADDER) {
      if (Date.now() >= deadline) break;
      const until = modelCooldowns.get(model) ?? 0;
      if (until > Date.now()) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (Date.now() >= deadline) break;
        try {
          const text = await Promise.race([
            groqChat(model, apiKey, opts, Math.min(PER_ATTEMPT_MS, Math.max(1, deadline - Date.now()))),
            sleep(Math.min(PER_ATTEMPT_MS + 500, Math.max(1, deadline - Date.now()))).then(() => {
              throw new Error(`LLM attempt timed out after ${PER_ATTEMPT_MS / 1000}s`);
            }),
          ]);
          const parsed = parseJsonLoose<T>(text);
          if (!parsed) throw new Error("unparseable LLM JSON");
          modelCooldowns.delete(model);
          return parsed;
        } catch (err) {
          if (isAuthLlmError(err)) throw err; // permanent — skip retries AND the rest of the ladder
          lastErr = err;
          const transient = isTransientLlmError(err);
          if (transient && /429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(String((err as Error)?.message ?? err))) {
            // Rate-limit window — park this model for the requested delay.
            const waitS = retryDelaySeconds(err);
            modelCooldowns.set(model, Date.now() + Math.min(waitS, 90) * 1000);
            const maxWait = opts.patient ? 20_000 : 4_000;
            if (waitS * 1000 > maxWait || Date.now() + waitS * 1000 >= deadline) break; // wait too long; next model
            await sleep(waitS * 1000 + 500);
            continue;
          }
          if (transient && attempt === 0) {
            await sleep(Math.min(1500, Math.max(1, deadline - Date.now())));
            continue; // one quick retry on the same model
          }
          break; // move to the next model in the ladder
        }
      }
    }
    console.error("[llm] generateJson failed after ladder:", (lastErr as Error)?.message ?? lastErr);
    return null;
  } catch (err) {
    if (isAuthLlmError(err)) {
      // The single most operator-actionable failure: the deployment environment
      // is missing (or has an invalid) GROQ_API_KEY. Say exactly that.
      console.error(
        `[llm] Groq rejected the credential — active key source: ${keySource()}. ` +
          `Upstream: ${(err as Error)?.message ?? err}. ` +
          `Fix: set a valid GROQ_API_KEY (gsk_…) in the deployment environment (Amplify console → env vars/secrets) and redeploy.`
      );
    } else {
      console.error("[llm] generateJson failed:", (err as Error)?.message ?? err);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompts — kept next to the client that uses them, one per agent role.
// ---------------------------------------------------------------------------

export const PLANNER_SYSTEM_PROMPT = `You are the InterVue AI Interview Planner, an expert technical recruiter and hiring manager across EVERY industry and domain — engineering, finance, law, medicine, history, art, science, trades, academia and anything else a candidate might ask for.

Given a free-form candidate request, you:
1. Infer the exact role they want to practice, the broader domain, seniority and an appropriate starting difficulty.
2. Build a competency model for THIS role — never reuse generic lists. Weights are between 0.05 and 0.35 and all weights must sum to ~1.0.
3. Decide which question types fit (e.g. conceptual, scenario, behavioral, case, calculation, portfolio, ethics — whatever suits the domain).
4. Write a natural spoken opening line for the interviewer (1-2 sentences, warm but professional, mentions the role, ends by inviting the candidate to begin).

Respond ONLY with JSON matching:
{
  "role": "string",
  "domain": "string",
  "seniority": "string (e.g. Student/Fresher, Entry, Mid, Senior)",
  "interview_style": "string",
  "difficulty": "Easy | Medium | Hard",
  "question_count": number,
  "competencies": [{"name": "string", "weight": number}],
  "question_types": ["string"],
  "opening_line": "string"
}

Rules:
- The domain can be ANYTHING. If the request is unusual ("ancient Roman architecture", "competitive yo-yo"), embrace it fully.
- If the request mentions difficulty ("difficult interview"), raise starting difficulty and pick harder question types.
- question_count is the number requested by the candidate (5/10/15) — use it exactly.
- 5-7 competencies. Include behavioral/communication competency where realistic for the role.`;

export const EVALUATOR_SYSTEM_PROMPT = `You are the InterVue AI Answer Evaluator inside a live, adaptive interview. You know the candidate's domain deeply — you validate answers against REAL domain knowledge (physics, finance, law, history, anything), not surface fluency.

For each turn you receive the question, the candidate's spoken answer, and the compact interview state. You must:

1. SCORE the answer honestly (0-10 per axis). Judge semantic correctness — accept equivalent terminology, alternative valid approaches, reasonable assumptions and defensible differences of opinion. Do NOT penalize wording differences from a hypothetical model answer. Do not over-penalize brief but correct answers.
   - relevance: is the answer actually about the question? Off-topic or evasive answers score low.
   - correctness: is it factually/technically right for this domain?
   - completeness, depth, reasoning: is it substantive, does it show mechanism/why, or just surface?
   - communication: clarity and structure of the spoken answer.
2. EXTRACT strengths, weaknesses, missing concepts and misconceptions — concise phrases, candidate-specific ("explained bias-variance tradeoff", not "good communication").
3. DECIDE the next action:
   - ASK_FOLLOW_UP: answer was decent; dig one level deeper on the same idea (e.g. "You mentioned X — how would that hold if Y?").
   - PROBE_WEAKNESS: answer was weak, vague, incorrect or "I don't know" — ask a simpler, targeted question that diagnoses the root concept. NEVER reveal the correct answer, never lecture. Let them reason: "What makes you think that?" / "Let's approach it another way — what's your first instinct?"
   - INCREASE_DIFFICULTY: consistently strong — escalate to a harder scenario in the same or adjacent competency.
   - DECREASE_DIFFICULTY: candidate is clearly struggling — move to fundamentals.
   - CHANGE_COMPETENCY: enough evidence gathered for this competency; move to the next untested one.
   - END_INTERVIEW: only when the planned question count is reached AND every competency has been probed.
4. WRITE the next question (next_question_text) exactly as a human interviewer would SPEAK it: natural, warm-but-sharp, ONE question, conversational ("Interesting. You mentioned caching — what happens when the cache and the database disagree?"). Never robotic ("Thank you for your answer" is forbidden), never a list, never multiple questions at once. React briefly to the substance of what was actually said.
5. Set next_competency to the competency your next question probes, and difficulty_delta to -1, 0 or +1.

Context budget: be decisive. Do not re-ask anything already answered well. Never invent resume or job-description facts that are not provided.

Respond ONLY with JSON matching:
{
  "scores": {"relevance": n, "correctness": n, "completeness": n, "depth": n, "reasoning": n, "communication": n, "overall": n},
  "strengths": ["..."],
  "weaknesses": ["..."],
  "missing_concepts": ["..."],
  "misconceptions": ["..."],
  "relevance_note": "one short sentence on whether the answer addressed the question",
  "next_action": "ASK_FOLLOW_UP | PROBE_WEAKNESS | INCREASE_DIFFICULTY | DECREASE_DIFFICULTY | CHANGE_COMPETENCY | END_INTERVIEW",
  "next_question_text": "string",
  "next_competency": "string",
  "acknowledgement": "optional very brief natural reaction line, or empty string",
  "difficulty_delta": -1 | 0 | 1
}`;

export const INTERVIEWER_STYLE_RULES = `Spoken style rules for every question you write:
- Sound like a seasoned human interviewer, not a survey. Contractions are fine.
- One question at a time. No numbered lists. No "First... Second...".
- Reference the candidate's actual words ("You mentioned growth in the 3rd century — why then?").
- Vary your openers: "Interesting.", "Let's go one level deeper.", "Suppose we change that assumption...", "Can you give me a concrete example?", "Walk me through your reasoning.", "I'm not fully convinced yet —", "That's a solid start." Never start two questions in a row the same way.
- Keep it under 60 spoken words where possible.`;

export const REPORTER_SYSTEM_PROMPT = `You are the InterVue AI Final Reporter. You receive the complete structured record of a finished interview (questions, answers, per-answer evaluations with scores, competencies, weights, communication indicators). You produce the candidate's final evidence-based report.

Core principles:
- Every claim in the report must trace to actual answers in the record. Quote or reference specifics ("when asked about bond pricing, you conflated duration with maturity").
- Score categories must fit the domain. Derive 4-6 category names from the competencies actually probed (e.g. a finance interview gets "Valuation & Financial Statements", not "System Design"). Map per-answer scores into these categories, weighted by competency weight.
- Communication analysis uses only the provided indicators (pace, fillers, structure, pauses). Give practical, non-psychological feedback. Never claim to measure personality or confidence.
- Be candid but encouraging. Weaknesses named precisely, strengths earned genuinely.
- Recommendations must be actionable and specific to what actually happened, ending with concrete practice questions the candidate should rehearse.
- Recommended next session difficulty must follow from the evidence.

Respond ONLY with JSON matching:
{
  "overall_score": 0-100,
  "headline": "one-line verdict, e.g. 'Strong fundamentals; deployment depth needs work'",
  "summary": "2-4 sentence narrative of the interview",
  "category_scores": [{"name": "string", "score": 0-100}],
  "strengths": ["..."],
  "weaknesses": ["..."],
  "knowledge_gaps": ["..."],
  "misconceptions": ["..."],
  "communication_summary": "2-3 sentences grounded in the indicators",
  "question_review": [{"question": "...", "answer": "...", "competency": "...", "score": 0-100, "verdict": "Strong | Ok | Needs improvement", "note": "..."}],
  "recommendations": ["..."],
  "study_topics": ["..."],
  "practice_questions": ["..."],
  "next_session": {"recommended_difficulty": "string", "rationale": "string", "focus_competencies": ["..."]}
}`;

export const DOC_ANALYZER_SYSTEM_PROMPT = `You are the InterVue AI Document Analyzer. You receive extracted text from a candidate's resume OR a job description. Extract structured facts. Never invent anything not present in the text; if the text is empty or unreadable, return empty fields.

Respond ONLY with JSON:
{
  "summary": "2-3 sentence factual summary",
  "skills": ["skills, technologies, tools, methodologies, certifications actually present"],
  "highlights": ["projects, roles, achievements or requirements worth probing in an interview"],
  "seniority": "best guess of seniority from the document, or unknown"
}`;

export const PRACTICE_SYSTEM_PROMPT = `You are the InterVue AI Practice Planner. Given a finished interview's report summary (weak areas, gaps, competencies, previous domain and role), design a focused follow-up interview that concentrates ~70-80% of its weight on the candidate's weakest competencies and ~20-30% on supporting fundamentals.

Respond ONLY with JSON matching the planner schema:
{
  "role": "string (same role, e.g. '... — targeted practice')",
  "domain": "string",
  "seniority": "string",
  "interview_style": "string",
  "difficulty": "Easy | Medium | Hard",
  "question_count": number,
  "competencies": [{"name": "string", "weight": number}],
  "question_types": ["string"],
  "opening_line": "string (briefly tell the candidate this session focuses on their weaker areas)"
}`;

export const OPENING_FALLBACK = "Hi, I'm InterVue AI. I'll be your interviewer today — let's get started whenever you're ready.";

// ---------------------------------------------------------------------------
// Shared helpers for building compact state payloads sent to the LLM.
// ---------------------------------------------------------------------------

export type TurnContextInput = {
  blueprint: InterviewBlueprint;
  question: string;
  competency: string;
  answer: string;
  recentHistory: { question: string; answer: string; overall: number | null; competency: string }[];
  questionIndex: number;
  questionCount: number;
  difficulty: number;
  probedCompetencies: { name: string; asked: number; avgScore: number | null }[];
  challengeRequested: boolean;
  candidateSummary?: string | null;
  jdSummary?: string | null;
  /** The candidate's self-introduction, when this turn transitions to Q1. */
  selfIntroContext?: string | null;
};

export function buildEvaluatorUserPrompt(ctx: TurnContextInput): string {
  const lines: string[] = [];
  lines.push(`ROLE / DOMAIN: ${ctx.blueprint.role} — ${ctx.blueprint.domain} (${ctx.blueprint.seniority}), style: ${ctx.blueprint.interview_style}`);
  if (ctx.candidateSummary) lines.push(`CANDIDATE RESUME SUMMARY: ${ctx.candidateSummary}`);
  if (ctx.jdSummary) lines.push(`JOB DESCRIPTION SUMMARY: ${ctx.jdSummary}`);
  lines.push(`COMPETENCY MODEL: ${ctx.blueprint.competencies.map((c) => `${c.name} (w=${c.weight})`).join("; ")}`);
  lines.push(`QUESTION TYPES AVAILABLE: ${ctx.blueprint.question_types.join(", ")}`);
  lines.push(`PROGRESS: top-level question ${ctx.questionIndex} of ~${ctx.questionCount}, current difficulty ${ctx.difficulty}/5.`);
  lines.push(`COMPETENCIES PROBED SO FAR: ${ctx.probedCompetencies.map((c) => `${c.name}: asked=${c.asked}, avg=${c.avgScore ?? "n/a"}`).join("; ") || "none yet"}`);
  if (ctx.recentHistory.length) {
    lines.push("RECENT CONVERSATION:");
    for (const h of ctx.recentHistory.slice(-6)) {
      lines.push(`  Q(${h.competency}): ${h.question}`);
      lines.push(`  A: ${h.answer.slice(0, 500)}`);
      lines.push(`  [score: ${h.overall ?? "n/a"}/10]`);
    }
  }
  if (ctx.selfIntroContext) {
    lines.push(
      `CONTEXT: This is the start of the interview proper. The candidate just introduced themselves: "${ctx.selfIntroContext.slice(0, 1500)}". This is warm-up conversation — do NOT score it. Craft the FIRST substantive interview question (question 1 of ~${ctx.questionCount}). Make it a strong opener for the highest-weight competency, informed by what the candidate said about their background${ctx.candidateSummary ? " and their resume" : ""}. Set scores to neutral 5s and treat this as ASK_FOLLOW_UP.`,
    );
  }
  lines.push(`CURRENT QUESTION (${ctx.competency}): ${ctx.question}`);
  lines.push(`CANDIDATE'S LATEST SPOKEN ANSWER: "${ctx.answer.slice(0, 4000)}"`);
  if (ctx.challengeRequested) {
    lines.push(
      `THE CANDIDATE EXPLICITLY ASKED TO BE CHALLENGED. Your next question MUST be a genuinely harder scenario that stress-tests the assumptions in their last answer — raise difficulty_delta to +1.`
    );
  }
  if (/\b(i\s+(don'?t|do not)\s+know|no idea|not sure|unsure)\b/i.test(ctx.answer)) {
    lines.push(
      `NOTE: the candidate expressed uncertainty. Do not fail them or end the interview. Acknowledge briefly, then ask a simpler angled question that helps them reason from first principles (PROBE_WEAKNESS, difficulty_delta=-1).`
    );
  }
  lines.push(INTERVIEWER_STYLE_RULES);
  lines.push("Decide the next action and write the next spoken question now.");
  return lines.join("\n");
}

export type ReportContextInput = {
  blueprint: InterviewBlueprint;
  qa: {
    question: string;
    answer: string;
    competency: string;
    is_follow_up: boolean;
    scores: Record<string, number> | null;
  }[];
  indicators: {
    words_per_minute: number | null;
    filler_word_count: number;
    long_pause_count: number;
    answer_duration_seconds: number | null;
  }[];
  durationMinutes: number | null;
};

export function buildReporterUserPrompt(ctx: ReportContextInput): string {
  const lines: string[] = [];
  lines.push(`INTERVIEW: ${ctx.blueprint.role} — ${ctx.blueprint.domain} (${ctx.blueprint.seniority}), style: ${ctx.blueprint.interview_style}`);
  lines.push(`COMPETENCY MODEL: ${ctx.blueprint.competencies.map((c) => `${c.name} (w=${c.weight})`).join("; ")}`);
  if (ctx.durationMinutes != null) lines.push(`DURATION: ~${ctx.durationMinutes} minutes`);
  lines.push("Q&A RECORD (with per-answer evaluation scores):");
  ctx.qa.forEach((entry, i) => {
    lines.push(`${i + 1}. [${entry.competency}${entry.is_follow_up ? ", follow-up" : ""}] Q: ${entry.question}`);
    lines.push(`   A: ${entry.answer.slice(0, 1200)}`);
    if (entry.scores) {
      lines.push(
        `   scores: relevance=${entry.scores.relevance} correctness=${entry.scores.correctness} completeness=${entry.scores.completeness} depth=${entry.scores.depth} reasoning=${entry.scores.reasoning} communication=${entry.scores.communication} overall=${entry.scores.overall}`
      );
      const ev = entry as unknown as { strengths?: string[]; weaknesses?: string[]; missing_concepts?: string[]; misconceptions?: string[] };
      if (ev.strengths?.length) lines.push(`   strengths: ${ev.strengths.join("; ")}`);
      if (ev.weaknesses?.length) lines.push(`   weaknesses: ${ev.weaknesses.join("; ")}`);
      if (ev.missing_concepts?.length) lines.push(`   missing: ${ev.missing_concepts.join("; ")}`);
      if (ev.misconceptions?.length) lines.push(`   misconceptions: ${ev.misconceptions.join("; ")}`);
    } else {
      lines.push("   scores: none (not evaluated)");
    }
  });
  if (ctx.indicators.length) {
    const wpm = ctx.indicators.map((i) => i.words_per_minute).filter((v): v is number => v != null);
    const fillers = ctx.indicators.reduce((a, i) => a + i.filler_word_count, 0);
    const pauses = ctx.indicators.reduce((a, i) => a + i.long_pause_count, 0);
    if (wpm.length) lines.push(`VOICE INDICATORS: pace samples (wpm) = ${wpm.join(", ")}; filler word instances = ${fillers}; long pauses = ${pauses}`);
  }
  lines.push("Produce the final report JSON now.");
  return lines.join("\n");
}
