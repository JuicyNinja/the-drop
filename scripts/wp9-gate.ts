/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { randomUUID } from "node:crypto";
import { readFileSync as rfs } from "node:fs";
import { Client } from "pg";
import { Redis } from "@upstash/redis";

/**
 * WP-9 transfers gate. Drives the real HTTP API on a running dev server plus
 * local Postgres and Redis. No endpoint is stubbed and no result is asserted
 * without the actual value printed.
 *
 * Two things are constructed directly in the DB, and both are legitimate test
 * SETUP, never a faked assertion:
 *   - "5 minutes elapse with the client offline" is compressed by moving a
 *     pending transfer's accept_by into the past. The RESOLUTION is then done by
 *     the real server sweeper with NO client call in between — which is exactly
 *     the property under test (server-authoritative, not a client timer).
 *   - "the redemption window closes while a transfer is pending" is a state the
 *     30-minute send cutoff normally prevents, so it is built directly (catch
 *     expires_at moved into the past) to exercise the void safety net.
 */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

function loadEnvLocal(): Record<string, string> {
  // Same precedence Next.js uses in dev: .env.development.local (the local
  // stack — SRH at :8079) outranks .env.local (cloud). The gate's Redis client
  // must talk to the SAME Redis the dev server does, or SMS/inventory reads miss.
  const out: Record<string, string> = {};
  for (const file of [".env.local", ".env.development.local"]) {
    try {
      for (const line of rfs(file, "utf8").split("\n")) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m) out[m[1]] = m[2].trim();
      }
    } catch { /* ignore */ }
  }
  return out;
}
const env = loadEnvLocal();
const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

