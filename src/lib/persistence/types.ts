// ---------------------------------------------------------------------------
// InterVue AI — persistence contract.
//
// Every interview backend (DynamoDB in production, local JSON file in dev)
// implements this interface. Application code only talks to the store in
// src/lib/interview/store.ts, never to an adapter directly.
// ---------------------------------------------------------------------------

import type { Interview, Report } from "@/types/interview";

/** A store must persist the full Interview object exactly as given. */
export interface InterviewRecordStore {
  createInterview(
    input: Omit<Interview, "id" | "created_at" | "updated_at">,
  ): Promise<Interview>;

  getInterview(id: string): Promise<Interview | null>;

  /**
   * Read-modify-write with concurrency safety. The mutator receives the
   * current persisted state and returns the next state. Implementations
   * must ensure two concurrent calls can never both win (lost update).
   */
  updateInterview(
    id: string,
    mutator: (i: Interview) => Interview,
  ): Promise<Interview | null>;

  listInterviews(limit?: number): Promise<Interview[]>;

  saveReport(id: string, report: Report): Promise<Interview | null>;
}
