/* eslint-disable @typescript-eslint/no-explicit-any -- load-test harness */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { Redis } from "@upstash/redis";

/**
 * WP-7 catch-contract load test. Drives lib/catches.ts directly (the exact code
 * the HTTP route calls) against REAL Redis (local SRH, Upstash REST protocol)
 * and REAL Postgres (local Supabase). The HTTP endpoint is proven separately.
 */

// --- load env (dev.local overrides local) BEFORE importing the lib ---
function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
  } catch { /* ignore */ }
  return out;
}
const envLocal = loadEnv(".env.local");
const envDev = loadEnv(".env.development.local");
for (const [k, v] of Object.entries({ ...envLocal, ...envDev })) process.env[k] = v;

const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_HOST = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;

// Load-test scale. Local/manual default is the full 5,000 × 5 (the WP-7
// deliverable). CI runs a reduced 1,000 × 3 for speed/reliability — still far
// above the 100-unit contention point, so any non-atomic regression oversells.
const USERS = Number(process.env.LOADTEST_USERS ?? 5000);
const RUNS = Number(process.env.LOADTEST_RUNS ?? 5);
const UNITS = 100;

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });

async function main(): Promise<void> {
  // Imported after env is set (lib reads env lazily; safe).
  const { catchDrop, reconcileDrop } = await import("@/lib/catches");
  const { seedInventory, seedDropMeta, readInventory, setDecrObserver } = await import("@/lib/redis");

  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const stamp = Date.now();
  const founder = (await pg.query(`select id from users where user_number=1`)).rows[0].id as string;
  const org = (await pg.query(`insert into organizations (name,lane,tier,max_locations,drops_per_cycle,cycle_anchor_at) values ('LT Org','local','local_enterprise',5,1000,now()) returning id`)).rows[0].id as string;
  const loc = (await pg.query(`insert into locations (org_id,name,line1,city,region,postal_code,lat,lng) values ($1,'LT','1 Main','Salt Lake City','UT','84101',40.76,-111.89) returning id`, [org]).then(r => r.rows[0].id)) as string;

  async function liveDrop(qt: number): Promise<string> {
    const id = (await pg.query(
      `insert into drops (lane,org_id,location_id,title,description,quantity_total,quantity_remaining,live_at,live_until,redeem_from,redeem_until,created_by,status)
       values ('local',$1,$2,'LT Drop','d',$3,$3, now()-interval '1 minute', now()+interval '1 day', now()+interval '1 hour', now()+interval '2 hour', $4, 'draft') returning id`,
      [org, loc, qt, founder]
    )).rows[0].id as string;
    await pg.query(`update drops set status='scheduled' where id=$1`, [id]);
    await pg.query(`update drops set status='live' where id=$1`, [id]);
    await seedInventory(id, qt);
    await seedDropMeta(id, { qt, lu: Date.now() + 864e5, ru: new Date(Date.now() + 2 * 864e5).toISOString(), title: "LT Drop" });
    return id;
  }

  // --- bulk-create 5,000 distinct users (reused across runs) ---
  console.error(`creating ${USERS} users...`);
  await pg.query(
    `with ids as (select gen_random_uuid() id, g from generate_series(1,${USERS}) g),
     au as (
       insert into auth.users (id, instance_id, aud, role, email, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token, created_at, updated_at)
       select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','lt${stamp}_'||g||'@t.test','','','','','','','','', now(), now() from ids returning id
     )
     insert into users (id, handle, full_name, email, phone, location_perm_granted_at)
     select ids.id, 'lt${stamp}u'||g, 'LT '||g, 'lt${stamp}_'||g||'@t.test', 'LT${stamp}-'||g, now() from ids`
  );
  const userIds = (await pg.query(`select id from users where handle like 'lt${stamp}u%' order by handle`)).rows.map((r) => r.id as string);
  check(`bulk-created ${USERS} distinct users`, userIds.length === USERS, `users=${userIds.length}`);

  // ========================================================================
  // LOAD TEST — 5,000 concurrent catches against 100 units, run 5 times.
  // ========================================================================
  const runReports: string[] = [];
  let allRunsClean = true;
  for (let run = 1; run <= RUNS; run++) {
    const dropId = await liveDrop(UNITS);
    const decrTimes: number[] = [];
    setDecrObserver((_id, at) => decrTimes.push(at));
    let inFlight = 0, maxInFlight = 0;

    const tasks = userIds.map((uid) => async () => {
      inFlight++; if (inFlight > maxInFlight) maxInFlight = inFlight;
      try {
        const r = await catchDrop(uid, dropId, `${dropId}:${uid}`);
        return { ok: true as const, position: r.position_number };
      } catch (e: any) {
        return { ok: false as const, code: e?.code ?? "ERR", msg: e?.message };
      } finally {
        inFlight--;
      }
    });
    const settled = await Promise.all(tasks.map((t) => t()));
    setDecrObserver(undefined);

    const wins = settled.filter((s) => s.ok) as { ok: true; position: number }[];
    const positions = wins.map((w) => w.position).sort((a, b) => a - b);
    const gone = settled.filter((s) => !s.ok && (s as any).code === "DROP_GONE").length;
    const other = settled.filter((s) => !s.ok && (s as any).code !== "DROP_GONE") as any[];
    const rows = Number((await pg.query(`select count(*)::int n from catches where drop_id=$1`, [dropId])).rows[0].n);
    const distinctPos = new Set(positions).size;
    const expected = Array.from({ length: UNITS }, (_, i) => i + 1);
    const positionsPerfect = positions.length === UNITS && distinctPos === UNITS && positions.every((p, i) => p === expected[i]);
    const clean = wins.length === UNITS && rows === UNITS && gone === USERS - UNITS && other.length === 0 && positionsPerfect;
    if (!clean) allRunsClean = false;

    const spreadMs = decrTimes.length ? Math.max(...decrTimes) - Math.min(...decrTimes) : 0;
    runReports.push(`run ${run}: catches=${wins.length} rows=${rows} gone=${gone} other=${other.length} positions=${positionsPerfect ? "1.."+UNITS+" exact, no dup/gap" : "BAD " + JSON.stringify(positions.slice(0, 5))} | achieved concurrency: maxInFlight=${maxInFlight}, DECR spread=${spreadMs}ms over ${decrTimes.length} DECRs` + (other.length ? ` | OTHER=${JSON.stringify(other.slice(0, 3))}` : ""));
  }
  check(`${USERS} concurrent × ${UNITS} units → exactly ${UNITS} catches, positions 1..${UNITS}, zero oversell (${RUNS} runs)`, allRunsClean, "\n         " + runReports.join("\n         "));

  // ========================================================================
  // DROP_GONE without a database round trip — proven mechanically.
  // ========================================================================
  const origFetch = globalThis.fetch;
  let dbCalls = 0;
  globalThis.fetch = ((url: any, opts: any) => { if (String(url).includes(SUPABASE_HOST)) dbCalls++; return origFetch(url, opts); }) as any;
  // A drop seeded in Redis (exhausted) but NEVER in Postgres: if the Gone path
  // touched Postgres it would 404 (NOT_FOUND) or increment dbCalls.
  const ghostId = randomUUID();
  await seedInventory(ghostId, 0); // DECR → -1 → Gone
  await seedDropMeta(ghostId, { qt: 0, lu: Date.now() + 864e5, ru: null, title: "ghost" });
  dbCalls = 0;
  let goneCode = "";
  try { await catchDrop(userIds[0], ghostId, `ghost:${stamp}`); } catch (e: any) { goneCode = e?.code; }
  const goneDbCalls = dbCalls;
  // Positive control: a real successful catch touches Postgres exactly once.
  const ctrlDrop = await liveDrop(3);
  dbCalls = 0;
  await catchDrop(userIds[1], ctrlDrop, `ctrl:${stamp}`);
  const successDbCalls = dbCalls;
  globalThis.fetch = origFetch;
  check("DROP_GONE returns with ZERO Postgres round trips (mechanical, query count)", goneCode === "DROP_GONE" && goneDbCalls === 0 && successDbCalls === 1, `gone: code=${goneCode} dbCalls=${goneDbCalls}; success control dbCalls=${successDbCalls}`);

  // ========================================================================
  // Idempotency: same key replayed 50× → one unit, same position.
  // ========================================================================
  const idemDrop = await liveDrop(5);
  const idemKey = `idem:${stamp}`;
  const replays = await Promise.all(Array.from({ length: 50 }, () => catchDrop(userIds[2], idemDrop, idemKey).then((r) => r.position_number)));
  const invAfter = await readInventory(idemDrop);
  const idemRows = Number((await pg.query(`select count(*)::int n from catches where drop_id=$1`, [idemDrop])).rows[0].n);
  check("same Idempotency-Key × 50 → one unit consumed, one row, same position", new Set(replays).size === 1 && invAfter === 4 && idemRows === 1, `distinct positions=${new Set(replays).size} (${replays[0]}); redis inventory=${invAfter} (5→4); rows=${idemRows}`);

  // ========================================================================
  // Forced Postgres write failure burns the position; the gap persists.
  // ========================================================================
  const burnDrop = await liveDrop(5);
  await pg.query(`create or replace function _burn_trg() returns trigger language plpgsql as $$ begin if new.drop_id='${burnDrop}' and new.position_number=3 then raise exception 'forced write failure'; end if; return new; end $$`);
  await pg.query(`create trigger _burn before insert on catches for each row execute function _burn_trg()`);
  const burnResults = await Promise.all(userIds.slice(10, 15).map((uid) => catchDrop(uid, burnDrop, `burn:${burnDrop}:${uid}`).then((r) => ({ ok: true, pos: r.position_number })).catch((e: any) => ({ ok: false, code: e?.code }))));
  await pg.query(`drop trigger _burn on catches`);
  await pg.query(`drop function _burn_trg()`);
  const burnPositions = (await pg.query(`select position_number from catches where drop_id=$1 order by position_number`, [burnDrop])).rows.map((r) => Number(r.position_number));
  // inventory is exhausted (5 DECRs); DECR only decreases, so position 3 can never recur.
  const gapAt3 = !burnPositions.includes(3) && burnPositions.length === 4 && (await readInventory(burnDrop)) === 0;
  check("forced write failure burns the position; gap persists; number never reused", gapAt3 && (burnResults.filter((b: any) => b.ok).length === 4), `catch rows at positions=${JSON.stringify(burnPositions)} (3 burned); inventory exhausted → DECR cannot re-dispense 3`);

  // ========================================================================
  // Catch → transfer (DB-level) → catch again → ALREADY_CAUGHT.
  // (API transfer is WP-9; here we move catches.user_id directly.)
  // ========================================================================
  const acDrop = await liveDrop(5);
  const A = userIds[20], B = userIds[21];
  const first = await catchDrop(A, acDrop, `ac1:${stamp}`);
  await pg.query(`update catches set user_id=$1 where drop_id=$2 and original_user_id=$3`, [B, acDrop, A]); // "transfer" to B
  let acCode = "";
  try { await catchDrop(A, acDrop, `ac2:${stamp}`); } catch (e: any) { acCode = e?.code; }
  const holder = (await pg.query(`select user_id from catches where drop_id=$1 and original_user_id=$2`, [acDrop, A])).rows[0].user_id;
  check("catch → transfer away (DB) → catch again → ALREADY_CAUGHT (constraint on original_user_id)", first.position_number === 1 && holder === B && acCode === "ALREADY_CAUGHT", `first pos=${first.position_number}; holder now B=${holder === B}; second attempt=${acCode}`);

  // ========================================================================
  // Reconciliation writes quantity_remaining downward only.
  // ========================================================================
  await pg.query(`update drops set quantity_remaining=5 where id=$1`, [burnDrop]); // artificially high
  const rec = await reconcileDrop(burnDrop);
  const recUp = await pg.query(`update drops set quantity_remaining=0 where id=$1`, [burnDrop]).then(() => reconcileDrop(burnDrop));
  check("reconciliation lowers quantity_remaining to Redis, never raises it", rec.quantity_remaining_after < rec.quantity_remaining_before && rec.quantity_remaining_after === (rec.redis_inventory ?? -1) && recUp.quantity_remaining_after === 0, `first: ${rec.quantity_remaining_before}→${rec.quantity_remaining_after} (redis=${rec.redis_inventory}, drift=${rec.drift}); when already 0 stays ${recUp.quantity_remaining_after}`);

  // ========================================================================
  // SRH vs Upstash cloud DECR parity (a few hundred commands).
  // ========================================================================
  async function decrStorm(r: Redis, key: string, n: number): Promise<{ final: number; unique: number; min: number }> {
    await r.set(key, n);
    const vals = await Promise.all(Array.from({ length: n }, () => r.decr(key)));
    return { final: (await r.get<number>(key)) ?? NaN, unique: new Set(vals).size, min: Math.min(...vals) };
  }
  const srh = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! });
  const srhRes = await decrStorm(srh, `parity:srh:${stamp}`, 300);
  let cloudRes: any = { skipped: true };
  if (envLocal.UPSTASH_REDIS_REST_URL && envLocal.UPSTASH_REDIS_REST_URL.includes("upstash.io")) {
    const cloud = new Redis({ url: envLocal.UPSTASH_REDIS_REST_URL, token: envLocal.UPSTASH_REDIS_REST_TOKEN });
    cloudRes = await decrStorm(cloud, `parity:cloud:${stamp}`, 300);
  }
  const parityOk = srhRes.final === 0 && srhRes.unique === 300 && srhRes.min === 0 && (cloudRes.skipped || (cloudRes.final === 0 && cloudRes.unique === 300 && cloudRes.min === 0));
  check("SRH and Upstash cloud agree: 300 concurrent DECRs, no lost decrements", parityOk, `SRH: final=${srhRes.final} unique=${srhRes.unique} min=${srhRes.min}; Upstash cloud: ${cloudRes.skipped ? "SKIPPED (no cloud creds)" : `final=${cloudRes.final} unique=${cloudRes.unique} min=${cloudRes.min}`}`);

  await pg.end();
  console.log("\nWP-7 catch-contract load test (Redis: local SRH; Postgres: local Supabase)\n");
  for (const r of results) { console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`); console.log(`         ${r.detail}`); }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
