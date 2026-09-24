/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * WP-10 clout / badges / whispers / shares / merchant-score gate. Drives the real
 * HTTP API on a running dev server plus local Postgres. No endpoint is stubbed
 * and no result is asserted without the actual value printed.
 *
 * The whisper-visibility item is verified by RLS ACROSS ROLES (not by reading
 * the code): each actor's read runs as role `authenticated` with that actor's JWT
 * claims, exactly as PostgREST would, and the check is what Postgres returns.
 */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

async function api(path: string, opts: { method?: string; body?: unknown; token?: string; idem?: string; redirect?: RequestRedirect } = {}): Promise<{ status: number; body: any; raw: string; location: string | null }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  const res = await fetch(`${BASE}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), redirect: opts.redirect ?? "follow" });
  const raw = await res.text();
  let body: any = raw; try { body = JSON.parse(raw); } catch { /* keep */ }
  return { status: res.status, body, raw, location: res.headers.get("location") };
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
async function register(email: string, handle: string): Promise<{ token: string; uid: string; handle: string }> {
  const token = await session(email);
  await api("/v1/auth/register/complete", { method: "POST", token, body: { full_name: `Name ${handle}`, handle, phone: `+1801${Math.floor(1000000 + Math.random() * 8999999)}`, address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" } } });
  await api("/v1/users/me/location-permission", { method: "POST", token, body: { granted: true } });
  return { token, uid: subOf(token), handle };
}

/** Read a whisper AS a given user, through RLS (role authenticated + JWT sub). */
async function whisperVisibleTo(pg: Client, uid: string, whisperId: string): Promise<number> {
  await pg.query("begin");
  try {
    await pg.query("set local role authenticated");
    await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const n = Number((await pg.query("select count(*)::int n from whispers where id=$1", [whisperId])).rows[0].n);
    return n;
  } finally {
    await pg.query("rollback");
  }
}

/** Recursively read every .ts file under a dir. */
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
  const founder = (await pg.query(`select id from users where user_number=1`)).rows[0].id as string;
  const O1 = await register(`w10o1_${stamp}@t.test`, `w10o1${stamp % 100000}`);
  const O2 = await register(`w10o2_${stamp}@t.test`, `w10o2${stamp % 100000}`);
  const A = await register(`w10a_${stamp}@t.test`, `w10a${stamp % 100000}`);
  const B = await register(`w10b_${stamp}@t.test`, `w10b${stamp % 100000}`);
  const S = await register(`w10s_${stamp}@t.test`, `w10s${stamp % 100000}`);
  // Catching requires a verified phone since WP-3's gate (proven in wp3-gate);
  // set it directly as a precondition for the accounts that catch here.
  await pg.query(`update users set phone_verified_at = now() where id = any($1::uuid[])`, [[O1.uid, O2.uid, A.uid, B.uid, S.uid]]);

  const org1 = (await api("/v1/orgs", { method: "POST", token: O1.token, body: { name: "W10 Co1", tier: "local_superstar" } })).body.data.id;
  const loc1 = (await api(`/v1/orgs/${org1}/locations`, { method: "POST", token: O1.token, body: { name: "Shop1", line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101", geofence_radius_m: 150 } })).body.data.id;
  await api(`/v1/orgs/${org1}/staff`, { method: "POST", token: O1.token, body: { to_handle: S.handle, location_id: loc1 } });
  await pg.query(`update locations set lat=40.7608, lng=-111.891 where id=$1`, [loc1]);
  const org2 = (await api("/v1/orgs", { method: "POST", token: O2.token, body: { name: "W10 Co2", tier: "local_starter" } })).body.data.id;

  // A live drop; A catches and redeems it, then whispers it.
  const drop = (await api("/v1/drops", { method: "POST", token: O1.token, body: { location_id: loc1, title: "Clout Drop", description: "d", quantity_total: 5, live_at: iso(-2000), live_until: iso(864e5), redeem_from: iso(-1000), redeem_until: iso(864e5), publish: true } })).body.data.id;
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
  const caught = await api("/v1/catches", { method: "POST", token: A.token, idem: randomUUID(), body: { drop_id: drop } });
  const redeem = await api("/v1/redemptions", { method: "POST", token: A.token, idem: randomUUID(), body: { catch_id: caught.body.data.catch_id, code: caught.body.data.code, gps_status: "no_fix_timeout" } });
  const redemptionId = redeem.body.data.redemption_id;

  // ========================================================================
  // Whisper flow: POST /v1/whispers earns clout; one per redemption.
  // ========================================================================
  const whisper = await api("/v1/whispers", { method: "POST", token: A.token, body: { redemption_id: redemptionId, would_return_at_full_price: true, dim_2: 5, dim_3: 4, dim_4: 5, note: "great" } });
  const whisperId = whisper.body.data?.id;
  check("POST /v1/whispers → 201 and earns clout", whisper.status === 201 && whisper.body.data?.clout_earned > 0, `${whisper.status}; clout=${whisper.body.data?.clout_earned}`);
  const dupWhisper = await api("/v1/whispers", { method: "POST", token: A.token, body: { redemption_id: redemptionId, would_return_at_full_price: false, dim_2: 1, dim_3: 1, dim_4: 1 } });
  check("a second whisper on the same redemption → VALIDATION_ERROR (one per redemption)", dupWhisper.status === 422 && dupWhisper.body.error?.code === "VALIDATION_ERROR", `${dupWhisper.status} ${dupWhisper.body.error?.code}`);

  // ========================================================================
  // GATE — a whisper is unreachable by any party other than author, owning org,
  // and admin. Verified by RLS across roles.
  // ========================================================================
  const vAuthor = await whisperVisibleTo(pg, A.uid, whisperId);
  const vOwner = await whisperVisibleTo(pg, O1.uid, whisperId);
  const vAdmin = await whisperVisibleTo(pg, founder, whisperId);
  const vOtherBuyer = await whisperVisibleTo(pg, B.uid, whisperId);
  const vOtherOwner = await whisperVisibleTo(pg, O2.uid, whisperId);
  const vStaff = await whisperVisibleTo(pg, S.uid, whisperId);
  check(
    "whisper visible ONLY to author + owning org + admin (RLS, across roles)",
    vAuthor === 1 && vOwner === 1 && vAdmin === 1 && vOtherBuyer === 0 && vOtherOwner === 0 && vStaff === 0,
    `author=${vAuthor} owner=${vOwner} admin=${vAdmin} | otherBuyer=${vOtherBuyer} otherOwner=${vOtherOwner} staff=${vStaff}`,
  );

  // GET /v1/orgs/{id}/whispers — owner + admin only (staff/other excluded).
  const wOwner = await api(`/v1/orgs/${org1}/whispers`, { token: O1.token });
  const wAdmin = await api(`/v1/orgs/${org1}/whispers`, { token: admin });
  const wStaff = await api(`/v1/orgs/${org1}/whispers`, { token: S.token });
  const wOther = await api(`/v1/orgs/${org1}/whispers`, { token: O2.token });
  const ownerSees = wOwner.status === 200 && (wOwner.body.data ?? []).some((w: any) => w.id === whisperId);
  check("GET /v1/orgs/{id}/whispers: owner 200+sees, admin 200, staff 403, other owner 403", ownerSees && wAdmin.status === 200 && wStaff.status === 403 && wOther.status === 403, `owner=${wOwner.status}(sees=${ownerSees}) admin=${wAdmin.status} staff=${wStaff.status} other=${wOther.status}`);

  // ========================================================================
  // GATE — no clout write path reachable from any client; no admin grant.
  // (grep-verified over the route tree.)
  // ========================================================================
  const apiFiles = walk(path.join(root, "app", "api"));
  const libFiles = walk(path.join(root, "lib"));
  const insertsCloutEvents = (f: string) => { const s = readFileSync(f, "utf8"); return /from\(\s*["']clout_events["']\s*\)/.test(s) && /\.insert\(/.test(s); };
  const apiWriters = apiFiles.filter(insertsCloutEvents).map((f) => path.relative(root, f));
  const libWriters = libFiles.filter(insertsCloutEvents).map((f) => path.relative(root, f));
  check("no route under app/api writes clout_events (no client-reachable clout write path)", apiWriters.length === 0, apiWriters.length ? `WRITERS: ${apiWriters.join(", ")}` : "zero route files insert clout_events");
  check("the only clout_events writer is lib/clout.ts (the three server-side sources)", libWriters.length === 1 && libWriters[0].replace(/\\/g, "/") === "lib/clout.ts", `writers: ${libWriters.join(", ") || "none"}`);
  const adminFiles = walk(path.join(root, "app", "api", "v1", "admin"));
  const adminGrant = adminFiles.filter(insertsCloutEvents).map((f) => path.relative(root, f));
  const cloutAdminRoutes = adminFiles.filter((f) => /clout/i.test(f)).map((f) => path.relative(root, f).replace(/\\/g, "/"));
  // The two legitimate admin clout operations are recompute (re-derives from the
  // ledger) and freeze (halts future accrual). Neither grants: the substantive
  // guard is that no admin file inserts clout_events at all (invariant #6).
  check("no admin clout grant endpoint exists (admin clout routes are recompute/freeze only, insert no clout_events)", adminGrant.length === 0 && cloutAdminRoutes.every((f) => /recompute|freeze/.test(f)), `admin clout routes: ${cloutAdminRoutes.join(", ")}; grant-writers: ${adminGrant.join(", ") || "none"}`);

  // ========================================================================
  // GATE — tier 5 population never exceeds 1%; requirement 2 (small-N behavior).
  // Seed two fresh cities directly in the ledger (isolated N).
  // ========================================================================
  async function seedCityWithClout(nUsers: number, tag: string): Promise<string> {
    const cityId = (await pg.query(`insert into cities (name, region, lat, lng, active) values ($1,'UT',40.76,-111.89,true) returning id`, [`W10 ${tag} ${stamp}`])).rows[0].id as string;
    // Bulk users + one clout event each, with varied ages so decay is non-trivial.
    await pg.query(
      `with ids as (select gen_random_uuid() id, g from generate_series(1,${nUsers}) g),
       au as (
         insert into auth.users (id, instance_id, aud, role, email, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token, created_at, updated_at)
         select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','w10${tag}${stamp}_'||g||'@t.test','','','','','','','','', now(), now() from ids returning id
       ),
       u as (
         insert into users (id, handle, full_name, email, phone, location_perm_granted_at)
         select ids.id, 'w10${tag}${stamp}u'||g, 'W10 '||g, 'w10${tag}${stamp}_'||g||'@t.test', 'W10${tag}${stamp}-'||g, now() from ids returning id
       )
       insert into clout_events (user_id, source, points, city_id, ref_type, ref_id, occurred_at)
       select u.id, 'redemption', 10 + (row_number() over ())::int % 40, $1, 'redemption', gen_random_uuid(),
              now() - ((row_number() over ()) % 45)::int * interval '1 day'
       from u`,
      [cityId],
    );
    return cityId;
  }
  const cityBig = await seedCityWithClout(150, "big");
  const citySmall = await seedCityWithClout(40, "small");

  const rc1 = await api("/v1/admin/clout/recompute", { method: "POST", token: admin });
  const tier5Big = Number((await pg.query(`select count(*)::int n from clout_scores where city_id=$1 and tier=5`, [cityBig])).rows[0].n);
  const nBig = Number((await pg.query(`select count(*)::int n from clout_scores where city_id=$1`, [cityBig])).rows[0].n);
  const tier5Small = Number((await pg.query(`select count(*)::int n from clout_scores where city_id=$1 and tier=5`, [citySmall])).rows[0].n);
  check("Tier 5 population ≤ 1% of a city's active users (150 users → floor(1.5)=1, 1/150 ≤ 0.01)", tier5Big === 1 && tier5Big / nBig <= 0.01, `recompute ok=${rc1.status}; tier5=${tier5Big}/${nBig} = ${(tier5Big / nBig).toFixed(4)}`);
  check("small-N: below 100 active users tier 5 is UNREACHABLE, not rounded up (40 users → 0)", tier5Small === 0, `city of 40 active users: tier5 count=${tier5Small}`);

  // ========================================================================
  // Requirement 3 — decay is deterministic and idempotent: recompute twice in
  // the same hour → identical scores, no compounding.
  // ========================================================================
  const snap = async () => (await pg.query(`select user_id, decayed_score, tier from clout_scores where city_id=$1 order by user_id`, [cityBig])).rows.map((r: any) => `${r.user_id}:${r.decayed_score}:${r.tier}`).join("|");
  const before = await snap();
  await api("/v1/admin/clout/recompute", { method: "POST", token: admin });
  const after = await snap();
  check("decay is deterministic + idempotent: a second recompute in the same hour is identical (no compounding)", before === after && before.length > 0, before === after ? `${nBig} rows identical across two runs` : "SCORES CHANGED between identical-hour runs");

  // ========================================================================
  // GATE + Requirement 1 — a share without a verified return click earns zero;
  // self-attribution blocked; repeat verifies do not compound.
  // ========================================================================
  const cloutShareCount = async (uid: string) => Number((await pg.query(`select count(*)::int n from clout_events where user_id=$1 and source='attributed_share'`, [uid])).rows[0].n);
  const share = await api("/v1/shares", { method: "POST", token: A.token, body: { drop_id: drop, redemption_id: redemptionId } });
  const token = share.body.data?.token;
  const zeroBefore = await cloutShareCount(A.uid);
  await api("/v1/admin/clout/recompute", { method: "POST", token: admin }); // recompute changes nothing without a verified click
  const zeroAfterRecompute = await cloutShareCount(A.uid);
  check("a share with NO verified return click earns zero clout", share.status === 201 && zeroBefore === 0 && zeroAfterRecompute === 0, `share=${share.status}; attributed_share events for sharer: before=${zeroBefore}, after recompute=${zeroAfterRecompute}`);

  // Raw click at /s/{token}: analytics only, still zero clout.
  const click = await api(`/s/${token}`, { redirect: "manual" });
  const clickCount = Number((await pg.query(`select click_count from share_links where token=$1`, [token])).rows[0].click_count);
  const zeroAfterClick = await cloutShareCount(A.uid);
  check("GET /s/{token} redirects (302) and records a click but grants NO clout", (click.status === 302 || click.status === 307) && clickCount >= 1 && zeroAfterClick === 0, `status=${click.status} loc=${click.location ? "set" : "none"}; click_count=${clickCount}; clout=${zeroAfterClick}`);

  // Self-attribution blocked.
  const selfVerify = await api(`/v1/shares/${token}/verify`, { method: "POST", token: A.token });
  const afterSelf = await cloutShareCount(A.uid);
  check("requirement 1: the sharer cannot self-attribute (verify by sharer → not attributed, zero clout)", selfVerify.body.data?.attributed === false && selfVerify.body.data?.reason === "self" && afterSelf === 0, `attributed=${selfVerify.body.data?.attributed} reason=${selfVerify.body.data?.reason}; clout=${afterSelf}`);

  // POSITIVE: this share carries the sharer's own redemption (created at line ~203
  // with redemption_id), so a distinct user's verified return grants exactly one.
  const verifyB = await api(`/v1/shares/${token}/verify`, { method: "POST", token: B.token });
  const afterB = await cloutShareCount(A.uid);
  check("a verified return on a share carrying the sharer's OWN redemption grants exactly one attributed_share", verifyB.body.data?.attributed === true && verifyB.body.data?.clout_earned > 0 && afterB === 1, `attributed=${verifyB.body.data?.attributed} clout=${verifyB.body.data?.clout_earned}; sharer share-events=${afterB}`);

  // Repeat verifies do not compound.
  const verifyBAgain = await api(`/v1/shares/${token}/verify`, { method: "POST", token: B.token });
  const verifyO2 = await api(`/v1/shares/${token}/verify`, { method: "POST", token: O2.token });
  const afterRepeat = await cloutShareCount(A.uid);
  check("requirement 1: repeat verified clicks do NOT compound (still exactly one attributed_share)", verifyBAgain.body.data?.attributed === false && verifyO2.body.data?.attributed === false && afterRepeat === 1, `repeatB=${verifyBAgain.body.data?.reason} other=${verifyO2.body.data?.reason}; sharer share-events=${afterRepeat}`);

  // NEGATIVE (doctrine: clout is for showing up, not broadcasting). A share of a
  // drop the sharer never redeemed carries no redemption_id — it still spreads the
  // drop, but a genuine verified return by a different user earns ZERO clout. The
  // sharer's attributed_share count must stay at 1 (unchanged from the positive).
  const shareNoRed = await api("/v1/shares", { method: "POST", token: A.token, body: { drop_id: drop } });
  const tokenNoRed = shareNoRed.body.data?.token;
  const verifyNoRed = await api(`/v1/shares/${tokenNoRed}/verify`, { method: "POST", token: B.token });
  const afterNoRed = await cloutShareCount(A.uid);
  check("a share with NO sharer-redemption earns ZERO on a verified return (attributed=false, reason 'unredeemed')", shareNoRed.status === 201 && verifyNoRed.body.data?.attributed === false && verifyNoRed.body.data?.reason === "unredeemed" && afterNoRed === 1, `share=${shareNoRed.status}; attributed=${verifyNoRed.body.data?.attributed} reason=${verifyNoRed.body.data?.reason}; sharer share-events=${afterNoRed}`);

  // ========================================================================
  // Location → city is mandatory (WP-10 fix): resolved at create, rejected when
  // unresolvable; clout events that lack a city are RESOLVED retroactively from
  // their source and COUNTED (never silently dropped).
  // ========================================================================
  {
    // loc1 was created via the API — its city must have been resolved at create.
    const loc1City = (await pg.query(`select city_id from locations where id=$1`, [loc1])).rows[0]?.city_id ?? null;
    check("location city_id is resolved and stored at create (NOT NULL)", loc1City !== null, `loc1 city_id=${loc1City ? "set" : "null"}`);

    // An address in no supported city is a create-time error, not a silent orphan.
    const farLoc = await api(`/v1/orgs/${org1}/locations`, { method: "POST", token: O1.token, body: { name: "Far", line1: "1 Broadway", city: "New York", region: "NY", postal_code: "10001", geofence_radius_m: 150 } });
    check("creating a location outside every supported city is REJECTED (VALIDATION_ERROR), not silently city-less", farLoc.status === 422 && farLoc.body.error?.code === "VALIDATION_ERROR", `${farLoc.status} ${farLoc.body.error?.code}`);

    // Seed two synthetic legacy null-city events: one whose source resolves to a
    // real city (retroactive join), one whose source is unresolvable (counted).
    const mkUser = async (tag: string): Promise<string> => {
      const id = randomUUID();
      await pg.query(`insert into auth.users (id, instance_id, aud, role, email, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token, created_at, updated_at) values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'','','','','','','','', now(), now())`, [id, `w10${tag}${stamp}@t.test`]);
      await pg.query(`insert into users (id, handle, full_name, email, phone) values ($1,$2,'L','${tag}${stamp}@t.test','L${tag}${stamp}')`, [id, `w10leg${tag}${stamp % 100000}`]);
      return id;
    };
    const U = await mkUser("u"); // event resolves to loc1's city via a real redemption
    const V = await mkUser("v"); // event is unresolvable → counted as skipped
    await pg.query(`insert into clout_events (user_id, source, points, city_id, ref_type, ref_id) values ($1,'redemption',10,null,'redemption',$2)`, [U, redemptionId]);
    await pg.query(`insert into clout_events (user_id, source, points, city_id, ref_type, ref_id) values ($1,'redemption',10,null,'redemption',$2)`, [V, randomUUID()]);

    const rc = await api("/v1/admin/clout/recompute", { method: "POST", token: admin });
    const uJoined = Number((await pg.query(`select count(*)::int n from clout_scores where user_id=$1 and city_id=$2`, [U, loc1City])).rows[0].n);
    const vJoined = Number((await pg.query(`select count(*)::int n from clout_scores where user_id=$1`, [V])).rows[0].n);
    check("a null-city event RETROACTIVELY joins the leaderboard once its source has a city (resolved from the live source)", uJoined === 1, `synthetic legacy event for U joined loc1's city: rows=${uJoined}`);
    check("an unresolvable clout event is COUNTED (skipped_no_city ≥ 1), never silently dropped, and joins nothing", (rc.body.data?.skipped_no_city ?? 0) >= 1 && vJoined === 0, `skipped_no_city=${rc.body.data?.skipped_no_city}; V leaderboard rows=${vJoined}`);
  }

  // ========================================================================
  // GET /v1/users/me/clout — the read surface.
  // ========================================================================
  const cloutView = await api("/v1/users/me/clout", { token: A.token });
  check("GET /v1/users/me/clout returns tier + decayed_score + recent ledger events", cloutView.status === 200 && typeof cloutView.body.data?.tier === "number" && (cloutView.body.data?.recent_events ?? []).length > 0, `${cloutView.status}; tier=${cloutView.body.data?.tier} decayed=${cloutView.body.data?.decayed_score} events=${(cloutView.body.data?.recent_events ?? []).length}`);

  // ========================================================================
  // Merchant score — new merchant seeded at cohort median; deterministic daily.
  // ========================================================================
  const ms1 = await api("/v1/admin/merchant-scores/recompute", { method: "POST", token: admin });
  const org2Rate = Number((await pg.query(`select redemption_rate from merchant_scores where org_id=$1`, [org2])).rows[0]?.redemption_rate ?? -1);
  const cohortMedian = ms1.body.data?.cohort_median;
  check("merchant score: a new merchant (no catches) is seeded at the cohort median", ms1.status === 200 && cohortMedian !== null && Math.abs(org2Rate - Number(cohortMedian)) < 1e-6, `cohort_median=${cohortMedian}; org2 redemption_rate=${org2Rate}`);

  // The cohort median is now STORED (one platform-wide value per run), so a bare
  // "87% redeemed" can be shown in context as "typical is 64%".
  const storedMedians = (await pg.query(`select distinct cohort_median from merchant_scores where cohort_median is not null`)).rows.map((r: any) => Number(r.cohort_median));
  check("the cohort median is stored on merchant_scores (single platform-wide value), not just returned", storedMedians.length === 1 && Math.abs(storedMedians[0] - Number(cohortMedian)) < 1e-6, `distinct stored cohort_medians=${JSON.stringify(storedMedians)}; recompute returned ${cohortMedian}`);
  // …and it reaches the client: the drop detail DTO carries it, so the card/detail can render "typical X%".
  const detailCM = await api(`/v1/drops/${drop}`, { token: A.token });
  check("the drop detail DTO surfaces cohort_median, so the rate reads in context ('typical X%')", detailCM.status === 200 && detailCM.body.data?.merchant?.cohort_median !== null && Math.abs(Number(detailCM.body.data?.merchant?.cohort_median) - Number(cohortMedian)) < 1e-6, `detail cohort_median=${detailCM.body.data?.merchant?.cohort_median} vs recompute ${cohortMedian}`);
  const ms2 = await api("/v1/admin/merchant-scores/recompute", { method: "POST", token: admin });
  const org2Rate2 = Number((await pg.query(`select redemption_rate from merchant_scores where org_id=$1`, [org2])).rows[0]?.redemption_rate ?? -1);
  check("merchant score recompute is deterministic (same day → same score)", ms2.status === 200 && org2Rate === org2Rate2, `run1=${org2Rate} run2=${org2Rate2}`);

  await pg.end();
  console.log("\nWP-10 clout / whispers / shares / merchant-score gate against " + BASE + "\n");
  for (const r of results) { console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`); console.log(`         ${r.detail}`); }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
