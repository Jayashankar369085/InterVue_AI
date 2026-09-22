// ---------------------------------------------------------------------------
// InterVue AI — interview persistence.
// Uses Supabase (service role) when configured; otherwise a durable local JSON
// file under .data/ so interviews survive refreshes and server restarts in dev.
// ---------------------------------------------------------------------------

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Interview, Report } from "@/types/interview";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "interviews.json");

type StoreShape = Record<string, Interview>;

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Lazy require so the dependency stays optional.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require("@supabase/supabase-js");
    return createClient(url, key, { auth: { persistSession: false } });
  } catch {
    return null;
  }
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

// ---------- Public API ----------

export async function createInterview(input: Omit<Interview, "id" | "created_at" | "updated_at">): Promise<Interview> {
  const now = new Date().toISOString();
  const interview: Interview = { ...input, id: randomUUID(), created_at: now, updated_at: now };
  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.from("interviews").insert({ id: interview.id, data: interview });
    if (!error) return interview;
    console.error("[store] supabase insert failed, falling back to file store:", error.message);
  }
  const store = await readFileStore();
  store[interview.id] = interview;
  await writeFileStore(store);
  return interview;
}

export async function getInterview(id: string): Promise<Interview | null> {
  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase.from("interviews").select("data").eq("id", id).maybeSingle();
    if (!error && data?.data) return data.data as Interview;
    if (error) console.error("[store] supabase read failed:", error.message);
  }
  const store = await readFileStore();
  return store[id] ?? null;
}

// Per-interview mutation lock: Node processes requests concurrently, and
// read-then-write without serialization would let two simultaneous turns both
// read the same state (e.g. substantive_asked=4) and each think they are the
// 5th question — the exact race the question-limit guard must prevent.
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run regardless of whether the previous op succeeded
  locks.set(
    key,
    next.catch(() => {}) // keep the chain alive after failures
  );
  return next;
}

export async function updateInterview(id: string, mutator: (i: Interview) => Interview): Promise<Interview | null> {
  return withLock(id, async () => {
    return updateInterviewInner(id, mutator);
  });
}

async function updateInterviewInner(id: string, mutator: (i: Interview) => Interview): Promise<Interview | null> {
  const current = await getInterview(id);
  if (!current) return null;
  const next = mutator(structuredClone(current));
  next.updated_at = new Date().toISOString();
  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.from("interviews").update({ data: next }).eq("id", next.id);
    if (!error) return next;
    console.error("[store] supabase update failed, falling back to file store:", error.message);
  }
  const store = await readFileStore();
  store[next.id] = next;
  await writeFileStore(store);
  return next;
}

export async function listInterviews(limit = 50): Promise<Interview[]> {
  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase.from("interviews").select("data").order("created_at", { ascending: false }).limit(limit);
    if (!error && data) return data.map((r: { data: Interview }) => r.data as Interview);
    if (error) console.error("[store] supabase list failed:", error.message);
  }
  const store = await readFileStore();
  const all = Object.values(store).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return all.slice(0, limit);
}

/** Serialize a report onto the interview. */
export async function saveReport(id: string, report: Report): Promise<Interview | null> {
  return updateInterview(id, (i) => ({ ...i, report, status: "completed" }));
}