async function api(path: string, opts: { method?: string; body?: unknown; token?: string; idem?: string } = {}): Promise<{ status: number; body: any; raw: string }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  const res = await fetch(`${BASE}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const raw = await res.text();
  let body: any = raw; try { body = JSON.parse(raw); } catch { /* keep */ }
  return { status: res.status, body, raw };
}
const subOf = (t: string) => JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8")).sub as string;
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function session(email: string): Promise<string> {
  const s = await api("/v1/auth/oauth/start", { method: "POST", body: { provider: "google", return_to: "/" } });
  const c = await api("/v1/auth/oauth/callback", { method: "POST", body: { code: `dev-code:${email}`, state: s.body.data.state } });
  return c.body.data.session.access_token;
}
async function register(email: string, handle: string): Promise<{ token: string; uid: string }> {
  const token = await session(email);
  await api("/v1/auth/register/complete", { method: "POST", token, body: { full_name: `Name ${handle}`, handle, phone: `+1801${Math.floor(1000000 + Math.random() * 8999999)}`, address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" } } });
  await api("/v1/users/me/location-permission", { method: "POST", token, body: { granted: true } });
  return { token, uid: subOf(token) };
}

function smsBodies(list: any[]): string[] {
  return (list ?? []).map((e) => {
    const o = typeof e === "string" ? (() => { try { return JSON.parse(e); } catch { return { body: e }; } })() : e;
    return (o?.body as string) ?? "";
  });
}

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const stamp = Date.now();
  const phoneById = async (uid: string): Promise<string> => (await pg.query(`select phone from users where id=$1`, [uid])).rows[0].phone as string;
  const catchRow = async (id: string) => (await pg.query(`select user_id, status, position_number, transfer_count, expires_at from catches where id=$1`, [id])).rows[0];
  const transferRow = async (id: string) => (await pg.query(`select status, resolved_at from transfers where id=$1`, [id])).rows[0];
  const cloutCount = async (uid: string) => Number((await pg.query(`select count(*)::int n from clout_events where user_id=$1`, [uid])).rows[0].n);

  const admin = await session("info@juicyninja.com");
  const S = await register(`w9s_${stamp}@t.test`, `w9s${stamp % 100000}`); // sender
  const R = await register(`w9r_${stamp}@t.test`, `w9r${stamp % 100000}`); // recipient
  const T = await register(`w9t_${stamp}@t.test`, `w9t${stamp % 100000}`); // third
  const sPhone = await phoneById(S.uid);
  const rPhone = await phoneById(R.uid);

  const owner = await register(`w9own_${stamp}@t.test`, `w9o${stamp % 100000}`);
  const org = (await api("/v1/orgs", { method: "POST", token: owner.token, body: { name: "W9 Co", tier: "local_superstar" } })).body.data.id;
  const loc = (await api(`/v1/orgs/${org}/locations`, { method: "POST", token: owner.token, body: { name: "Shop", line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101", geofence_radius_m: 150 } })).body.data.id;
  await pg.query(`update locations set lat=40.7608, lng=-111.891 where id=$1`, [loc]);

  // A live drop with a controllable redemption window (redeem_until = catch expires_at).
  async function liveDrop(qty: number, redeemUntilMs = 864e5): Promise<string> {
    const d = (await api("/v1/drops", { method: "POST", token: owner.token, body: { location_id: loc, title: "Sendable", description: "d", quantity_total: qty, live_at: iso(-2000), live_until: iso(864e5), redeem_from: iso(-1000), redeem_until: iso(redeemUntilMs), publish: true } })).body.data;
    return d.id;
  }
  // A fresh idempotency key per call: every catch here is an independent
  // request (idempotent replay is WP-7's concern, not WP-9's). Reusing a key
  // would make a second catch a silent replay of the first.
  const catchAs = async (token: string, dropId: string): Promise<{ catchId: string; code: string; status: number; body: any }> => {
    const r = await api("/v1/catches", { method: "POST", token, idem: randomUUID(), body: { drop_id: dropId } });
    return { catchId: r.body.data?.catch_id, code: r.body.data?.code, status: r.status, body: r.body };
  };

  // Provision all drops, then one go-live tick generates their codes + seeds Redis.
  const dHop = await liveDrop(3);
  const dCut = await liveDrop(3, 20 * 60 * 1000); // window closes in 20 min → inside the cutoff
  const dExp = await liveDrop(3);
  const dVoid = await liveDrop(3);
  const dPos = await liveDrop(3);
  const dDec = await liveDrop(3);
  const dAlready = await liveDrop(3);
  const dMxA = await liveDrop(3);
  const dMxB = await liveDrop(3);
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });

  // ========================================================================
  // GATE — Second hop returns TRANSFER_LIMIT_REACHED.
  // ========================================================================
  {
    const c = await catchAs(S.token, dHop);
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    const acc = await api(`/v1/transfers/${send.body.data?.transfer_id}/accept`, { method: "POST", token: R.token });
    // R now holds it with transfer_count = 1. R sends to T → second hop refused.
    const hop2 = await api("/v1/transfers", { method: "POST", token: R.token, body: { catch_id: c.catchId, to_handle: `w9t${stamp % 100000}` } });
    check("Second hop returns TRANSFER_LIMIT_REACHED", hop2.status === 409 && hop2.body.error?.code === "TRANSFER_LIMIT_REACHED", `send1=${send.status}; accept=${acc.status}; hop2=${hop2.status} ${hop2.body.error?.code}`);
  }

  // ========================================================================
  // GATE — Send inside 30 min of window close returns TRANSFER_CUTOFF_PASSED.
  // ========================================================================
  {
    const c = await catchAs(S.token, dCut);
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    check("Send inside 30 min of redemption-window close → TRANSFER_CUTOFF_PASSED", send.status === 409 && send.body.error?.code === "TRANSFER_CUTOFF_PASSED", `${send.status} ${send.body.error?.code}`);
  }

  // ========================================================================
  // GATE — Unaccepted transfer returns to sender at 5:00, client offline.
  // The server sweeper does it; no client call happens between send and sweep.
  // ========================================================================
  {
    const c = await catchAs(S.token, dExp);
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    const tid = send.body.data?.transfer_id;
    // Client goes fully offline. Compress the 5-minute wait: accept_by → past.
    await pg.query(`update transfers set accept_by = now() - interval '1 second' where id=$1`, [tid]);
    // The SERVER sweeper (the ticker's job) resolves it — no client involved.
    const sweep = await api("/v1/admin/transfers/sweep", { method: "POST", token: admin });
    const t = await transferRow(tid);
    const cr = await catchRow(c.catchId);
    check("Unaccepted transfer expires at 5:00 via the SERVER sweeper (client offline) and returns to sender", t.status === "expired" && (sweep.body.data?.expired ?? []).includes(tid) && cr.status === "held" && cr.user_id === S.uid, `transfer=${t.status}; in-sweep=${(sweep.body.data?.expired ?? []).includes(tid)}; catch status=${cr.status} holder=${cr.user_id === S.uid ? "sender" : cr.user_id}`);
  }

  // ========================================================================
  // GATE — Window closing mid-transfer voids it; catch expires; no orphan.
  // ========================================================================
  {
    const c = await catchAs(S.token, dVoid);
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    const tid = send.body.data?.transfer_id;
    // The redemption window closes while pending (a state the 30-min cutoff
    // normally prevents; built directly to exercise the void safety net).
    await pg.query(`update catches set expires_at = now() - interval '1 second' where id=$1`, [c.catchId]);
    const sweep = await api("/v1/admin/transfers/sweep", { method: "POST", token: admin });
    const t = await transferRow(tid);
    const cr = await catchRow(c.catchId);
    const orphan = cr.status === "held" || cr.status === "transfer_pending"; // a live catch past its window would be an orphan
    check("Window closing mid-transfer VOIDS the transfer and the catch expires (no orphan)", t.status === "voided" && (sweep.body.data?.voided ?? []).includes(tid) && cr.status === "expired" && !orphan, `transfer=${t.status}; in-sweep=${(sweep.body.data?.voided ?? []).includes(tid)}; catch=${cr.status}`);
  }

  // ========================================================================
  // GATE — Position number travels; clout does not.
  // ========================================================================
  {
    const c = await catchAs(S.token, dPos);
    const posBefore = (await catchRow(c.catchId)).position_number;
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    const rCloutBeforeAccept = await cloutCount(R.uid);
    const sCloutBeforeAccept = await cloutCount(S.uid);
    await api(`/v1/transfers/${send.body.data?.transfer_id}/accept`, { method: "POST", token: R.token });
    const cr = await catchRow(c.catchId);
    const rCloutAfterAccept = await cloutCount(R.uid);
    const sCloutAfterAccept = await cloutCount(S.uid);
    // Accept moved no clout to anyone. Now the NEW holder redeems and earns it.
    const redeem = await api("/v1/redemptions", { method: "POST", token: R.token, idem: randomUUID(), body: { catch_id: c.catchId, code: c.code, gps_status: "no_fix_timeout" } });
    const rCloutAfterRedeem = await cloutCount(R.uid);
    const positionTravels = cr.position_number === posBefore && cr.user_id === R.uid;
    const cloutDoesNotTravel = rCloutAfterAccept === rCloutBeforeAccept && sCloutAfterAccept === sCloutBeforeAccept && rCloutAfterRedeem === rCloutAfterAccept + 1;
    check("Position number travels (unchanged, now held by recipient); clout does NOT (only redemption pays, to whoever redeems)", positionTravels && cloutDoesNotTravel && redeem.status === 201, `pos ${posBefore}→${cr.position_number} holder=${cr.user_id === R.uid ? "recipient" : "?"}; clout R ${rCloutBeforeAccept}→(accept)${rCloutAfterAccept}→(redeem)${rCloutAfterRedeem}, S ${sCloutBeforeAccept}→${sCloutAfterAccept}`);
  }

  // ========================================================================
  // GATE — Decline returns to the original holder, never to inventory.
  // ========================================================================
  {
    const c = await catchAs(S.token, dDec);
    const invAfterCatch = await redis.get<number>(`drop:${dDec}:inventory`);
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    const dec = await api(`/v1/transfers/${send.body.data?.transfer_id}/decline`, { method: "POST", token: R.token });
    const cr = await catchRow(c.catchId);
    const invAfterDecline = await redis.get<number>(`drop:${dDec}:inventory`);
    check("Decline returns to the ORIGINAL holder (held, sender), never to inventory (counter unchanged)", dec.status === 200 && cr.status === "held" && cr.user_id === S.uid && cr.transfer_count === 0 && invAfterCatch === invAfterDecline, `decline=${dec.status}; catch=${cr.status} holder=${cr.user_id === S.uid ? "sender" : "?"} hops=${cr.transfer_count}; inventory ${invAfterCatch}→${invAfterDecline}`);
  }

  // ========================================================================
  // GATE (carried forward from WP-7) — catch → transfer → catch again returns
  // ALREADY_CAUGHT THROUGH THE ENDPOINT (keyed on the original catcher).
  // ========================================================================
  {
    const c = await catchAs(S.token, dAlready);
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    await api(`/v1/transfers/${send.body.data?.transfer_id}/accept`, { method: "POST", token: R.token });
    const again = await catchAs(S.token, dAlready); // original catcher tries again
    check("catch → transfer → catch again → ALREADY_CAUGHT through POST /v1/catches (keyed on original catcher)", again.status === 409 && again.body.error?.code === "ALREADY_CAUGHT", `${again.status} ${again.body.error?.code}`);
  }

  // ========================================================================
  // REQUIREMENT 2 — transfer and redemption are mutually exclusive, both ways.
  // ========================================================================
  {
    // (a) Cannot redeem while a transfer is pending.
    const c = await catchAs(S.token, dMxA);
    await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    const redeemWhilePending = await api("/v1/redemptions", { method: "POST", token: S.token, idem: randomUUID(), body: { catch_id: c.catchId, code: c.code, gps_status: "no_fix_timeout" } });
    check("2a. Cannot redeem while a transfer is pending (catch not held)", redeemWhilePending.status === 422 && redeemWhilePending.body.error?.code === "INVALID_CODE", `${redeemWhilePending.status} ${redeemWhilePending.body.error?.code}`);

    // (b) Cannot transfer once redemption is done.
    const c2 = await catchAs(S.token, dMxB);
    const redeem = await api("/v1/redemptions", { method: "POST", token: S.token, idem: randomUUID(), body: { catch_id: c2.catchId, code: c2.code, gps_status: "no_fix_timeout" } });
    const transferAfterRedeem = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c2.catchId, to_handle: `w9r${stamp % 100000}` } });
    check("2b. Cannot transfer once redeemed (catch not held → VALIDATION_ERROR)", redeem.status === 201 && transferAfterRedeem.status === 422 && transferAfterRedeem.body.error?.code === "VALIDATION_ERROR", `redeem=${redeem.status}; transfer=${transferAfterRedeem.status} ${transferAfterRedeem.body.error?.code}`);
  }

  // ========================================================================
  // REQUIREMENT 3 — the sweeper is safe under concurrent execution.
  // Two sweeps against one expired-pending transfer resolve it exactly once.
  // ========================================================================
  {
    const dConc = await liveDrop(3);
    await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
    const c = await catchAs(S.token, dConc);
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    const tid = send.body.data?.transfer_id;
    await pg.query(`update transfers set accept_by = now() - interval '1 second' where id=$1`, [tid]);
    const [s1, s2] = await Promise.all([
      api("/v1/admin/transfers/sweep", { method: "POST", token: admin }),
      api("/v1/admin/transfers/sweep", { method: "POST", token: admin }),
    ]);
    const winners = [s1, s2].filter((s) => (s.body.data?.expired ?? []).includes(tid)).length;
    const rows = Number((await pg.query(`select count(*)::int n from transfers where id=$1 and status='expired'`, [tid])).rows[0].n);
    const cr = await catchRow(c.catchId);
    check("3. Two concurrent sweepers resolve a transfer EXACTLY once (no double-resolve)", winners === 1 && rows === 1 && cr.status === "held" && cr.user_id === S.uid, `sweep winners=${winners}/2; expired rows=${rows}; catch=${cr.status} holder=${cr.user_id === S.uid ? "sender" : "?"}`);
  }

  // ========================================================================
  // REQUIREMENT 1 — handle autocomplete is an enumeration surface: rate-limited,
  // handle + display name only, minimum length.
  // ========================================================================
  {
    const q = `w9r${stamp % 100000}`.slice(0, 4);
    const res = await api(`/v1/users/me/handle-search?q=${encodeURIComponent(q)}`, { token: S.token });
    const rows = (res.body.data ?? []) as any[];
    const shapeOk = rows.length > 0 && rows.every((r) => Object.keys(r).sort().join(",") === "display_name,handle");
    check("1. Autocomplete returns handle + display name ONLY (no user number, city, phone, email)", res.status === 200 && shapeOk, `${res.status}; sample keys=${rows[0] ? Object.keys(rows[0]).sort().join(",") : "none"}; n=${rows.length}`);

    const tooShort = await api(`/v1/users/me/handle-search?q=a`, { token: S.token });
    check("1. Autocomplete enforces a minimum query length (1 char → VALIDATION_ERROR)", tooShort.status === 422 && tooShort.body.error?.code === "VALIDATION_ERROR", `${tooShort.status} ${tooShort.body.error?.code}`);

    // Hammer past the per-user limit (30/min) → RATE_LIMITED. A fresh call cannot
    // reset it (server-side counter); proves it cannot be swept at volume.
    let limited = 0; let lastOk = 0;
    for (let i = 0; i < 40; i++) {
      const r = await api(`/v1/users/me/handle-search?q=zz`, { token: T.token });
      if (r.status === 429) limited++; else if (r.status === 200) lastOk++;
    }
    check("1. Autocomplete is hard rate-limited per user (bulk enumeration → RATE_LIMITED)", limited > 0 && lastOk > 0, `over 40 rapid calls: ${lastOk} allowed, ${limited} rate-limited`);
  }

  // ========================================================================
  // Handle availability MOVED to unauthenticated GET /v1/auth/handle-available.
  // Returns ONLY { available }; reserved/taken/confusable all look identical.
  // ========================================================================
  {
    const taken = await api(`/v1/auth/handle-available?handle=w9s${stamp % 100000}`); // S's handle
    const reserved = await api(`/v1/auth/handle-available?handle=admin`);
    const free = await api(`/v1/auth/handle-available?handle=freeone${stamp % 100000}`);
    const onlyAvailable = (b: any) => b && typeof b.available === "boolean" && Object.keys(b).join(",") === "available";
    check("Availability moved to /v1/auth/handle-available: taken=false, reserved=false, free=true, body is {available} only", taken.body.data?.available === false && reserved.body.data?.available === false && free.body.data?.available === true && onlyAvailable(taken.body.data) && onlyAvailable(reserved.body.data), `taken=${taken.body.data?.available} reserved=${reserved.body.data?.available} free=${free.body.data?.available}; keys=${taken.body.data ? Object.keys(taken.body.data).join(",") : "?"}`);

    // Confusable of S's handle collapses to the same normalized form → taken.
    const conf = await api(`/v1/auth/handle-available?handle=${`w9s${stamp % 100000}`.replace(/s/g, "5")}`);
    check("Availability applies confusable normalization (a confusable of a taken handle → available:false)", conf.body.data?.available === false, `confusable → available=${conf.body.data?.available}`);

    // Unauthenticated + hard IP rate limit (20/min).
    let limited = 0;
    for (let i = 0; i < 30; i++) {
      const r = await api(`/v1/auth/handle-available?handle=probe${i}`);
      if (r.status === 429) limited++;
    }
    check("Availability is unauthenticated but hard IP rate-limited (sweeping → RATE_LIMITED)", limited > 0, `over 30 rapid unauthenticated calls: ${limited} rate-limited`);
  }

  // ========================================================================
  // Wallet listing (§5): GET /v1/catches, scoped to the CURRENT holder.
  // ========================================================================
  {
    const dWallet = await liveDrop(3);
    await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
    const c = await catchAs(S.token, dWallet);
    const sHeld1 = (await api(`/v1/catches?status=held`, { token: S.token })).body.data as any[];
    const inSWallet = sHeld1.some((w) => w.id === c.catchId && w.drop?.id === dWallet && typeof w.code === "string");
    // Transfer it away; it should leave S's held wallet and enter R's.
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    await api(`/v1/transfers/${send.body.data?.transfer_id}/accept`, { method: "POST", token: R.token });
    const sHeld2 = ((await api(`/v1/catches?status=held`, { token: S.token })).body.data as any[]).some((w) => w.id === c.catchId);
    const rHeld = ((await api(`/v1/catches?status=held`, { token: R.token })).body.data as any[]).some((w) => w.id === c.catchId);
    check("GET /v1/catches (wallet) lists held catches for the current holder and follows an accepted transfer", inSWallet && !sHeld2 && rHeld, `S held before=${inSWallet}; after transfer S held=${sHeld2} (want false), R held=${rHeld} (want true)`);
  }

  // ========================================================================
  // SMS on send / accept / decline — regardless of follow tier or SMS pref.
  // (R and S set no notification preferences and are not fanatics.)
  // ========================================================================
  {
    const dSms = await liveDrop(3);
    await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });

    const c = await catchAs(S.token, dSms);
    await redis.del(`dev:sms:${rPhone}`);
    const send = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c.catchId, to_handle: `w9r${stamp % 100000}` } });
    const sendSms = smsBodies(await redis.lrange(`dev:sms:${rPhone}`, 0, -1));
    check("SMS on SEND goes to the recipient regardless of tier/preference", send.status === 201 && sendSms.some((b) => b.includes(`w9s${stamp % 100000}`)), `recipient sms count=${sendSms.length}; latest=${JSON.stringify(sendSms[0]?.slice(0, 80))}`);

    await redis.del(`dev:sms:${sPhone}`);
    const acc = await api(`/v1/transfers/${send.body.data?.transfer_id}/accept`, { method: "POST", token: R.token });
    const acceptSms = smsBodies(await redis.lrange(`dev:sms:${sPhone}`, 0, -1));
    check("SMS on ACCEPT goes to the sender", acc.status === 200 && acceptSms.some((b) => b.toLowerCase().includes("accepted")), `sender sms count=${acceptSms.length}; latest=${JSON.stringify(acceptSms[0]?.slice(0, 80))}`);

    // Decline on a fresh catch.
    const dSms2 = await liveDrop(3);
    await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
    const c2 = await catchAs(S.token, dSms2);
    const send2 = await api("/v1/transfers", { method: "POST", token: S.token, body: { catch_id: c2.catchId, to_handle: `w9r${stamp % 100000}` } });
    await redis.del(`dev:sms:${sPhone}`);
    const dec = await api(`/v1/transfers/${send2.body.data?.transfer_id}/decline`, { method: "POST", token: R.token });
    const declineSms = smsBodies(await redis.lrange(`dev:sms:${sPhone}`, 0, -1));
    check("SMS on DECLINE goes to the sender", dec.status === 200 && declineSms.some((b) => b.toLowerCase().includes("declined")), `sender sms count=${declineSms.length}; latest=${JSON.stringify(declineSms[0]?.slice(0, 80))}`);
  }

  await pg.end();
  console.log("\nWP-9 transfers gate against " + BASE + "\n");
  for (const r of results) { console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`); console.log(`         ${r.detail}`); }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
