/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { Client } from "pg";

/**
 * WP-5 acceptance gate against a running dev server + local Postgres.
 * Drop-allowance consumption is exercised through the same DB function the
 * app uses (app_consume_drop_allowance), with the limit read from the org row —
 * proving enforcement follows stored numbers, not the tier enum.
 */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };
const CYCLE_MS = 30 * 24 * 60 * 60 * 1000;

async function api(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep */ }
  return { status: res.status, body };
}

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });
const subOf = (t: string) => JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8")).sub as string;

async function sessionFor(email: string): Promise<string> {
  const start = await api("/v1/auth/oauth/start", { method: "POST", body: { provider: "google", return_to: "/" } });
  const cb = await api("/v1/auth/oauth/callback", { method: "POST", body: { code: `dev-code:${email}`, state: start.body.data.state } });
  if (cb.status !== 200) throw new Error(`callback ${email}: ${JSON.stringify(cb.body)}`);
  return cb.body.data.session.access_token as string;
}

async function register(email: string, handle: string): Promise<{ token: string; uid: string }> {
  const token = await sessionFor(email);
  const reg = await api("/v1/auth/register/complete", {
    method: "POST", token,
    body: { full_name: "Gate", handle, phone: `+1801${Math.floor(1000000 + Math.random() * 8999999)}`, address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" } },
  });
  if (reg.status !== 200) throw new Error(`register ${email}: ${JSON.stringify(reg.body)}`);
  return { token, uid: subOf(token) };
}

function currentCycle(anchorISO: string): { start: string; end: string } {
  const a = new Date(anchorISO).getTime();
  const n = Math.max(0, Math.floor((Date.now() - a) / CYCLE_MS));
  const s = a + n * CYCLE_MS;
  return { start: new Date(s).toISOString(), end: new Date(s + CYCLE_MS).toISOString() };
}

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const stamp = Date.now();
  const founder = (await pg.query(`select id from users where user_number=1`)).rows[0].id as string;

  const consume = async (orgId: string, loc: string | null, anchor: string, limit: number): Promise<number> => {
    const c = currentCycle(anchor);
    const r = await pg.query(`select app_consume_drop_allowance($1,$2,$3,$4,$5) as used`, [orgId, loc, c.start, c.end, limit]);
    return r.rows[0].used as number;
  };
  const orgRow = async (id: string) => (await pg.query(`select tier, max_locations, drops_per_cycle, drops_pooled_org_level, cycle_anchor_at from organizations where id=$1`, [id])).rows[0];

  // ---- actors ----
  const owner = await register(`wp5_owner_${stamp}@example.test`, `wp5own${stamp % 100000}`);
  const staff = await register(`wp5_staff_${stamp}@example.test`, `wp5stf${stamp % 100000}`);
  const adminToken = await sessionFor("info@juicyninja.com");

  // ---- owner creates a self-serve org + a location, adds staff scoped to it ----
  const orgResp = await api("/v1/orgs", { method: "POST", token: owner.token, body: { name: "Owner Co", tier: "local_starter" } });
  if (orgResp.status !== 201) throw new Error(`create org: ${JSON.stringify(orgResp.body)}`);
  const orgA = orgResp.body.data.id as string;
  const locResp = await api(`/v1/orgs/${orgA}/locations`, { method: "POST", token: owner.token, body: { name: "Shop", line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101", geofence_radius_m: 200 } });
  const locA = locResp.body.data.id as string;
  check("location created, geocoded server-side, geofence stored", locResp.status === 201 && typeof locResp.body.data.lat === "number" && locResp.body.data.geofence_radius_m === 200, `${locResp.status} lat=${locResp.body.data?.lat} geofence=${locResp.body.data?.geofence_radius_m}`);
  const addStaff = await api(`/v1/orgs/${orgA}/staff`, { method: "POST", token: owner.token, body: { user_id: staff.uid, location_id: locA } });
  check("owner can add a staff seat scoped to a location", addStaff.status === 201, `${addStaff.status} ${JSON.stringify(addStaff.body.data ?? addStaff.body)}`);

  // seed a live drop under locA for the stats check
  const dropId = (await pg.query(`insert into drops (lane,org_id,location_id,title,description,quantity_total,quantity_remaining,redeem_from,redeem_until,created_by,status) values ('local',$1,$2,'Gate Drop','x',10,10,now(),now()+interval '1 day',$3,'draft') returning id`, [orgA, locA, founder])).rows[0].id as string;

  // ========================================================================
  // GATE 1 — merchant_staff receives 403 on drop creation, billing, and stats.
  // ========================================================================
  const sDrop = await api("/v1/drops", { method: "POST", token: staff.token, body: { location_id: locA } });
  const sBilling = await api(`/v1/orgs/${orgA}/billing`, { token: staff.token });
  const sStats = await api(`/v1/drops/${dropId}/stats`, { token: staff.token });
  check("1. staff → 403 on POST /v1/drops (drop creation)", sDrop.status === 403 && sDrop.body.error?.code === "FORBIDDEN", `${sDrop.status} ${JSON.stringify(sDrop.body.error ?? sDrop.body)}`);
  check("1. staff → 403 on GET /v1/orgs/{id}/billing", sBilling.status === 403 && sBilling.body.error?.code === "FORBIDDEN", `${sBilling.status} ${JSON.stringify(sBilling.body.error ?? sBilling.body)}`);
  check("1. staff → 403 on GET /v1/drops/{id}/stats", sStats.status === 403 && sStats.body.error?.code === "FORBIDDEN", `${sStats.status} ${JSON.stringify(sStats.body.error ?? sStats.body)}`);
  // owner passes the gate (reaches the WP-6/WP-13 boundary; billing is real)
  const oDrop = await api("/v1/drops", { method: "POST", token: owner.token, body: { location_id: locA } });
  const oBilling = await api(`/v1/orgs/${orgA}/billing`, { token: owner.token });
  const oStats = await api(`/v1/drops/${dropId}/stats`, { token: owner.token });
  check("1. owner passes: drop=501, billing=200, stats=501", oDrop.status === 501 && oBilling.status === 200 && oStats.status === 501, `drop=${oDrop.status} billing=${oBilling.status} stats=${oStats.status}`);

  // ========================================================================
  // GATE 2 — limits read from the org row, never the tier enum.
  // Enterprise with arbitrary values: 3 locations, 37 drops.
  // ========================================================================
  const entResp = await api("/v1/orgs", { method: "POST", token: adminToken, body: { name: "Enterprise Co", tier: "local_enterprise", max_locations: 3, drops_per_cycle: 37, drops_pooled_org_level: true } });
  check("2. enterprise created by admin with arbitrary stored limits (3 loc, 37 drops)", entResp.status === 201 && entResp.body.data.max_locations === 3 && entResp.body.data.drops_per_cycle === 37, `${entResp.status} max_loc=${entResp.body.data?.max_locations} drops=${entResp.body.data?.drops_per_cycle} tier=${entResp.body.data?.tier}`);
  const orgE = entResp.body.data.id as string;
  const entLocs: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await api(`/v1/orgs/${orgE}/locations`, { method: "POST", token: adminToken, body: { name: `Loc ${i}`, line1: `${i} Main`, city: "Salt Lake City", region: "UT", postal_code: "84101" } });
    if (r.status === 201) entLocs.push(r.body.data.id);
  }
  const fourth = await api(`/v1/orgs/${orgE}/locations`, { method: "POST", token: adminToken, body: { name: "Loc 4", line1: "4 Main", city: "Salt Lake City", region: "UT", postal_code: "84101" } });
  check("2. 3 locations accepted, 4th → 402 with stored max_locations=3", entLocs.length === 3 && fourth.status === 402 && fourth.body.error?.details?.max_locations === 3 && fourth.body.error?.details?.current_tier === "local_enterprise", `added=${entLocs.length}; 4th=${fourth.status} details=${JSON.stringify(fourth.body.error?.details)}`);

  // Drop allowance follows the stored 37 (pooled/org-wide), not any tier default.
  const eAnchor = (await orgRow(orgE)).cycle_anchor_at as string;
  let lastUsed = 0; let capHit = -99;
  for (let i = 1; i <= 37; i++) lastUsed = await consume(orgE, null, eAnchor, 37);
  capHit = await consume(orgE, null, eAnchor, 37);
  check("2. drop allowance caps at the stored 37 (org-wide), 38th rejected", lastUsed === 37 && capHit === -1, `used@37=${lastUsed}; 38th=${capHit}`);

  // ========================================================================
  // GATE 3 — pooled vs per-location, one multi-location org, switching the flag.
  // ========================================================================
  const poolResp = await api("/v1/orgs", { method: "POST", token: adminToken, body: { name: "Pool Co", tier: "local_enterprise", max_locations: 2, drops_per_cycle: 3, drops_pooled_org_level: true } });
  const orgP = poolResp.body.data.id as string;
  const pAnchor = (await orgRow(orgP)).cycle_anchor_at as string;
  const L1 = (await api(`/v1/orgs/${orgP}/locations`, { method: "POST", token: adminToken, body: { name: "P L1", line1: "1 A", city: "Salt Lake City", region: "UT", postal_code: "84101" } })).body.data.id as string;
  const L2 = (await api(`/v1/orgs/${orgP}/locations`, { method: "POST", token: adminToken, body: { name: "P L2", line1: "2 A", city: "Provo", region: "UT", postal_code: "84601" } })).body.data.id as string;

  // pooled=true: the allowance is one org-wide pool of 3 across L1+L2.
  const p1 = await consume(orgP, null, pAnchor, 3); // scope null (pooled)
  const p2 = await consume(orgP, null, pAnchor, 3);
  const p3 = await consume(orgP, null, pAnchor, 3);
  const p4 = await consume(orgP, null, pAnchor, 3);
  check("3. pooled=true: 3 drops org-wide across locations, 4th anywhere → cap", p1 === 1 && p2 === 2 && p3 === 3 && p4 === -1, `used=[${p1},${p2},${p3}] 4th=${p4}`);

  // flip the flag → per-location: each location has its own fresh pool of 3.
  await pg.query(`update organizations set drops_pooled_org_level=false where id=$1`, [orgP]);
  const a1 = await consume(orgP, L1, pAnchor, 3);
  const a2 = await consume(orgP, L1, pAnchor, 3);
  const a3 = await consume(orgP, L1, pAnchor, 3);
  const a4 = await consume(orgP, L1, pAnchor, 3); // L1 at cap
  const b1 = await consume(orgP, L2, pAnchor, 3); // L2 independent, still open
  check("3. per-location (flag off): L1 caps at 3 while L2 counts independently", a1 === 1 && a2 === 2 && a3 === 3 && a4 === -1 && b1 === 1, `L1=[${a1},${a2},${a3}] L1#4=${a4} L2#1=${b1}`);

  await pg.end();
  console.log("\nWP-5 acceptance gate against " + BASE + "\n");
  for (const r of results) { console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`); console.log(`         ${r.detail}`); }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
