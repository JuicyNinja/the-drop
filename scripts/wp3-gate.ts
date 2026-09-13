/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { Redis } from "@upstash/redis";

/**
 * WP-3 acceptance gate. Drives the real HTTP API on a running dev server —
 * no endpoint is stubbed. Prints each check with actual status and body.
 *
 * The dev OAuth provider accepts a code of the form `dev-code:<email>`, so the
 * whole OAuth → register → SMS → location → return-to-intent flow runs end to
 * end without external Google/Twilio. The SMS code is read back from Redis
 * (where the dev sender's flow stored it) to confirm verification.
 */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
  } catch {
    /* ignore */
  }
  return out;
}

const env = loadEnvLocal();
const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

interface ApiResult {
  status: number;
  body: any;
}

async function api(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    token?: string;
    idempotencyKey?: string;
    clientHeaders?: boolean;
  } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.clientHeaders !== false) Object.assign(headers, CLIENT);
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

function subOf(accessToken: string): string {
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64").toString("utf8"),
  );
  return payload.sub as string;
}

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
}

/** Full registration flow for one email. Returns tokens and the users row facts. */
async function register(
  email: string,
  handle: string,
  returnTo: string,
): Promise<{ token: string; refresh: string; uid: string; returnToEcho: string }> {
  const start = await api("/v1/auth/oauth/start", {
    method: "POST",
    body: { provider: "google", return_to: returnTo },
  });
  if (start.status !== 200) throw new Error(`start failed: ${JSON.stringify(start.body)}`);

  const cb = await api("/v1/auth/oauth/callback", {
    method: "POST",
    body: { code: `dev-code:${email}`, state: start.body.data.state },
  });
  if (cb.status !== 200) throw new Error(`callback failed: ${JSON.stringify(cb.body)}`);
  const token = cb.body.data.session.access_token as string;
  const refresh = cb.body.data.session.refresh_token as string;
  const returnToEcho = cb.body.data.return_to as string;

  const reg = await api("/v1/auth/register/complete", {
    method: "POST",
    token,
    body: {
      full_name: "Gate User",
      handle,
      phone: `+1801555${Math.floor(1000 + Math.random() * 8999)}`,
      address: {
        label: "Home",
        line1: "1 S Main St",
        city: "Salt Lake City",
        region: "UT",
        postal_code: "84101",
        country: "US",
      },
    },
  });
  if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);

  const uid = subOf(token);
  return { token, refresh, uid, returnToEcho };
}

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();

  // --- Seed a live drop to serve as the shared link target. ---
  const org = (
    await pg.query(
      `insert into organizations (name, lane, tier, max_locations, drops_per_cycle, cycle_anchor_at)
       values ('Gate Merchant', 'local', 'local_starter', 1, 2, now()) returning id`,
    )
  ).rows[0].id as string;
  const city = (await pg.query(`select id from cities where name = 'Salt Lake City'`)).rows[0].id as string;
  const loc = (
    await pg.query(
      `insert into locations (org_id, name, line1, city, region, postal_code, lat, lng, city_id)
       values ($1, 'Gate Shop', '1 Main', 'Salt Lake City', 'UT', '84101', 40.7608, -111.8910, $2) returning id`,
      [org, city],
    )
  ).rows[0].id as string;
  const founder = (await pg.query(`select id from users where user_number = 1`)).rows[0].id as string;
  const drop = (
    await pg.query(
      `insert into drops (lane, org_id, location_id, city_id, title, description, quantity_total, quantity_remaining, redeem_from, redeem_until, created_by)
       values ('local', $1, $2, $3, 'Gate Drop', 'x', 10, 10, now(), now() + interval '1 day', $4) returning id`,
      [org, loc, city, founder],
    )
  ).rows[0].id as string;
  await pg.query(`update drops set status = 'scheduled' where id = $1`, [drop]);
  await pg.query(`update drops set status = 'live' where id = $1`, [drop]);

  const stamp = Date.now();
  const emailA = `gate_${stamp}_a@example.test`;
  const emailB = `gate_${stamp}_b@example.test`;
  const handleA = `gatea${stamp % 100000}`;
  const handleB = `gateb${stamp % 100000}`;
  const dropPath = `/drops/${drop}`;

  // ========================================================================
  // GATE 1 — shared-link round trip: land on drop, register, SMS + location,
  // return to that exact drop, unlocked and catch-ready.
  // ========================================================================
  const a = await register(emailA, handleA, dropPath);
  check(
    "1. return_to preserved through OAuth round trip",
    a.returnToEcho === dropPath,
    `callback echoed return_to=${a.returnToEcho} (expected ${dropPath})`,
  );

  // SMS: read the code the dev flow stored in Redis, then confirm.
  const rec = await redis.get<{ code: string }>(`phoneverify:${a.uid}`);
  const smsCode = rec?.code ?? "";
  const confirm = await api("/v1/auth/phone/verify/confirm", {
    method: "POST",
    token: a.token,
    body: { code: smsCode },
  });
  check(
    "1. SMS verify send→confirm sets phone_verified",
    confirm.status === 200 && confirm.body.data?.phone_verified === true,
    `code ${smsCode} from Redis → ${confirm.status} ${JSON.stringify(confirm.body.data ?? confirm.body)}`,
  );

  // Before location: catch is gated (this is also GATE 2).
  const catchBefore = await api("/v1/catches", {
    method: "POST",
    token: a.token,
    idempotencyKey: `gate-${stamp}-1`,
    body: { drop_id: drop },
  });
  check(
    "2. POST /catches returns LOCATION_PERMISSION_REQUIRED when perm is null",
    catchBefore.status === 403 && catchBefore.body.error?.code === "LOCATION_PERMISSION_REQUIRED",
    `${catchBefore.status} ${JSON.stringify(catchBefore.body.error ?? catchBefore.body)}`,
  );

  // Grant location.
  const grant = await api("/v1/users/me/location-permission", {
    method: "POST",
    token: a.token,
    body: { granted: true },
  });

  // Now the same drop is catch-ready: pre-flight passes to the WP-7 boundary.
  const catchAfter = await api("/v1/catches", {
    method: "POST",
    token: a.token,
    idempotencyKey: `gate-${stamp}-2`,
    body: { drop_id: drop },
  });
  check(
    "1. after SMS + location, the drop is unlocked (catch clears every gate to the WP-7 boundary)",
    grant.status === 200 &&
      catchAfter.status === 501 &&
      catchAfter.body.error?.code === "NOT_IMPLEMENTED",
    `grant ${grant.status}; catch ${catchAfter.status} ${JSON.stringify(catchAfter.body.error ?? catchAfter.body)}`,
  );

  // ========================================================================
  // GATE 3 — handle change once, second attempt HANDLE_LOCKED.
  // ========================================================================
  const rename1 = await api("/v1/users/me", {
    method: "PATCH",
    token: a.token,
    body: { handle: `${handleA}x` },
  });
  const rename2 = await api("/v1/users/me", {
    method: "PATCH",
    token: a.token,
    body: { handle: `${handleA}y` },
  });
  check(
    "3. first handle change succeeds",
    rename1.status === 200 && rename1.body.data?.handle === `${handleA}x` && rename1.body.data?.handle_locked === true,
    `${rename1.status} handle=${rename1.body.data?.handle} locked=${rename1.body.data?.handle_locked}`,
  );
  check(
    "3. second handle change returns HANDLE_LOCKED",
    rename2.status === 409 && rename2.body.error?.code === "HANDLE_LOCKED",
    `${rename2.status} ${JSON.stringify(rename2.body.error ?? rename2.body)}`,
  );

  // ========================================================================
  // GATE 4 — user_number sequential, bigint, zero-padded to 14 on display only.
  // ========================================================================
  const b = await register(emailB, handleB, "/");
  const meA = await api("/v1/users/me", { token: a.token });
  const meB = await api("/v1/users/me", { token: b.token });
  const nA = Number(meA.body.data.user_number);
  const nB = Number(meB.body.data.user_number);
  check(
    "4. user_number is sequential (B = A + 1) and above the founder's 1",
    nB === nA + 1 && nA > 1,
    `A=${meA.body.data.user_number} B=${meB.body.data.user_number}`,
  );
  check(
    "4. user_number stored raw (bare digits), zero-padded to 14 only for display",
    /^[0-9]+$/.test(meA.body.data.user_number) &&
      meA.body.data.user_number_display === String(nA).padStart(14, "0") &&
      meA.body.data.user_number_display.length === 14,
    `raw=${meA.body.data.user_number} display=${meA.body.data.user_number_display}`,
  );
  // Confirm the column is bigint in the schema.
  const coltype = (
    await pg.query(
      `select data_type from information_schema.columns where table_name='users' and column_name='user_number'`,
    )
  ).rows[0].data_type as string;
  check("4. users.user_number column is bigint", coltype === "bigint", `data_type=${coltype}`);

  // ========================================================================
  // Extra invariants exercised by WP-3 scope.
  // ========================================================================
  // Reserved handle rejected as HANDLE_TAKEN (never "reserved").
  const resStart = await api("/v1/auth/oauth/start", {
    method: "POST",
    body: { provider: "google", return_to: "/" },
  });
  const resCb = await api("/v1/auth/oauth/callback", {
    method: "POST",
    body: { code: `dev-code:reserved_${stamp}@example.test`, state: resStart.body.data.state },
  });
  const reserved = await api("/v1/auth/register/complete", {
    method: "POST",
    token: resCb.body.data.session.access_token,
    body: {
      full_name: "R",
      handle: "admin",
      phone: `+1801556${stamp % 10000}`,
      address: { label: "Home", line1: "1", city: "SLC", region: "UT", postal_code: "84101" },
    },
  });
  check(
    "reserved handle 'admin' returns HANDLE_TAKEN (no hint it is reserved)",
    reserved.status === 409 &&
      reserved.body.error?.code === "HANDLE_TAKEN" &&
      !/reserv/i.test(JSON.stringify(reserved.body)),
    `${reserved.status} ${JSON.stringify(reserved.body.error ?? reserved.body)}`,
  );

  // Confusable collapse: 'tad' is the founder; 't_a_d' normalizes to it.
  const confStart = await api("/v1/auth/oauth/start", {
    method: "POST",
    body: { provider: "google", return_to: "/" },
  });
  const confCb = await api("/v1/auth/oauth/callback", {
    method: "POST",
    body: { code: `dev-code:conf_${stamp}@example.test`, state: confStart.body.data.state },
  });
  const confusable = await api("/v1/auth/register/complete", {
    method: "POST",
    token: confCb.body.data.session.access_token,
    body: {
      full_name: "C",
      handle: "t_a_d",
      phone: `+1801557${stamp % 10000}`,
      address: { label: "Home", line1: "1", city: "SLC", region: "UT", postal_code: "84101" },
    },
  });
  check(
    "confusable handle 't_a_d' collapses to founder 'tad' → HANDLE_TAKEN",
    confusable.status === 409 && confusable.body.error?.code === "HANDLE_TAKEN",
    `${confusable.status} ${JSON.stringify(confusable.body.error ?? confusable.body)}`,
  );

  // Unauthenticated user route is UNAUTHENTICATED.
  const noauth = await api("/v1/users/me");
  check(
    "GET /v1/users/me without a token is 401 UNAUTHENTICATED",
    noauth.status === 401 && noauth.body.error?.code === "UNAUTHENTICATED",
    `${noauth.status} ${JSON.stringify(noauth.body.error ?? noauth.body)}`,
  );

  // Refresh rotates the token.
  const refreshed = await api("/v1/auth/refresh", {
    method: "POST",
    body: { refresh_token: a.refresh },
  });
  check(
    "refresh returns a new, rotated session",
    refreshed.status === 200 &&
      typeof refreshed.body.data?.session?.access_token === "string" &&
      refreshed.body.data.session.refresh_token !== a.refresh,
    `${refreshed.status} rotated=${refreshed.body.data?.session?.refresh_token !== a.refresh}`,
  );

  // Invalid refresh token is rejected.
  const badRefresh = await api("/v1/auth/refresh", {
    method: "POST",
    body: { refresh_token: "not-a-real-token" },
  });
  check(
    "invalid refresh token is 401 UNAUTHENTICATED",
    badRefresh.status === 401 && badRefresh.body.error?.code === "UNAUTHENTICATED",
    `${badRefresh.status} ${JSON.stringify(badRefresh.body.error ?? badRefresh.body)}`,
  );

  // Open-redirect defense: external return_to collapses to "/".
  const evilStart = await api("/v1/auth/oauth/start", {
    method: "POST",
    body: { provider: "google", return_to: "https://evil.example/steal" },
  });
  const evilCb = await api("/v1/auth/oauth/callback", {
    method: "POST",
    body: { code: `dev-code:evil_${stamp}@example.test`, state: evilStart.body.data.state },
  });
  check(
    "external return_to is rejected and collapses to /",
    evilCb.body.data?.return_to === "/",
    `return_to=${evilCb.body.data?.return_to}`,
  );

  // CSP header present and strict.
  const health = await fetch(`${BASE}/v1/health`);
  const csp = health.headers.get("content-security-policy") ?? "";
  check(
    "strict CSP header present, no unsafe-inline / unsafe-eval",
    csp.length > 0 && !csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"),
    csp || "(missing)",
  );

  // Walkthrough completes once (server-side).
  const wt = await api("/v1/users/me/walkthrough/complete", { method: "POST", token: a.token });
  const meAfterWt = await api("/v1/users/me", { token: a.token });
  check(
    "walkthrough completion is recorded server-side",
    wt.status === 200 && meAfterWt.body.data.walkthrough_completed === true,
    `${wt.status} walkthrough_completed=${meAfterWt.body.data.walkthrough_completed}`,
  );

  await pg.end();

  // ---- report ----
  console.log("\nWP-3 acceptance gate against " + BASE + "\n");
  for (const r of results) {
    console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`);
    console.log(`         ${r.detail}`);
  }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
