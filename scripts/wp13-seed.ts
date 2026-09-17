/* eslint-disable @typescript-eslint/no-explicit-any -- dev seed harness */
import { Client } from "pg";

/** WP-13 seed: a populated Salt Lake City board for screenshots — live drops
 *  with varied inventory (pips), one near-gone (flap), and one recently Gone. */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

async function api(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  try { return await res.json(); } catch { return {}; }
}
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();

  // Deterministic dev accounts so a human can sign in (dev sign-in is
  // passwordless: enter the email on the sign-in screen).
  const OWNER_EMAIL = "owner@thedrop.test";
  const BUYER_EMAIL = "buyer@thedrop.test";

  const admin = (await api("/v1/auth/oauth/callback", { method: "POST", body: { code: "dev-code:info@juicyninja.com", state: (await api("/v1/auth/oauth/start", { method: "POST", body: { provider: "google", return_to: "/" } })).data.state } })).data.session.access_token;

  async function register(email: string, handle: string): Promise<string> {
    const s = (await api("/v1/auth/oauth/start", { method: "POST", body: { provider: "google", return_to: "/" } })).data.state;
    const token = (await api("/v1/auth/oauth/callback", { method: "POST", body: { code: `dev-code:${email}`, state: s } })).data.session.access_token;
    await api("/v1/auth/register/complete", { method: "POST", token, body: { full_name: `Name ${handle}`, handle, phone: `+1801${Math.floor(1000000 + Math.random() * 8999999)}`, address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" } } });
    await api("/v1/users/me/location-permission", { method: "POST", token, body: { granted: true } });
    // Catching requires a verified phone (WP-3). Set it directly so the seeded
    // accounts can catch immediately — the SMS chain itself is proven in wp3-gate.
    await pg.query(`update users set phone_verified_at = now() where email = $1`, [email]);
    return token;
  }

  const owner = await register(OWNER_EMAIL, "maxwells");
  const orgId = (await api("/v1/orgs", { method: "POST", token: owner, body: { name: "Maxwell's", tier: "local_superstar" } })).data?.id
    ?? (await api("/v1/orgs", { token: owner })).data?.[0]?.org_id;
  const loc = (await api(`/v1/orgs/${orgId}/locations`, { method: "POST", token: owner, body: { name: "Maxwell's on Main", line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101", geofence_radius_m: 150 } })).data.id;
  await pg.query(`update merchant_scores set redemption_rate=0.87 where org_id=$1`, [orgId]);
  await pg.query(`insert into merchant_scores (org_id, redemption_rate, drops_counted) values ($1, 0.87, 1) on conflict (org_id) do update set redemption_rate=0.87`, [orgId]);

  const offers = [
    ["Free coffee with any appetizer", 24, 5],
    ["Half-price oil change", 50, 41],
    ["Two tacos, one price", 200, 96],
    ["Free dessert with dinner", 15, 15],
    ["Ten dollars off a haircut", 30, 3],
    ["Buy one pastry, get one", 8, 1],
  ] as const;
  const ids: string[] = [];
  for (const [title, qt] of offers) {
    const d = (await api("/v1/drops", { method: "POST", token: owner, body: { location_id: loc, title, description: `${title}. Show your code at the counter.`, quantity_total: qt, live_at: iso(-2000), live_until: iso(864e5), redeem_from: iso(-1000), redeem_until: iso(6 * 3600 * 1000), publish: true } })).data.id;
    ids.push(d);
  }
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
  for (let i = 0; i < offers.length; i++) {
    await pg.query(`update drops set quantity_remaining=$1 where id=$2`, [offers[i][2], ids[i]]);
  }

  // One recently-Gone drop (on the board for 5 minutes).
  const goneId = (await api("/v1/drops", { method: "POST", token: owner, body: { location_id: loc, title: "Sold-out sampler", description: "Gone.", quantity_total: 12, live_at: iso(-4000), live_until: iso(864e5), redeem_from: iso(-1000), redeem_until: iso(6 * 3600 * 1000), publish: true } })).data.id;
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
  await pg.query(`update drops set status='gone', gone_at=now(), quantity_remaining=0 where id=$1`, [goneId]);

  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin }); // pressure

  // A buyer to sign in as. register() gives them a Salt Lake City home address
  // and location permission, so the SLC board and catching work immediately.
  await register(BUYER_EMAIL, "adabuyer");

  await pg.end();
  console.log(`Seeded Salt Lake City board: ${offers.length} live + 1 gone. Org ${orgId}.`);
  console.log(`\nDev sign-in is passwordless — type the email on the sign-in screen:`);
  console.log(`  Merchant owner : ${OWNER_EMAIL}   (owns Maxwell's; open /operator)`);
  console.log(`  Buyer          : ${BUYER_EMAIL}    (browse the board; open /)`);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
