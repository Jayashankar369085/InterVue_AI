// ---------------------------------------------------------------------------
// InterVue AI — local JSON file interview store (LOCAL DEVELOPMENT ONLY).
//
// Durable across refreshes/restarts in dev. This adapter MUST NOT run in
// production: AWS Amplify's runtime filesystem is read-only for app data
// (EROFS), which is exactly why DynamoDB exists. The factory refuses to
// construct this adapter whenever NODE_ENV=production.
// ---------------------------------------------------------------------------

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Interview, Report } from "@/types/interview";
import type { InterviewRecordStore } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "interviews.json");

type StoreShape = Record<string, Interview>;

export function createFileInterviewStore(): InterviewRecordStore {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[store] The local JSON file store is disabled in production. " +
        "Set INTERVIEWS_TABLE_NAME to use DynamoDB (AWS Amplify has a read-only filesystem).",
    );
  }

  async function readFileStore(): Promise<StoreShape> {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      return JSON.parse(raw) as StoreShape;
    } catch {
      return {};
    }
  }

  async function writeFileStore(store: StoreShape): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(store), "utf8");
    await fs.rename(tmp, DATA_FILE);
  }

  const store: InterviewRecordStore = {
    async createInterview(input) {
      const now = new Date().toISOString();
      const interview: Interview = { ...input, id: randomUUID(), created_at: now, updated_at: now };
      const all = await readFileStore();
      all[interview.id] = interview;
      await writeFileStore(all);
      return interview;
    },

    async getInterview(id) {
      const all = await readFileStore();
      return all[id] ?? null;
    },

    async updateInterview(id, mutator) {
      // In-process serialization is sufficient here: the file store only ever
      // runs in a single local dev server, and each request's read-modify-write
      // is serialized per interview so concurrent turns cannot double-apply.
      const all = await readFileStore();
      const current = all[id];
      if (!current) return null;
      const next = mutator(structuredClone(current));
      next.updated_at = new Date().toISOString();
      all[next.id] = next;
      await writeFileStore(all);
      return next;
    },

    async listInterviews(limit = 50) {
      const all = await readFileStore();
      return Object.values(all)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, limit);
    },

    async saveReport(id, report) {
      return store.updateInterview(id, (i) => ({ ...i, report, status: "completed" }));
    },
  };

  return store;
}
