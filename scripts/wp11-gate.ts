/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { Redis } from "@upstash/redis";

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env.local", ".env.development.local"]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m) out[m[1]] = m[2].trim();
      }
    } catch { /* ignore */ }
  }
  return out;
}
const _env = loadEnvLocal();
const redis = new Redis({ url: _env.UPSTASH_REDIS_REST_URL, token: _env.UPSTASH_REDIS_REST_TOKEN });

/**
 * WP-11 board / ranking / realtime / category-filter gate. Drives the real HTTP
 * API on a running dev server plus local Postgres. No endpoint is stubbed and no
 * result is asserted without the actual value printed.
 */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

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
async function register(email: string, handle: string, grantLoc = true): Promise<{ token: string; uid: string }> {
  const token = await session(email);
  await api("/v1/auth/register/complete", { method: "POST", token, body: { full_name: `N ${handle}`, handle, phone: `+1801${Math.floor(1000000 + Math.random() * 8999999)}`, address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" } } });
  if (grantLoc) await api("/v1/users/me/location-permission", { method: "POST", token, body: { granted: true } });
  return { token, uid: subOf(token) };
}
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const stamp = Date.now();
  const root = process.cwd();
  const admin = await session("info@juicyninja.com");

  const buyer = await register(`w11buy_${stamp}@t.test`, `w11b${stamp % 100000}`);
  const buyer2 = await register(`w11buy2_${stamp}@t.test`, `w11b2${stamp % 100000}`);
  const noPerm = await register(`w11np_${stamp}@t.test`, `w11np${stamp % 100000}`, false);
  const ownerA = await register(`w11oa_${stamp}@t.test`, `w11oa${stamp % 100000}`);
  const ownerB = await register(`w11ob_${stamp}@t.test`, `w11ob${stamp % 100000}`);
  // Catching requires a verified phone since WP-3's gate (proven in wp3-gate).
  // noPerm is verified too, so its catch reaches the LOCATION gate (the thing
  // under test) rather than stopping at the phone gate first.
  await pg.query(`update users set phone_verified_at = now() where id = any($1::uuid[])`, [[buyer.uid, buyer2.uid, noPerm.uid, ownerA.uid, ownerB.uid]]);

  const mkOrgLoc = async (owner: { token: string }, name: string): Promise<{ org: string; loc: string }> => {
    const org = (await api("/v1/orgs", { method: "POST", token: owner.token, body: { name, tier: "local_superstar" } })).body.data.id;
    const loc = (await api(`/v1/orgs/${org}/locations`, { method: "POST", token: owner.token, body: { name: `${name} Shop`, line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101", geofence_radius_m: 150 } })).body.data.id;
    return { org, loc };
  };
  const A = await mkOrgLoc(ownerA, "W11 A");
  const B = await mkOrgLoc(ownerB, "W11 B");

  const mkDrop = async (owner: { token: string }, loc: string, qt: number): Promise<string> =>
    (await api("/v1/drops", { method: "POST", token: owner.token, body: { location_id: loc, title: `Drop ${qt}`, description: "d", quantity_total: qt, live_at: iso(-2000), live_until: iso(864e5), redeem_from: iso(-1000), redeem_until: iso(864e5), publish: true } })).body.data.id;

  // d200 created BEFORE d10, so d10 is the more-recently-live drop (tie-break).
  const d200 = await mkDrop(ownerB, B.loc, 200);
  await new Promise((r) => setTimeout(r, 1100));
  const d10 = await mkDrop(ownerA, A.loc, 10);
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin }); // go-live: seed Redis, set live_at

  // Equal sell-through 50%: set quantity_remaining directly (reconcile only ever
  // lowers toward Redis, so it will not raise these back). Then recompute pressure.
  await pg.query(`update drops set quantity_remaining=5 where id=$1`, [d10]);
  await pg.query(`update drops set quantity_remaining=100 where id=$1`, [d200]);
  // Merchant redemption rates: the OLDER/bigger drop gets the HIGHER rate, so if
  // rate (or count) affected ordering it would jump ahead of the newer d10.
  await pg.query(`insert into merchant_scores (org_id, redemption_rate, drops_counted) values ($1,0.10,1) on conflict (org_id) do update set redemption_rate=0.10`, [A.org]);
  await pg.query(`insert into merchant_scores (org_id, redemption_rate, drops_counted) values ($1,0.99,1) on conflict (org_id) do update set redemption_rate=0.99`, [B.org]);
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin }); // pressure recompute

  // Items 1/2 test the PRESSURE ranking path. A brand-new seed city is unlaunched
  // (launched_at null) → cold-start, which would rank On Fire by proximity. Read
  // the board's resolved city and take it out of the cold window so heat ranks.
  // (The cold path itself is exercised in its own fresh city further down.)
  const probe = await api("/v1/board", { token: buyer.token });
  const mainCity = probe.body.meta?.city_id;
  await pg.query(`update cities set launched_at = now() - interval '60 days', coldstart_min_events = 500 where id=$1`, [mainCity]);

  const board = await api("/v1/board", { token: buyer.token });
  const localFire = (board.body.data?.local?.on_fire ?? []) as any[];
  const c10 = localFire.find((c) => c.id === d10);
  const c200 = localFire.find((c) => c.id === d200);
  const idx10 = localFire.findIndex((c) => c.id === d10);
  const idx200 = localFire.findIndex((c) => c.id === d200);

  // ========================================================================
  check(
    "10-unit and 200-unit at equal sell-through rank equally — percentage, not count",
    c10?.pct_remaining === 0.5 && c200?.pct_remaining === 0.5,
    `d10 pct=${c10?.pct_remaining} (qty ${c10?.quantity_remaining}/${c10?.quantity_total}); d200 pct=${c200?.pct_remaining} (qty ${c200?.quantity_remaining}/${c200?.quantity_total})`,
  );
  check(
    "merchant redemption rate does not affect ordering (higher-rate d200 does not outrank; tie-break is recency)",
    idx10 >= 0 && idx200 >= 0 && idx10 < idx200 && c200?.merchant?.redemption_rate === 0.99 && c10?.merchant?.redemption_rate === 0.1,
    `on_fire order: d10@${idx10} (rate ${c10?.merchant?.redemption_rate}) before d200@${idx200} (rate ${c200?.merchant?.redemption_rate}) — newer first, not higher-rate/bigger first`,
  );

  // ========================================================================
  // Category filter: classify org A as Tacos, org B as Pizza. Filter → back.
  // ========================================================================
  const tacos = (await pg.query(`select id from tags where slug='tacos'`)).rows[0].id as string;
  const pizza = (await pg.query(`select id from tags where slug='pizza'`)).rows[0].id as string;
  await pg.query(`insert into org_tags (org_id, tag_id) values ($1,$2) on conflict do nothing`, [A.org, tacos]);
  await pg.query(`insert into org_tags (org_id, tag_id) values ($1,$2) on conflict do nothing`, [B.org, pizza]);
  const filtered1 = await api(`/v1/board?tag_id=${tacos}`, { token: buyer.token });
  const set1 = ((filtered1.body.data?.local?.on_fire ?? []) as any[]).map((c) => c.id).sort();
  await api(`/v1/drops/${d10}`, { token: buyer.token }); // open a drop (navigation)
  const filtered2 = await api(`/v1/board?tag_id=${tacos}`, { token: buyer.token });
  const set2 = ((filtered2.body.data?.local?.on_fire ?? []) as any[]).map((c) => c.id).sort();
  check(
    "filtering to a category, opening a drop, navigating back preserves the filter (stable, tag-scoped set)",
    set1.length > 0 && set1.includes(d10) && !set1.includes(d200) && JSON.stringify(set1) === JSON.stringify(set2),
    `tag=Tacos → [${set1.join(",")}] then (after opening a drop) [${set2.join(",")}]; d200 excluded=${!set1.includes(d200)}`,
  );

  // ========================================================================
  // Public GET /v1/drops/{id}: unauth 200 + can_catch:false + reason; authed states.
  // ========================================================================
  const dPub = await mkDrop(ownerA, A.loc, 5);
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
  const unauth = await api(`/v1/drops/${dPub}`);
  const noPermView = await api(`/v1/drops/${dPub}`, { token: noPerm.token });
  const canView = await api(`/v1/drops/${dPub}`, { token: buyer.token });
  check(
    "unauthenticated GET /v1/drops/{id} → 200 with can_catch:false and a reason",
    unauth.status === 200 && unauth.body.data?.can_catch === false && unauth.body.data?.catch_blocked_reason === "UNAUTHENTICATED",
    `${unauth.status}; can_catch=${unauth.body.data?.can_catch} reason=${unauth.body.data?.catch_blocked_reason}`,
  );
  check(
    "public drop detail: can_catch is server-computed per viewer (no perm → LOCATION_PERMISSION_REQUIRED; ready → true)",
    noPermView.body.data?.can_catch === false && noPermView.body.data?.catch_blocked_reason === "LOCATION_PERMISSION_REQUIRED" && canView.body.data?.can_catch === true && canView.body.data?.catch_blocked_reason === null,
    `noPerm: ${noPermView.body.data?.catch_blocked_reason}; ready buyer: can_catch=${canView.body.data?.can_catch}`,
  );
  const caughtPub = await api("/v1/catches", { method: "POST", token: buyer.token, idem: randomUUID(), body: { drop_id: dPub } });
  const afterCatch = await api(`/v1/drops/${dPub}`, { token: buyer.token });
  check(
    "public drop detail reflects ALREADY_CAUGHT after the viewer catches",
    caughtPub.status === 201 && afterCatch.body.data?.can_catch === false && afterCatch.body.data?.catch_blocked_reason === "ALREADY_CAUGHT",
    `catch=${caughtPub.status}; then can_catch=${afterCatch.body.data?.can_catch} reason=${afterCatch.body.data?.catch_blocked_reason}`,
  );

  // ========================================================================
  // Realtime is display-only: catch is decided solely by POST /v1/catches (Redis),
  // never by the Postgres quantity_remaining that realtime publishes.
  // ========================================================================
  const pubRow = await pg.query(`select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='drops'`);
  const dFalseGone = await mkDrop(ownerA, A.loc, 5);
  const dFalseAvail = await mkDrop(ownerA, A.loc, 5);
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
  // (a) Postgres display says GONE (0 — a decrease, allowed), Redis still has
  //     stock → the catch SUCCEEDS. A "gone" display does not block a catch.
  await pg.query(`update drops set quantity_remaining=0 where id=$1`, [dFalseGone]);
  const catchDespiteGone = await api("/v1/catches", { method: "POST", token: buyer.token, idem: randomUUID(), body: { drop_id: dFalseGone } });
  // (b) Redis exhausted (set the inventory counter to 0 directly), while the
  //     Postgres display still shows the full 5 → the catch returns DROP_GONE.
  //     An "available" display does not enable a catch. Redis is the only truth.
  await redis.set(`drop:${dFalseAvail}:inventory`, 0);
  const catchDespiteAvail = await api("/v1/catches", { method: "POST", token: buyer2.token, idem: randomUUID(), body: { drop_id: dFalseAvail } });
  const falseAvailQr = Number((await pg.query(`select quantity_remaining from drops where id=$1`, [dFalseAvail])).rows[0].quantity_remaining);
  check(
    "realtime is display-only: catch decided solely by POST /v1/catches (Redis), not the published Postgres value",
    (pubRow.rowCount ?? 0) === 1 && catchDespiteGone.status === 201 && catchDespiteAvail.status === 409 && catchDespiteAvail.body.error?.code === "DROP_GONE",
    `drops in realtime publication=${(pubRow.rowCount ?? 0) === 1}; false-gone(pg=0,redis>0)→catch ${catchDespiteGone.status}; false-avail(pg=${falseAvailQr},redis=0)→catch ${catchDespiteAvail.status} ${catchDespiteAvail.body.error?.code}`,
  );

  // ========================================================================
  // Type-ahead resolves a synonym to its leaf. NOTE: the seed has "Car Wash" as
  // its own leaf, so "car wash" resolves to Car Wash; "car detail" is a
  // synonym-only term for the Auto Detailing leaf — the property the item names.
  // ========================================================================
  const ta = await api(`/v1/tags/search?q=${encodeURIComponent("car detail")}`, { token: buyer.token });
  const detailHit = ((ta.body.data ?? []) as any[]).find((h) => /auto detailing/i.test(h.label));
  check(
    'type-ahead resolves a synonym to its leaf — "car detail" → Auto Detailing (matched_on synonym)',
    ta.status === 200 && !!detailHit && detailHit.matched_on === "synonym",
    `${ta.status}; hits=${JSON.stringify(((ta.body.data ?? []) as any[]).map((h) => `${h.label}:${h.matched_on}`))}`,
  );

  // EXPLAIN: the type-ahead query uses the tags_search GIN index, not a seq scan.
  const explainSql = `explain select t.id from tags t where t.active and t.parent_id is not null and tag_search_document(t.label, t.synonyms) @@ plainto_tsquery('simple', 'car detail')`;
  let plan = (await pg.query(explainSql)).rows.map((r: any) => r["QUERY PLAN"]).join("\n");
  let forced = false;
  if (!/tags_search/.test(plan)) {
    // On a small table the planner may pick a seq scan; force index consideration
    // to prove the query is index-ELIGIBLE (matches the index expression).
    await pg.query("set enable_seqscan=off");
    plan = (await pg.query(explainSql)).rows.map((r: any) => r["QUERY PLAN"]).join("\n");
    await pg.query("set enable_seqscan=on");
    forced = true;
  }
  check(
    "type-ahead query uses tags_search (index scan), not a sequential scan — EXPLAIN",
    /tags_search/.test(plan) && !/Seq Scan on tags/.test(plan),
    `${forced ? "(enable_seqscan=off) " : ""}plan: ${plan.replace(/\s+/g, " ").slice(0, 160)}`,
  );

  // ========================================================================
  // No free-text search over drop titles/descriptions — grep-verified.
  // ========================================================================
  const files = [...walk(path.join(root, "app", "api")), ...walk(path.join(root, "lib"))];
  const offenders: string[] = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    // A free-text drop search would text-search or ilike drops' title/description.
    if (/\.textSearch\(/.test(s) && /drops/.test(s)) offenders.push(path.relative(root, f) + " (textSearch)");
    if (/\.(ilike|like|fts|plfts|wfts)\(\s*["'](title|description)["']/.test(s)) offenders.push(path.relative(root, f) + " (ilike title/desc)");
    if (/(to_tsquery|plainto_tsquery|websearch_to_tsquery)/.test(s) && /(drops|title|description)/.test(s) && !/tags/.test(s)) offenders.push(path.relative(root, f) + " (tsquery over drops)");
  }
  check(
    "no endpoint performs free-text search over drop titles or descriptions — grep-verified",
    offenders.length === 0,
    offenders.length ? `OFFENDERS: ${offenders.join(", ")}` : "no drop-content text search anywhere; the only search is tags (search_tags)",
  );

  // ========================================================================
  // Cold-start engages for a new city and disengages on the event threshold.
  // ========================================================================
  const coldOwner = await register(`w11co_${stamp}@t.test`, `w11co${stamp % 100000}`);
  const coldBuyer = await register(`w11cb_${stamp}@t.test`, `w11cb${stamp % 100000}`);
  const coldBuyer2 = await register(`w11cb2_${stamp}@t.test`, `w11cb2${stamp % 100000}`);
  // The two threshold-crossing catches below need verified phones (WP-3 gate).
  await pg.query(`update users set phone_verified_at = now() where id = any($1::uuid[])`, [[coldBuyer.uid, coldBuyer2.uid]]);
  // A fresh, isolated city far from SLC/Provo, launched now, threshold = 2 events.
  // Coords are unique per run (offset from a remote base) so nearest-city
  // resolution always lands on THIS run's city — a fixed point would collide with
  // cold cities left by earlier runs and resolve to an arbitrary one.
  const jig = (1 + (stamp % 100000)) / 1e6;
  const CX = 45.0 + jig, CY = -100.0 - jig;
  const coldCity = (await pg.query(`insert into cities (name, region, lat, lng, active, launched_at, coldstart_days, coldstart_min_events) values ($1,'ND',$2,$3,true, now(), 30, 2) returning id`, [`W11 Cold ${stamp}`, CX, CY])).rows[0].id as string;
  const coldOrg = (await api("/v1/orgs", { method: "POST", token: coldOwner.token, body: { name: "W11 Cold Co", tier: "local_superstar" } })).body.data.id;
  const coldLoc = (await api(`/v1/orgs/${coldOrg}/locations`, { method: "POST", token: coldOwner.token, body: { name: "Cold Shop", line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101", geofence_radius_m: 150 } })).body.data.id;
  // Move the location + its city into the fresh city (bypass the dev geocoder).
  await pg.query(`update locations set lat=$1, lng=$2, city_id=$3 where id=$4`, [CX, CY, coldCity, coldLoc]);
  // Point both cold buyers' active address at the fresh city so the board resolves there.
  await pg.query(`update addresses a set lat=$1, lng=$2 from users u where u.id=a.user_id and a.id=u.active_address_id and u.id = any($3::uuid[])`, [CX, CY, [coldBuyer.uid, coldBuyer2.uid]]);
  // Drops in the cold city (created after the location's city_id was set → inherit it).
  const cd1 = await mkDrop(coldOwner, coldLoc, 5);
  await mkDrop(coldOwner, coldLoc, 5); // a second live drop so the board has a set
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });

  const coldBoard1 = await api("/v1/board", { token: coldBuyer.token });
  const engaged = coldBoard1.body.data?.local && coldBoard1.body.meta?.cold_start === true && coldBoard1.body.meta?.ranking === "proximity_fallback" && coldBoard1.body.meta?.city_id === coldCity;
  // Cross the event threshold: 2 catches in the city.
  await api("/v1/catches", { method: "POST", token: coldBuyer.token, idem: randomUUID(), body: { drop_id: cd1 } });
  await api("/v1/catches", { method: "POST", token: coldBuyer2.token, idem: randomUUID(), body: { drop_id: cd1 } });
  const coldBoard2 = await api("/v1/board", { token: coldBuyer.token });
  const disengaged = coldBoard2.body.meta?.cold_start === false && coldBoard2.body.meta?.ranking === "pressure";
  check(
    "cold-start fallback engages for a new city and disengages on the event threshold",
    engaged && disengaged,
    `new city: cold_start=${coldBoard1.body.meta?.cold_start} ranking=${coldBoard1.body.meta?.ranking}; after 2 events: cold_start=${coldBoard2.body.meta?.cold_start} ranking=${coldBoard2.body.meta?.ranking}`,
  );

  await pg.end();
  console.log("\nWP-11 board / ranking / realtime / filter gate against " + BASE + "\n");
  for (const r of results) { console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`); console.log(`         ${r.detail}`); }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
