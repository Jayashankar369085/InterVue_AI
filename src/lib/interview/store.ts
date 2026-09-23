// ---------------------------------------------------------------------------
// InterVue AI — interview persistence facade.
//
// Adapters (src/lib/persistence/):
//   • DynamoDB (production / AWS Amplify) — selected when INTERVIEWS_TABLE_NAME
//     is set. Auth via the Amplify runtime IAM role; no static keys.
//   • Local JSON file (dev only) — refuses to run when NODE_ENV=production,
//     so the EROFS read-only-filesystem failure can never reappear.
//
// The rest of the app imports only from this file. Public API is unchanged
// from the previous store, including the per-interview mutation lock that
// serializes turn processing (question-count race guard).
// ---------------------------------------------------------------------------

import type { Interview, Report } from "@/types/interview";
import type { InterviewRecordStore } from "@/lib/persistence/types";
import { createDynamoInterviewStore } from "@/lib/persistence/dynamo";
import { createFileInterviewStore } from "@/lib/persistence/file";

let cached: InterviewRecordStore | null = null;

function resolveStore(): InterviewRecordStore {
  if (cached) return cached;

  const tableName = process.env.INTERVIEWS_TABLE_NAME;
  const isProduction = process.env.NODE_ENV === "production";

  if (tableName) {
    cached = createDynamoInterviewStore();
    console.log(
      `[store] persistence=DynamoDB table=${tableName} region=${process.env.INTERVIEWS_AWS_REGION || process.env.AWS_REGION || "eu-north-1"}`,
    );
    return cached;
  }

  if (isProduction) {
    // Hard stop: never silently fall back to a read-only filesystem in prod.
    console.error(
      "[store] INTERVIEWS_TABLE_NAME is not set in production — refusing to start " +
        "the file store (Amplify filesystem is read-only). Persistence will fail loudly.",
    );
  }

  cached = createFileInterviewStore();
  if (!isProduction) {
    console.log("[store] persistence=local-json-file (development mode)");
  }
  return cached;
}

// ---------- Public API (unchanged signatures) ----------

export async function createInterview(
  input: Omit<Interview, "id" | "created_at" | "updated_at">,
): Promise<Interview> {
  return resolveStore().createInterview(input);
}

export async function getInterview(id: string): Promise<Interview | null> {
  return resolveStore().getInterview(id);
}

// Per-interview mutation lock: Node processes requests concurrently, and
// read-then-write without serialization would let two simultaneous turns both
// read the same state (e.g. substantive_asked=4) and each think they are the
// 5th question — the exact race the question-limit guard must prevent. This
// serializes mutators within the process; the DynamoDB adapter additionally
// guards cross-process writers with a version conditional.
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run regardless of whether the previous op succeeded
  locks.set(
    key,
    next.catch(() => {}), // keep the chain alive after failures
  );
  return next;
}

export async function updateInterview(
  id: string,
  mutator: (i: Interview) => Interview,
): Promise<Interview | null> {
  return withLock(id, () => resolveStore().updateInterview(id, mutator));
}

export async function listInterviews(limit = 50): Promise<Interview[]> {
  return resolveStore().listInterviews(limit);
}

/** Serialize a report onto the interview. */
export async function saveReport(id: string, report: Report): Promise<Interview | null> {
  return updateInterview(id, (i) => ({ ...i, report, status: "completed" }));
}
