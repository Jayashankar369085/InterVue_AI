// ---------------------------------------------------------------------------
// Safe JSON fetching for the browser. The backend (and the hosting platform)
// can return empty or non-JSON bodies — e.g. Amplify's SSR compute kills
// requests at ~30s with an empty 504 — so response.json() must never be called
// unconditionally. This helper guarantees:
//   • every call resolves to { ok, status, data, error, bodyEmpty }
//   • empty/invalid bodies become structured errors, never thrown parse errors
//   • callers can always render `error` directly
// ---------------------------------------------------------------------------

export type JsonResponse<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  /** Best-effort server error message, or a generic message for empty/garbled bodies. */
  error: string | null;
  /** True when the response body was empty or not valid JSON (e.g. platform 504). */
  bodyEmpty: boolean;
};

const GENERIC = (status: number) => `Request failed (HTTP ${status}). Please try again.`;

export async function fetchJson<T = Record<string, unknown>>(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<JsonResponse<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, status: 0, data: null, error: "Network error — please check your connection and try again.", bodyEmpty: true };
  }

  const raw = await res.text().catch(() => "");
  if (!raw.trim()) {
    return { ok: false, status: res.status, data: null, error: GENERIC(res.status), bodyEmpty: true };
  }
  try {
    const data = JSON.parse(raw) as T;
    const error = !res.ok ? ((data as { error?: string })?.error ?? GENERIC(res.status)) : null;
    return { ok: res.ok, status: res.status, data, error, bodyEmpty: false };
  } catch {
    return { ok: false, status: res.status, data: null, error: GENERIC(res.status), bodyEmpty: true };
  }
}

/**
 * True for failures where the server never produced a body — platform timeouts
 * (502/503/504) or truncated responses — which are usually transient and worth
 * retrying once, unlike a clean 4xx.
 */
export function isTransientFailure(r: { status: number; bodyEmpty: boolean }): boolean {
  return r.bodyEmpty || r.status === 502 || r.status === 503 || r.status === 504;
}
