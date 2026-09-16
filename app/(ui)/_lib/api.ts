"use client";

/*
 * The UI's single door to the product: every capability is reached through /v1
 * over HTTP, exactly like a native client (CLAUDE.md invariant #15). No Supabase
 * client, no server action. The session (access + refresh token) lives in
 * localStorage for this web client; the token is attached as a bearer and
 * refreshed on 401.
 */

const CLIENT_HEADERS = { "x-client": "web", "x-client-version": "1.0.0" };
const SESSION_KEY = "thedrop.session";

export interface Session {
  access_token: string;
  refresh_token: string;
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function setSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
export function clearSession(): void {
  setSession(null);
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  meta: Record<string, unknown> | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
}

async function raw<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null; idem?: string } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT_HEADERS };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: { data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string; details?: Record<string, unknown> } } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    /* empty body */
  }
  return { ok: res.ok, status: res.status, data: json.data ?? null, meta: json.meta ?? null, error: json.error ?? null };
}

async function refresh(): Promise<string | null> {
  const s = getSession();
  if (!s) return null;
  const r = await raw<{ session: Session }>("/v1/auth/refresh", { method: "POST", body: { refresh_token: s.refresh_token } });
  if (r.ok && r.data?.session) {
    setSession(r.data.session);
    return r.data.session.access_token;
  }
  clearSession();
  return null;
}

/** Authenticated call. Refreshes once on 401. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; idem?: string } = {}): Promise<ApiResult<T>> {
  const s = getSession();
  let token = s?.access_token ?? null;
  let r = await raw<T>(path, { ...opts, token });
  if (r.status === 401 && s) {
    token = await refresh();
    if (token) r = await raw<T>(path, { ...opts, token });
  }
  return r;
}

/** Unauthenticated call (public surfaces). */
export function publicApi<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  return raw<T>(path, opts);
}

/**
 * Dev sign-in: runs the dev OAuth flow (dev-code:<email>), completes
 * registration if the account is new, and stores the session. Production swaps
 * this for the real OAuth redirect; the stored-session shape is identical.
 */
export async function devSignIn(email: string): Promise<{ ok: boolean; registered: boolean; message?: string }> {
  const start = await raw<{ state: string }>("/v1/auth/oauth/start", { method: "POST", body: { provider: "google", return_to: "/" } });
  if (!start.ok || !start.data) return { ok: false, registered: false, message: start.error?.message ?? "sign-in failed" };
  const cb = await raw<{ session: Session; registration_complete?: boolean }>("/v1/auth/oauth/callback", { method: "POST", body: { code: `dev-code:${email}`, state: start.data.state } });
  if (!cb.ok || !cb.data) return { ok: false, registered: false, message: cb.error?.message ?? "callback failed" };
  setSession(cb.data.session);
  const registered = cb.data.registration_complete !== false;
  return { ok: true, registered };
}
