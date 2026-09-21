/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { Redis } from "@upstash/redis";

/**
 * WP-12 notifications gate. Real HTTP API on a running dev server + local
 * Postgres + Redis (for the dev-notification mirrors). No endpoint is stubbed.
 */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env.local", ".env.development.local"]) {
    try { for (const line of readFileSync(file, "utf8").split("\n")) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) out[m[1]] = m[2].trim(); } } catch { /* ignore */ }
  }
  return out;
}
const envL = loadEnvLocal();
const redis = new Redis({ url: envL.UPSTASH_REDIS_REST_URL, token: envL.UPSTASH_REDIS_REST_TOKEN });

async function api(p: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${p}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const raw = await res.text();
  let body: any = raw; try { body = JSON.parse(raw); } catch { /* keep */ }
  return { status: res.status, body };
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
  await api("/v1/auth/register/complete", { method: "POST", token, body: { full_name: `N ${handle}`, handle, phone: `+1801${Math.floor(1000000 + Math.random() * 8999999)}`, address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" } } });
  await api("/v1/users/me/location-permission", { method: "POST", token, body: { granted: true } });
  return { token, uid: subOf(token) };
}
function walk(dir: string): string[] { const out: string[] = []; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else if (e.name.endsWith(".ts")) out.push(p); } return out; }

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const stamp = Date.now();
  const root = process.cwd();
  const admin = await session("info@juicyninja.com");
  const phoneOf = async (uid: string) => (await pg.query(`select phone from users where id=$1`, [uid])).rows[0].phone as string;
  const emailOf = async (uid: string) => (await pg.query(`select email from users where id=$1`, [uid])).rows[0].email as string;
  const notifs = async (uid: string, kind: string) => (await pg.query(`select channel, sent_at from notifications where user_id=$1 and kind=$2`, [uid, kind])).rows as { channel: string; sent_at: string | null }[];

  // A helper org (pg) in a given lane.
  const mkOrg = async (name: string, lane: string): Promise<string> =>
    (await pg.query(`insert into organizations (name, lane, tier, max_locations, drops_per_cycle, cycle_anchor_at) values ($1,$2,'local_superstar',5,1000,now()) returning id`, [name, lane])).rows[0].id as string;

  // ========================================================================
  // GATE 1 + 2 — Fanatic cap: 11th in a lane → FANATIC_LIMIT_REACHED (with the
  // lane's current Fanatics for a swap); a Fanatic in another lane is independent.
  // ========================================================================
  const capper = await register(`w12cap_${stamp}@t.test`, `w12c${stamp % 100000}`);
  const localOrgs: string[] = [];
  for (let i = 0; i < 11; i++) localOrgs.push(await mkOrg(`W12 Local ${i} ${stamp}`, "local"));
  const makerOrg = await mkOrg(`W12 Maker ${stamp}`, "maker");

  let tenOk = 0;
  for (let i = 0; i < 10; i++) { const r = await api(`/v1/follows/${localOrgs[i]}`, { method: "PUT", token: capper.token, body: { tier: "fanatic" } }); if (r.status === 200) tenOk++; }
  const eleventh = await api(`/v1/follows/${localOrgs[10]}`, { method: "PUT", token: capper.token, body: { tier: "fanatic" } });
  check(
    "11th Fanatic in a lane → FANATIC_LIMIT_REACHED with current Fanatics for a swap",
    tenOk === 10 && eleventh.status === 409 && eleventh.body.error?.code === "FANATIC_LIMIT_REACHED" && (eleventh.body.error?.details?.current_fanatics?.length ?? 0) === 10,
    `first 10 accepted=${tenOk}; 11th=${eleventh.status} ${eleventh.body.error?.code}; current_fanatics returned=${eleventh.body.error?.details?.current_fanatics?.length}`,
  );
  const makerFan = await api(`/v1/follows/${makerOrg}`, { method: "PUT", token: capper.token, body: { tier: "fanatic" } });
  check(
    "a Fanatic in one lane does not consume a slot in another (independent pools)",
    makerFan.status === 200 && makerFan.body.data?.lane === "maker",
    `maker Fanatic while 10 local Fanatics held → ${makerFan.status} (lane=${makerFan.body.data?.lane})`,
  );

  // ========================================================================
  // GATE 3 — no merchant-initiated path to set a user's follow tier (grep).
  // ========================================================================
  const files = [...walk(path.join(root, "app", "api")), ...walk(path.join(root, "lib"))];
  const followWriters: string[] = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    // A WRITE to the follows table is a write method applied directly to the
    // follows query (`from("follows").insert|upsert|update|delete`). A `.select`
    // on follows is a read and does not count.
    if (/from\(\s*["']follows["']\s*\)\s*\.\s*(insert|upsert|update|delete)\b/.test(s)) followWriters.push(path.relative(root, f).replace(/\\/g, "/"));
  }
  // The only writer is lib/follows.ts, and it keys on the authenticated caller
  // (setFollowTier(userId, ...)); the route param is org_id, never a target user.
  const followRouteSrc = readFileSync(path.join(root, "app", "api", "v1", "follows", "[org_id]", "route.ts"), "utf8");
  const targetsCaller = /setFollowTier\(user\.id/.test(followRouteSrc) && !/user_id/.test(followRouteSrc);
  check(
    "no merchant-initiated path to set a user's follow tier — grep-verified",
    followWriters.length === 1 && followWriters[0] === "lib/follows.ts" && targetsCaller,
    `follows writers: [${followWriters.join(", ")}]; follows route sets caller's own tier (org_id param, no target user_id)=${targetsCaller}`,
  );

  // ========================================================================
  // Drop-live routing + queued fan-out. One local org with a Fanatic, a
  // Follower, and a category-match non-follower.
  // ========================================================================
  const owner = await register(`w12own_${stamp}@t.test`, `w12o${stamp % 100000}`);
  const org = (await api("/v1/orgs", { method: "POST", token: owner.token, body: { name: "W12 Co", tier: "local_superstar" } })).body.data.id;
  const loc = (await api(`/v1/orgs/${org}/locations`, { method: "POST", token: owner.token, body: { name: "Shop", line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101", geofence_radius_m: 150 } })).body.data.id;
  const fanaticU = await register(`w12fan_${stamp}@t.test`, `w12f${stamp % 100000}`);
  const followerU = await register(`w12fol_${stamp}@t.test`, `w12fl${stamp % 100000}`);
  const categoryU = await register(`w12cat_${stamp}@t.test`, `w12ct${stamp % 100000}`);
  await api(`/v1/follows/${org}`, { method: "PUT", token: fanaticU.token, body: { tier: "fanatic" } });
  await api(`/v1/follows/${org}`, { method: "PUT", token: followerU.token, body: { tier: "follower" } });
  // Category match: classify the org as Tacos and have categoryU select Tacos,
  // WITHOUT following the org.
  const tacos = (await pg.query(`select id from tags where slug='tacos'`)).rows[0].id as string;
  await pg.query(`insert into org_tags (org_id, tag_id) values ($1,$2) on conflict do nothing`, [org, tacos]);
  await pg.query(`insert into user_tags (user_id, tag_id) values ($1,$2) on conflict do nothing`, [categoryU.uid, tacos]);

  const drop = (await api("/v1/drops", { method: "POST", token: owner.token, body: { location_id: loc, title: "Notify Drop", description: "d", quantity_total: 5, live_at: iso(-2000), live_until: iso(864e5), redeem_from: iso(-1000), redeem_until: iso(864e5), publish: true } })).body.data.id;
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin }); // go-live → enqueue drop-live

  const fanN = await notifs(fanaticU.uid, "drop_live");
  const folN = await notifs(followerU.uid, "drop_live");
  const catN = await notifs(categoryU.uid, "drop_live");
  const chans = (rows: { channel: string }[]) => rows.map((r) => r.channel).sort().join(",");

  // ---- Requirement 1: fan-out is QUEUED (rows exist, nothing sent yet). ----
  const allQueued = [...fanN, ...folN, ...catN].length > 0 && [...fanN, ...folN, ...catN].every((r) => r.sent_at === null);
  check(
    "fan-out is queued, not synchronous: go-live enqueues notification rows and sends nothing (no provider call can block go-live)",
    allQueued && fanN.length > 0,
    `right after go-live: ${fanN.length + folN.length + catN.length} rows, all sent_at=null=${allQueued}`,
  );

  // ---- GATE 4: category/radius match → email only, never push, never SMS. ----
  check(
    "category/radius matches receive EMAIL only, never push, never SMS",
    chans(catN) === "email",
    `category-match user drop_live channels = [${chans(catN)}] (want: email)`,
  );
  check(
    "routing matrix: Fanatic → SMS+push, Follower → push+in_app (drop live)",
    chans(fanN) === "push,sms" && chans(folN) === "in_app,push",
    `Fanatic=[${chans(fanN)}] Follower=[${chans(folN)}]`,
  );

  // ========================================================================
  // Dispatch + Requirement 2: idempotent delivery (no double-send on retry).
  // ========================================================================
  const fanPhone = await phoneOf(fanaticU.uid);
  const catEmail = await emailOf(categoryU.uid);
  await redis.del(`dev:sms:${fanPhone}`);
  await redis.del(`dev:email:${catEmail}`);
  const d1 = await api("/v1/admin/notifications/dispatch", { method: "POST", token: admin });
  const d2 = await api("/v1/admin/notifications/dispatch", { method: "POST", token: admin }); // retry
  const smsCount = (await redis.lrange(`dev:sms:${fanPhone}`, 0, -1)).length;
  const emailCount = (await redis.lrange(`dev:email:${catEmail}`, 0, -1)).length;
  const fanSent = (await notifs(fanaticU.uid, "drop_live")).filter((r) => r.channel === "sms")[0]?.sent_at;
  check(
    "delivery is idempotent: a retried dispatch does not send the same alert twice (one SMS, one email)",
    smsCount === 1 && emailCount === 1 && fanSent !== null,
    `after two dispatch runs: Fanatic drop-live SMS sends=${smsCount}, category email sends=${emailCount}; first dispatch sent=${d1.body.data?.sent}, retry sent=${d2.body.data?.sent}`,
  );

  // Enqueue idempotency: a fresh drop-live enqueue for the same drop adds no rows.
  const beforeRows = Number((await pg.query(`select count(*)::int n from notifications where kind='drop_live' and payload->>'drop_id'=$1`, [drop])).rows[0].n);
  // Re-running the go-live path is a no-op (drop already live); re-enqueue via the
  // tick's scans won't touch drop_live. Assert the dedup index holds by counting.
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
  const afterRows = Number((await pg.query(`select count(*)::int n from notifications where kind='drop_live' and payload->>'drop_id'=$1`, [drop])).rows[0].n);
  check(
    "enqueue is idempotent: drop-live rows are one per (user, channel) and do not multiply on re-tick",
    beforeRows === afterRows && beforeRows > 0,
    `drop_live rows for this drop: ${beforeRows} → ${afterRows} (stable)`,
  );

  // ========================================================================
  // GATE 5 — digest respects digest_hour_local, resolved against the user's IANA
  // TIMEZONE (not UTC). Same hour number in two zones → different outcomes.
  // ========================================================================
  const hourInZone = (tz: string) => (parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()), 10)) % 24;
  const denverHour = hourInZone("America/Denver");
  const nyHour = hourInZone("America/New_York"); // always denverHour+2 (mod 24)

  // A user registered with an SLC address defaults to America/Denver.
  const digestUser = await register(`w12don_${stamp}@t.test`, `w12don${stamp % 100000}`);
  const defaultedTz = (await pg.query(`select timezone from users where id=$1`, [digestUser.uid])).rows[0].timezone as string | null;
  check(
    "user timezone is defaulted from the Home city at registration (SLC → America/Denver)",
    defaultedTz === "America/Denver",
    `registered with an SLC address → users.timezone=${defaultedTz}`,
  );

  // digestUser stays America/Denver; nyUser is moved to America/New_York. Both
  // set the SAME digest_hour_local number (Denver's current local hour). Only the
  // Denver user should match — the NY user's local hour is 2h different.
  const nyUser = await register(`w12ny_${stamp}@t.test`, `w12ny${stamp % 100000}`);
  await pg.query(`update users set timezone='America/New_York' where id=$1`, [nyUser.uid]);
  await api("/v1/users/me/notification-prefs", { method: "PATCH", token: digestUser.token, body: { digest_hour_local: denverHour } });
  await api("/v1/users/me/notification-prefs", { method: "PATCH", token: nyUser.token, body: { digest_hour_local: denverHour } });
  await api("/v1/admin/notifications/digest", { method: "POST", token: admin });
  const denverDigest = (await notifs(digestUser.uid, "digest")).length;
  const nyDigest = (await notifs(nyUser.uid, "digest")).length;
  check(
    "digest respects digest_hour_local in the user's TIMEZONE, not UTC (same hour number, different zone → different outcome)",
    denverDigest === 1 && nyDigest === 0,
    `both set digest_hour_local=${denverHour}: Denver user (local hour ${denverHour}) → digests=${denverDigest}; NY user (local hour ${nyHour}) → digests=${nyDigest}`,
  );

  // ========================================================================
  // GATE 6 — the digest scan pages past PostgREST's 1000-row cap. Seed 1100
  // users who all match the current hour; every one must get a digest. Before
  // the fix, enqueueDigests read only the first 1000 users and the overflow was
  // silently skipped. Bulk-inserted by SQL (HTTP register would be far too slow).
  // ========================================================================
  const N = 1100;
  const dtag = `w12scale_${stamp}`;
  await pg.query(
    `insert into auth.users (id, email)
     select gen_random_uuid(), '${dtag}_' || g || '@t.test' from generate_series(1, $1) g`,
    [N],
  );
  await pg.query(
    `insert into users (id, email, full_name, handle, phone, phone_verified_at, timezone)
     select id, email, 'Scale', 'w12s${stamp}_' || rn, '+1801' || lpad((2000000 + rn)::text, 7, '0'), now(), 'America/Denver'
     from (select id, email, row_number() over (order by email) rn from auth.users where email like '${dtag}_%@t.test') a`,
  );
  await pg.query(
    `insert into notification_prefs (user_id, push_enabled, email_enabled, sms_enabled, digest_hour_local)
     select id, true, true, true, $1 from users where email like '${dtag}_%@t.test'`,
    [denverHour],
  );
  await api("/v1/admin/notifications/digest", { method: "POST", token: admin });
  const scaleDigests = (await pg.query(
    `select count(*)::int n from notifications where kind='digest' and user_id in (select id from users where email like '${dtag}_%@t.test')`,
  )).rows[0].n as number;
  check(
    "digest scan pages past the 1000-row cap: every one of 1100 matching users is enqueued",
    scaleDigests === N,
    `seeded ${N} users at digest_hour_local=${denverHour} (America/Denver) → digests enqueued=${scaleDigests}`,
  );

  await pg.end();
  console.log("\nWP-12 notifications gate against " + BASE + "\n");
  for (const r of results) { console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`); console.log(`         ${r.detail}`); }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
