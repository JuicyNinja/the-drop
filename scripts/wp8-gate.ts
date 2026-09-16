/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { randomUUID } from "node:crypto";
import { Client } from "pg";

/** WP-8 redemption gate against a running dev server + local Postgres. */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };
const SLC = { lat: 40.7608, lng: -111.891 };
const NYC = { lat: 40.758, lng: -73.9855 };

async function api(path: string, opts: { method?: string; body?: unknown; token?: string; idem?: string } = {}): Promise<{ status: number; body: any; raw: string; ct: string }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  const res = await fetch(`${BASE}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const raw = await res.text();
  let body: any = raw; try { body = JSON.parse(raw); } catch { /* keep */ }
  return { status: res.status, body, raw, ct: res.headers.get("content-type") ?? "" };
}
const subOf = (t: string) => JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8")).sub as string;
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });

async function session(email: string): Promise<string> {
  const s = await api("/v1/auth/oauth/start", { method: "POST", body: { provider: "google", return_to: "/" } });
  const c = await api("/v1/auth/oauth/callback", { method: "POST", body: { code: `dev-code:${email}`, state: s.body.data.state } });
  return c.body.data.session.access_token;
}
async function register(email: string, handle: string, grantLoc = true): Promise<{ token: string; uid: string; handle: string }> {
  const token = await session(email);
  await api("/v1/auth/register/complete", { method: "POST", token, body: { full_name: "U", handle, phone: `+1801${Math.floor(1000000 + Math.random() * 8999999)}`, address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" } } });
  if (grantLoc) await api("/v1/users/me/location-permission", { method: "POST", token, body: { granted: true } });
  return { token, uid: subOf(token), handle };
}
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const stamp = Date.now();

  const admin = await session("info@juicyninja.com");
  const owner = await register(`w8own_${stamp}@t.test`, `w8o${stamp % 100000}`);
  const buyer = await register(`w8buy_${stamp}@t.test`, `w8b${stamp % 100000}`);
  const staff = await register(`w8stf_${stamp}@t.test`, `w8s${stamp % 100000}`);
  // Since WP-3's phone gate, catching requires a verified phone. Phone verify is
  // proven end-to-end in wp3-gate; here it is a precondition, set directly.
  await pg.query(`update users set phone_verified_at = now() where id = any($1::uuid[])`, [[owner.uid, buyer.uid, staff.uid]]);

  const org = (await api("/v1/orgs", { method: "POST", token: owner.token, body: { name: "W8 Co", tier: "local_superstar" } })).body.data.id;
  const loc = (await api(`/v1/orgs/${org}/locations`, { method: "POST", token: owner.token, body: { name: "Shop", line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101", geofence_radius_m: 150 } })).body.data.id;
  await api(`/v1/orgs/${org}/staff`, { method: "POST", token: owner.token, body: { to_handle: staff.handle, location_id: loc } });
  // Locations are geocoded to SLC by the dev geocoder; set exact coords for a
  // deterministic geofence test.
  await pg.query(`update locations set lat=$1, lng=$2 where id=$3`, [SLC.lat, SLC.lng, loc]);

  async function liveDrop(qty: number): Promise<string> {
    const d = (await api("/v1/drops", { method: "POST", token: owner.token, body: { location_id: loc, title: "Redeem Me", description: "d", quantity_total: qty, live_at: iso(-2000), live_until: iso(864e5), redeem_from: iso(-1000), redeem_until: iso(864e5), publish: true } })).body.data;
    return d.id;
  }
  async function catchDropHttp(dropId: string): Promise<{ catchId: string; code: string }> {
    const r = await api("/v1/catches", { method: "POST", token: buyer.token, idem: `c-${dropId}-${stamp}`, body: { drop_id: dropId } });
    return { catchId: r.body.data.catch_id, code: r.body.data.code };
  }

  // Create 7 drops (1 geofence drop + 6 for the rate-limit sequence), one tick.
  const dGeo = await liveDrop(5);
  const dRate: string[] = [];
  for (let i = 0; i < 6; i++) dRate.push(await liveDrop(1));
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin }); // go-live → codes generated

  const geo = await catchDropHttp(dGeo);

  // ========================================================================
  // GATE 1 — permission_denied → LOCATION_PERMISSION_REQUIRED, never redeems.
  // ========================================================================
  const rowsBefore = Number((await pg.query(`select count(*)::int n from redemptions where user_id=$1`, [buyer.uid])).rows[0].n);
  const denied = await api("/v1/redemptions", { method: "POST", token: buyer.token, idem: randomUUID(), body: { catch_id: geo.catchId, code: geo.code, gps_status: "permission_denied" } });
  const rowsAfter = Number((await pg.query(`select count(*)::int n from redemptions where user_id=$1`, [buyer.uid])).rows[0].n);
  check("1. permission_denied → LOCATION_PERMISSION_REQUIRED and NEVER redeems (bypass test)", denied.status === 403 && denied.body.error?.code === "LOCATION_PERMISSION_REQUIRED" && rowsAfter === rowsBefore, `${denied.status} ${denied.body.error?.code}; redemption rows ${rowsBefore}→${rowsAfter}`);

  // ========================================================================
  // GATE 4 — fix_acquired outside geofence → OUTSIDE_GEOFENCE.
  // ========================================================================
  const outside = await api("/v1/redemptions", { method: "POST", token: buyer.token, idem: randomUUID(), body: { catch_id: geo.catchId, code: geo.code, location: { ...NYC, accuracy_m: 10 }, gps_status: "fix_acquired" } });
  check("4. fix_acquired outside geofence (good fix) → OUTSIDE_GEOFENCE", outside.status === 409 && outside.body.error?.code === "OUTSIDE_GEOFENCE", `${outside.status} ${outside.body.error?.code}`);
  const badAcc = await api("/v1/redemptions", { method: "POST", token: buyer.token, idem: randomUUID(), body: { catch_id: geo.catchId, code: geo.code, location: { ...SLC, accuracy_m: 250 }, gps_status: "fix_acquired" } });
  check("fix_acquired with accuracy worse than the floor → GPS_ACCURACY_INSUFFICIENT", badAcc.status === 422 && badAcc.body.error?.code === "GPS_ACCURACY_INSUFFICIENT", `${badAcc.status} ${badAcc.body.error?.code}`);

  // Successful verified redemption (inside geofence, good accuracy).
  const verified = await api("/v1/redemptions", { method: "POST", token: buyer.token, idem: randomUUID(), body: { catch_id: geo.catchId, code: geo.code, location: { ...SLC, accuracy_m: 8 }, gps_status: "fix_acquired" } });
  const verifiedRow = (await pg.query(`select method, velocity_flagged from redemptions where id=$1`, [verified.body.data?.redemption_id])).rows[0];
  const cloutRow = (await pg.query(`select points, source from clout_events where ref_id=$1`, [verified.body.data?.redemption_id])).rows[0];
  check("verified redemption → 201, method gps_verified (in DB), clout recorded", verified.status === 201 && verifiedRow?.method === "gps_verified" && Number(cloutRow?.points) > 0 && cloutRow?.source === "redemption", `${verified.status}; db method=${verifiedRow?.method}; clout=${cloutRow?.points}`);

  // ========================================================================
  // GATE 6 (buyer-facing) — the unverified flag never appears in a response.
  // GATE 2 — no_fix_timeout redeems and records unverified_timeout.
  // GATE 3 — the 6th no_fix_timeout in 30 days → RATE_LIMITED.
  // ========================================================================
  const catches = await Promise.all(dRate.map((d) => catchDropHttp(d)));
  const timeoutResponses: any[] = [];
  for (let i = 0; i < 5; i++) {
    timeoutResponses.push(await api("/v1/redemptions", { method: "POST", token: buyer.token, idem: randomUUID(), body: { catch_id: catches[i].catchId, code: catches[i].code, gps_status: "no_fix_timeout" } }));
  }
  const sixth = await api("/v1/redemptions", { method: "POST", token: buyer.token, idem: randomUUID(), body: { catch_id: catches[5].catchId, code: catches[5].code, gps_status: "no_fix_timeout" } });

  const firstTimeoutRow = (await pg.query(`select method from redemptions where id=$1`, [timeoutResponses[0].body.data?.redemption_id])).rows[0];
  const timeoutClout = (await pg.query(`select points from clout_events where ref_id=$1`, [timeoutResponses[0].body.data?.redemption_id])).rows[0];
  check("2. no_fix_timeout → 201 and records unverified_timeout (DB)", timeoutResponses[0].status === 201 && firstTimeoutRow?.method === "unverified_timeout", `${timeoutResponses[0].status}; db method=${firstTimeoutRow?.method}`);
  check("unverified auto-redeem still earns clout (deliberate)", Number(timeoutClout?.points) > 0, `clout points=${timeoutClout?.points}`);
  check("3. sixth no_fix_timeout in 30 days → RATE_LIMITED", sixth.status === 429 && sixth.body.error?.code === "RATE_LIMITED", `${sixth.status} ${sixth.body.error?.code}`);

  // 6. unverified flag never in any buyer-facing response (verified + timeout).
  const allBuyerResponses = [verified, ...timeoutResponses];
  const leak = allBuyerResponses.find((r) => /method|unverified|gps_verified|unverified_timeout/i.test(r.raw));
  check("6. unverified flag never appears in any buyer-facing response", !leak, leak ? `LEAK in: ${leak.raw.slice(0, 120)}` : "no method/unverified field in any redemption response body");

  // A fresh idempotency key does NOT bypass the rate limit (server-side count).
  const bypassTry = await api("/v1/redemptions", { method: "POST", token: buyer.token, idem: randomUUID(), body: { catch_id: catches[5].catchId, code: catches[5].code, gps_status: "no_fix_timeout" } });
  check("rate limit is server-side: a new Idempotency-Key does not reset it", bypassTry.status === 429, `${bypassTry.status} ${bypassTry.body.error?.code}`);

  // ========================================================================
  // Today's Code (merchant, staff) — feed marks unverified; PDF renders.
  // ========================================================================
  const today = await api(`/v1/locations/${loc}/today`, { token: staff.token });
  const hasUnverifiedInFeed = (today.body.data?.feed ?? []).some((f: any) => f.unverified === true);
  const hasPhonetic = (today.body.data?.codes ?? []).some((c: any) => typeof c.phonetic === "string" && c.phonetic.length > 0);
  check("Today's Code (staff): codes with phonetic guidance + feed marks unverified", today.status === 200 && hasPhonetic && hasUnverifiedInFeed, `${today.status}; phonetic=${hasPhonetic}; unverifiedInFeed=${hasUnverifiedInFeed}`);
  const pdf = await fetch(`${BASE}/v1/locations/${loc}/code-sheet.pdf`, { headers: { authorization: `Bearer ${staff.token}` } });
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  check("printable code sheet PDF renders", pdf.status === 200 && (pdf.headers.get("content-type") ?? "").includes("application/pdf") && pdfBuf.slice(0, 5).toString() === "%PDF-", `${pdf.status} ${pdf.headers.get("content-type")} bytes=${pdfBuf.length} magic=${pdfBuf.slice(0,5).toString()}`);

  // A non-staff, non-owner buyer cannot read Today's Code.
  const buyerToday = await api(`/v1/locations/${loc}/today`, { token: buyer.token });
  check("Today's Code is not readable by an unrelated buyer", buyerToday.status === 403, `${buyerToday.status} ${buyerToday.body.error?.code}`);

  await pg.end();
  console.log("\nWP-8 redemption gate against " + BASE + "\n");
  for (const r of results) { console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`); console.log(`         ${r.detail}`); }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
