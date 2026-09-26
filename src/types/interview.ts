// ---------------------------------------------------------------------------
// InterVue AI — shared domain types
// ---------------------------------------------------------------------------

export type InterviewStatus = "planned" | "active" | "completed" | "aborted";

/**
 * Conversation phase. WARMUP (greeting) and SELF_INTRO are conversational and
 * never count toward the configured question target; only TECHNICAL questions
 * (top-level OR follow-up) are substantive and consume question slots.
 */
export type InterviewPhase = "WARMUP" | "SELF_INTRO" | "TECHNICAL" | "COMPLETED";

export type NextAction =
  | "ASK_FOLLOW_UP"
  | "PROBE_WEAKNESS"
  | "INCREASE_DIFFICULTY"
  | "DECREASE_DIFFICULTY"
  | "CHANGE_COMPETENCY"
  | "END_INTERVIEW";

export type Competency = {
  name: string;
  /** 0..1 relative importance within this interview. */
  weight: number;
  /** Server-assigned running score 0..100 (null until tested). */
  score?: number | null;
  /** How many questions probed this competency. */
  asked?: number;
};

export type InterviewBlueprint = {
  role: string;
  domain: string;
  seniority: string;
  interview_style: string;
  difficulty: "Easy" | "Medium" | "Hard" | string;
  /** Target number of top-level questions (follow-ups do not count). */
  question_count: number;
  competencies: Competency[];
  question_types: string[];
  /** Opening line the interviewer speaks when the session starts. */
  opening_line?: string;
};

export type Evaluation = {
  scores: {
    relevance: number; // 0..10
    correctness: number; // 0..10
    completeness: number; // 0..10
    depth: number; // 0..10
    reasoning: number; // 0..10
    communication: number; // 0..10
    overall: number; // 0..10
  };
  strengths: string[];
  weaknesses: string[];
  missing_concepts: string[];
  misconceptions: string[];
  /** Short note about whether the answer was on-topic for the question asked. */
  relevance_note?: string;
  next_action: NextAction;
  next_question_text: string;
  /** Competency the next question targets. */
  next_competency: string;
  /** Interviewer acknowledgement line, may be empty. */
  acknowledgement?: string;
  /** Difficulty the interviewer should aim for next: -1 easier, 0 same, +1 harder. */
  difficulty_delta: number;
};

export type CommunicationIndicators = {
  words_per_minute: number | null;
  words_per_minute_label: "Low" | "Good" | "Fast" | null;
  filler_word_count: number;
  filler_rate: "Low" | "Moderate" | "High" | null;
  long_pause_count: number;
  answer_duration_seconds: number | null;
  structure: "Weak" | "Ok" | "Strong" | null;
  notes?: string;
};

export type QAEntry = {
  id: string;
  /** The question the AI asked (full spoken text). */
  question: string;
  /** Candidate answer text. */
  answer: string;
  /** Index of the top-level question this belongs to (follow-ups share it). */
  question_index: number;
  is_follow_up: boolean;
  competency: string;
  difficulty: number; // 1..5 at time of asking
  evaluation: Evaluation | null;
  created_at: string;
  /** Duration of the spoken answer in seconds, when known. */
  duration_seconds?: number | null;
};

export type Report = {
  overall_score: number; // 0..100
  headline: string;
  summary: string;
  /** Category scores — categories are chosen dynamically per domain. */
  category_scores: { name: string; score: number }[];
  competency_scores: { name: string; score: number | null; weight: number }[];
  strengths: string[];
  weaknesses: string[];
  knowledge_gaps: string[];
  misconceptions: string[];
  communication: CommunicationIndicators & { summary: string };
  question_review: {
    question: string;
    answer: string;
    competency: string;
    score: number; // 0..100
    verdict: "Strong" | "Ok" | "Needs improvement";
    note: string;
  }[];
  recommendations: string[];
  study_topics: string[];
  practice_questions: string[];
  next_session: {
    recommended_difficulty: string;
    rationale: string;
    focus_competencies: string[];
  };
};

export type CandidateContext = {
  resume_text?: string | null;
  resume_summary?: string | null;
  resume_skills?: string[];
  job_description?: string | null;
  jd_summary?: string | null;
  jd_skills?: string[];
  company?: string | null;
};

export type Interview = {
  id: string;
  created_at: string;
  updated_at: string;
  status: InterviewStatus;
  blueprint: InterviewBlueprint;
  candidate: CandidateContext;
  /** Conversation transcript in order (role ai = question, role user = answer). */
  transcript: { role: "ai" | "user"; text: string; at: string }[];
  qa: QAEntry[];
  /** Current question number (top-level questions asked so far). Mirrors substantive_asked. */
  current_question: number;
  /** Conversation phase — warm-up stages never consume question slots. */
  interview_phase: InterviewPhase;
  /** Authoritative count of substantive questions ASKED (follow-ups included). */
  substantive_asked: number;
  /** Competency of the question currently on the table (null during warm-up). */
  current_competency: string | null;
  /** Whether the question currently on the table is a follow-up. */
  current_is_follow_up: boolean;
  /** Adaptive difficulty 1..5. */
  difficulty: number;
  /** Question types already covered (to avoid repetition). */
  covered_question_types: string[];
  /** Communication indicators accumulated from voice sessions. */
  communication_indicators: CommunicationIndicators[];
  report: Report | null;
  mode: "real" | "demo";
  /** Set when the next turn should be a forced challenge. */
  challenge_requested: boolean;
};

export type PlanRequest = {
  description: string;
  experience?: string;
  style?: string;
  length?: "quick" | "standard" | "deep" | string;
  company?: string;
};

export type TurnRequest = {
  answer?: string;
  challenge?: boolean;
  /** Voice metrics for this answer, optional. */
  duration_seconds?: number | null;
  ended_by?: "voice" | "text";
};

export type TurnResponse = {
  interview: Interview;
  evaluation: Evaluation | null;
  reply: string;
  interview_complete: boolean;
  /** True when the reply came from heuristics instead of the real LLM
   *  (demo mode, model overload, or deadline exhaustion). The UI shows an
   *  honest notice instead of pretending the AI adapted to the answer. */
  degraded?: boolean;
  /** Human-readable reason, when degraded. */
  degraded_reason?: string;
};
