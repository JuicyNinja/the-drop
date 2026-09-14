/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

// Upstash creds (from .env.local) so the gate can read the seeded inventory.
function envLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
  } catch { /* ignore */ }
  return out;
}
const UP = envLocal();
async function redisGet(key: string): Promise<string | null> {
  const res = await fetch(`${UP.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, { headers: { authorization: `Bearer ${UP.UPSTASH_REDIS_REST_TOKEN}` } });
  const j = (await res.json()) as { result: string | null };
  return j.result;
}

/** WP-6 acceptance gate against a running dev server + local Postgres. */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

async function api(path: string, opts: { method?: string; body?: unknown; token?: string; idem?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers["idempotency-key"] = opts.idem;
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
  const reg = await api("/v1/auth/register/complete", { method: "POST", token, body: { full_name: "Gate", handle, phone: `+1801${Math.floor(1000000 + Math.random() * 8999999)}`, address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" } } });
  if (reg.status !== 200) throw new Error(`register ${email}: ${JSON.stringify(reg.body)}`);
  return { token, uid: subOf(token) };
}

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const stamp = Date.now();
  const adminToken = await sessionFor("info@juicyninja.com");
  const owner = await register(`wp6_${stamp}@example.test`, `wp6o${stamp % 100000}`);

  const window = () => ({ live_at: iso(-2000), live_until: iso(864e5), redeem_from: iso(36e5), redeem_until: iso(72e5) });
  const dropRow = async (id: string) => (await pg.query(`select status, quantity_total, quantity_remaining, parent_drop_id, duplicated_from_id from drops where id=$1`, [id])).rows[0];
  const usedFor = async (orgId: string) => Number((await pg.query(`select coalesce(sum(drops_used),0)::int n from drop_allowance_usage where org_id=$1`, [orgId])).rows[0].n);
  const tick = async () => api("/v1/admin/scheduler/tick", { method: "POST", token: adminToken });

  // Big org (admin/enterprise, generous limits) for the non-cap scenarios.
  const orgBig = (await api("/v1/orgs", { method: "POST", token: adminToken, body: { name: "Big Co", tier: "local_enterprise", max_locations: 5, drops_per_cycle: 50, drops_pooled_org_level: false } })).body.data.id as string;
  const locBig = (await api(`/v1/orgs/${orgBig}/locations`, { method: "POST", token: adminToken, body: { name: "Big Shop", line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101" } })).body.data.id as string;

  const makeDrop = async (token: string, loc: string, publish: boolean) =>
    api("/v1/drops", { method: "POST", token, body: { location_id: loc, title: "Gate Drop", description: "d", quantity_total: 5, ...window(), publish } });

  // ========================================================================
  // GATE 1 — PATCH on a live drop returns DROP_IMMUTABLE.
  // ========================================================================
  const dImm = (await makeDrop(adminToken, locBig, true)).body.data.id as string;
  await tick(); // live_at is in the past → goes live
  const immLive = (await dropRow(dImm)).status;
  const patchLive = await api(`/v1/drops/${dImm}`, { method: "PATCH", token: adminToken, body: { title: "changed while live" } });
  check("1. PATCH on a live drop → DROP_IMMUTABLE", immLive === "live" && patchLive.status === 409 && patchLive.body.error?.code === "DROP_IMMUTABLE", `wentLive=${immLive}; patch=${patchLive.status} ${JSON.stringify(patchLive.body.error ?? patchLive.body)}`);

  // ========================================================================
  // GATE 2 — a Local drop can never enter submitted or approved.
  // ========================================================================
  const dLoc = (await makeDrop(adminToken, locBig, false)).body.data.id as string; // draft
  let subErr = "", appErr = "";
  try { await pg.query(`update drops set status='submitted' where id=$1`, [dLoc]); } catch (e: any) { subErr = e.message; }
  try { await pg.query(`update drops set status='approved' where id=$1`, [dLoc]); } catch (e: any) { appErr = e.message; }
  const apiSubmit = await api(`/v1/drops/${dLoc}`, { method: "PATCH", token: adminToken, body: { status: "submitted" } });
  check("2. Local drop cannot enter submitted/approved (DB trigger + API reject)", /Local drops never enter submitted/i.test(subErr) && /Local drops never enter approved/i.test(appErr) && apiSubmit.status === 422, `db.submitted="${subErr.slice(0, 60)}"; db.approved="${appErr.slice(0, 60)}"; api=${apiSubmit.status}`);

  // ========================================================================
  // GATE 3 — encore is the only add-supply path; parent quantity untouched.
  // ========================================================================
  const dEnc = (await makeDrop(adminToken, locBig, true)).body.data.id as string;
  await tick(); // live
  await pg.query(`update drops set quantity_remaining=0 where id=$1`, [dEnc]); // sell-out (decrease allowed)
  await tick(); // close → gone
  const parentBefore = await dropRow(dEnc);
  const encore = await api(`/v1/drops/${dEnc}/encore`, { method: "POST", token: adminToken });
  const newDrop = encore.body.data;
  const parentAfter = await dropRow(dEnc);
  check("3. encore from Gone creates a linked drop (parent_drop_id set), parent quantity untouched",
    parentBefore.status === "gone" && encore.status === 201 && newDrop?.parent_drop_id === dEnc && newDrop?.status === "draft" && Number(newDrop?.quantity_total) === Number(parentBefore.quantity_total) &&
    Number(parentAfter.quantity_total) === Number(parentBefore.quantity_total) && Number(parentAfter.quantity_remaining) === 0 && parentAfter.status === "encore_pending",
    `parent gone→${parentAfter.status}; new.parent=${newDrop?.parent_drop_id === dEnc}; new.qty=${newDrop?.quantity_total} vs parent ${parentBefore.quantity_total}; parent.remaining=${parentAfter.quantity_remaining}`);
  const encoreFromLive = await api(`/v1/drops/${dImm}/encore`, { method: "POST", token: adminToken });
  check("3. encore is rejected for a non-Gone drop", encoreFromLive.status === 422, `${encoreFromLive.status} ${JSON.stringify(encoreFromLive.body.error ?? encoreFromLive.body)}`);

  // Duplicate: new draft, no allowance consumed by the duplicate itself.
  const usedBeforeDup = await usedFor(orgBig);
  const dup = await api(`/v1/drops/${dImm}/duplicate`, { method: "POST", token: adminToken });
  const usedAfterDup = await usedFor(orgBig);
  check("duplicate creates a new draft (duplicated_from set) and consumes no allowance", dup.status === 201 && dup.body.data?.duplicated_from_id === dImm && dup.body.data?.status === "draft" && usedAfterDup === usedBeforeDup, `dup=${dup.status} from=${dup.body.data?.duplicated_from_id === dImm} used ${usedBeforeDup}→${usedAfterDup}`);

  // ========================================================================
  // GATE 4/5 — cancel does not restore allowance; upgrade unblocks at cap.
  // Fresh self-serve starter org (owner), 1 location, 2 drops/cycle.
  // ========================================================================
  const orgCap = (await api("/v1/orgs", { method: "POST", token: owner.token, body: { name: "Cap Co", tier: "local_starter" } })).body.data.id as string;
  const locCap = (await api(`/v1/orgs/${orgCap}/locations`, { method: "POST", token: owner.token, body: { name: "Cap Shop", line1: "2 Main", city: "Salt Lake City", region: "UT", postal_code: "84101" } })).body.data.id as string;

  const dc1 = (await makeDrop(owner.token, locCap, false)).body.data.id as string;
  await api(`/v1/drops/${dc1}`, { method: "PATCH", token: owner.token, body: { status: "scheduled" } }); // used=1
  const usedAfterSchedule = await usedFor(orgCap);
  await api(`/v1/drops/${dc1}`, { method: "PATCH", token: owner.token, body: { status: "draft" } }); // cancel
  const usedAfterCancel = await usedFor(orgCap);
  check("4. create-then-cancel does NOT restore allowance", usedAfterSchedule === 1 && usedAfterCancel === 1, `used after schedule=${usedAfterSchedule}, after cancel=${usedAfterCancel}`);

  const dc2 = (await makeDrop(owner.token, locCap, false)).body.data.id as string;
  await api(`/v1/drops/${dc2}`, { method: "PATCH", token: owner.token, body: { status: "scheduled" } }); // used=2 (cap)
  const dc3 = (await makeDrop(owner.token, locCap, false)).body.data.id as string;
  const capped = await api(`/v1/drops/${dc3}`, { method: "PATCH", token: owner.token, body: { status: "scheduled" } });
  check("5. scheduling at cap → 402 ALLOWANCE_EXHAUSTED with upgrade options", capped.status === 402 && capped.body.error?.code === "ALLOWANCE_EXHAUSTED" && capped.body.error?.details?.drops_per_cycle === 2 && (capped.body.error?.details?.upgrade_options?.length ?? 0) > 0, `${capped.status} ${JSON.stringify(capped.body.error?.details)}`);

  const idem = randomUUID();
  const up1 = await api(`/v1/orgs/${orgCap}/subscription/upgrade`, { method: "POST", token: owner.token, idem, body: { target_tier: "local_limited" } });
  const up2 = await api(`/v1/orgs/${orgCap}/subscription/upgrade`, { method: "POST", token: owner.token, idem, body: { target_tier: "local_limited" } }); // replay
  const orgAfter = (await pg.query(`select tier, drops_per_cycle from organizations where id=$1`, [orgCap])).rows[0];
  const afterUpgradeSchedule = await api(`/v1/drops/${dc3}`, { method: "PATCH", token: owner.token, body: { status: "scheduled" } });
  check("4/5. upgrade is prorated, idempotent, and unblocks scheduling in the same cycle",
    up1.status === 200 && up1.body.data?.charged_cents > 0 && up1.body.data?.new_tier === "local_limited" &&
    up2.status === 200 && up2.body.data?.subscription_id === up1.body.data?.subscription_id &&
    orgAfter.tier === "local_limited" && Number(orgAfter.drops_per_cycle) === 8 &&
    afterUpgradeSchedule.status === 200,
    `up1=${up1.status} charged=${up1.body.data?.charged_cents}; replay same sub=${up2.body.data?.subscription_id === up1.body.data?.subscription_id}; org=${orgAfter.tier}/${orgAfter.drops_per_cycle}; reschedule=${afterUpgradeSchedule.status}`);

  // Enterprise limits are untouched by the catalog (arbitrary stored values).
  check("Enterprise stored limits are not derived from the catalog", (await pg.query(`select max_locations, drops_per_cycle from organizations where id=$1`, [orgBig])).rows[0].drops_per_cycle === 50, `orgBig drops_per_cycle=${(await pg.query(`select drops_per_cycle from organizations where id=$1`, [orgBig])).rows[0].drops_per_cycle}`);

  // NOT_IMPLEMENTED is gone from POST /v1/drops.
  const postDrop = await makeDrop(adminToken, locBig, false);
  check("POST /v1/drops no longer returns NOT_IMPLEMENTED (the WP-5 shell is gone)", postDrop.status === 201, `${postDrop.status} ${JSON.stringify(postDrop.body.error ?? "ok")}`);

  // Scheduler concurrency: two tickers firing at once must transition a drop
  // once and seed Redis inventory once (WP-13/deployment safety).
  const dCon = (await makeDrop(adminToken, locBig, true)).body.data.id as string; // scheduled, live_at past
  const [t1, t2] = await Promise.all([tick(), tick()]);
  const appearances = [t1, t2].filter((t) => (t.body.data?.went_live ?? []).includes(dCon)).length;
  const inv = await redisGet(`drop:${dCon}:inventory`);
  check("concurrent tickers transition a drop exactly once and seed inventory once",
    appearances === 1 && (await dropRow(dCon)).status === "live" && Number(inv) === 5,
    `went_live appearances across 2 concurrent ticks=${appearances}; status=${(await dropRow(dCon)).status}; redis inventory=${inv} (quantity_total=5)`);

  await pg.end();
  console.log("\nWP-6 acceptance gate against " + BASE + "\n");
  for (const r of results) { console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`); console.log(`         ${r.detail}`); }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
