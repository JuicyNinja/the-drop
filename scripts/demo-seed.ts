/* eslint-disable @typescript-eslint/no-explicit-any -- dev demo-seed harness */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { Redis } from "@upstash/redis";
import sharp from "sharp";
import { tileWeight } from "../lib/tile-weight";
import { subjectFor, groundFor, comboSlug } from "./drop-tile-map";

/** A merchant's stable logo slug — keys the generated mark at
 *  public/tiles/logos/<slug>.webp (org ids are per-seed, so never key on them). */
const logoSlug = (name: string) =>
  name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * THE DROP — demo dataset (replaces wp13-seed.ts). A populated Salt Lake City
 * market for demos and screenshots: ~28 merchants across the taxonomy at varied
 * tiers, ~78 drops across every lifecycle state and inventory scale, ~40 buyers
 * with catch/redemption/clout/whisper history, and two deterministic demo
 * accounts. Run against a fresh `supabase db reset` with the dev server up.
 *
 * Channels (per the seed reference): orgs/locations/drops/history are created by
 * direct SQL for determinism (bulk owners + app_create_org + drafts), then ONE
 * admin scheduler tick drives runGoLive so every live drop mints its code and
 * seeds Redis exactly as production does. Sell-through, Gone, Expired and Encore
 * are then applied by SQL over the live rows. Clout tiers come from a real
 * admin recompute over the seeded ledger. Phones are verified on every account
 * that catches (build-plan rule 8).
 */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env.local", ".env.development.local"]) {
    try { for (const line of readFileSync(file, "utf8").split("\n")) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) out[m[1]] = m[2].trim(); } } catch { /* ignore */ }
  }
  return out;
}
const env = loadEnv();
const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

async function api(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  try { return { status: res.status, body: await res.json() }; } catch { return { status: res.status, body: {} }; }
}
async function session(email: string): Promise<string> {
  const s = await api("/v1/auth/oauth/start", { method: "POST", body: { provider: "google", return_to: "/" } });
  const c = await api("/v1/auth/oauth/callback", { method: "POST", body: { code: `dev-code:${email}`, state: s.body.data.state } });
  return c.body.data.session.access_token;
}

// ---------------------------------------------------------------- roster ----
type Tier = "local_starter" | "local_limited" | "local_boss" | "local_superstar";
const LIMITS: Record<Tier, [number, number, boolean]> = {
  local_starter: [1, 2, false], local_limited: [1, 8, false], local_boss: [1, 12, false], local_superstar: [8, 64, true],
};
interface Loc { name: string; line1: string; lat: number; lng: number }
interface Merchant { name: string; group: string; leaves: string[]; tier: Tier; drops: number; demoOwner?: boolean; locs: Loc[]; rate: number }

const M: Merchant[] = [
  { name: "Red Iguana", group: "food-and-drink", leaves: ["mexican"], tier: "local_limited", drops: 3, rate: 0.82, locs: [{ name: "Red Iguana", line1: "736 W North Temple", lat: 40.7702, lng: -111.9088 }] },
  { name: "Lucky 13", group: "food-and-drink", leaves: ["burgers"], tier: "local_limited", drops: 2, rate: 0.74, locs: [{ name: "Lucky 13", line1: "135 W 1300 S", lat: 40.7510, lng: -111.8930 }] },
  { name: "The Pie Pizzeria", group: "food-and-drink", leaves: ["pizza"], tier: "local_limited", drops: 3, rate: 0.68, locs: [{ name: "The Pie Underground", line1: "1320 E 200 S", lat: 40.7644, lng: -111.8471 }] },
  { name: "Sapa Sushi House", group: "food-and-drink", leaves: ["sushi"], tier: "local_boss", drops: 7, demoOwner: true, rate: 0.9, locs: [{ name: "Sapa Sushi — Downtown", line1: "722 S State St", lat: 40.7551, lng: -111.8882 }, { name: "Sapa Sushi — 9th & 9th", line1: "900 E 900 S", lat: 40.7511, lng: -111.8641 }] },
  { name: "Cannella's", group: "food-and-drink", leaves: ["italian"], tier: "local_starter", drops: 2, rate: 0.61, locs: [{ name: "Cannella's", line1: "204 E 500 S", lat: 40.7621, lng: -111.8779 }] },
  { name: "Laziz Kitchen", group: "food-and-drink", leaves: ["mediterranean"], tier: "local_limited", drops: 2, rate: 0.79, locs: [{ name: "Laziz Kitchen", line1: "912 S Jefferson St", lat: 40.7462, lng: -111.8961 }] },
  { name: "Curry Fried Chicken", group: "food-and-drink", leaves: ["fried-chicken"], tier: "local_starter", drops: 2, rate: 0.55, locs: [{ name: "Curry Fried Chicken", line1: "660 S State St", lat: 40.7561, lng: -111.8881 }] },
  { name: "Publik Coffee Roasters", group: "coffee-and-bakery", leaves: ["specialty-roaster", "coffee-shop"], tier: "local_superstar", drops: 8, rate: 0.88, locs: [
    { name: "Publik — 9th South", line1: "975 S West Temple", lat: 40.7472, lng: -111.9012 },
    { name: "Publik — Sugar House", line1: "2100 S 1100 E", lat: 40.7251, lng: -111.8571 },
    { name: "Publik — University", line1: "1615 S Foothill Dr", lat: 40.7401, lng: -111.8221 }] },
  { name: "Three Pines Coffee", group: "coffee-and-bakery", leaves: ["coffee-shop"], tier: "local_starter", drops: 2, rate: 0.72, locs: [{ name: "Three Pines Coffee", line1: "165 S Main St", lat: 40.7671, lng: -111.8912 }] },
  { name: "Les Madeleines", group: "coffee-and-bakery", leaves: ["macarons-and-fine-pastry"], tier: "local_limited", drops: 3, rate: 0.84, locs: [{ name: "Les Madeleines", line1: "500 E 500 S", lat: 40.7621, lng: -111.8731 }] },
  { name: "RubySnap Cookies", group: "coffee-and-bakery", leaves: ["cookies-and-brownies"], tier: "local_starter", drops: 2, rate: 0.66, locs: [{ name: "RubySnap", line1: "770 S 300 W", lat: 40.7511, lng: -111.9002 }] },
  { name: "Bar X", group: "bars-and-nightlife", leaves: ["cocktail-bar"], tier: "local_limited", drops: 3, rate: 0.71, locs: [{ name: "Bar X", line1: "155 E 200 S", lat: 40.7669, lng: -111.8871 }] },
  { name: "Beer Bar", group: "bars-and-nightlife", leaves: ["brewery-and-taproom"], tier: "local_limited", drops: 2, rate: 0.69, locs: [{ name: "Beer Bar", line1: "161 E 200 S", lat: 40.7669, lng: -111.8869 }] },
  { name: "Water Witch", group: "bars-and-nightlife", leaves: ["cocktail-bar"], tier: "local_limited", drops: 3, rate: 0.86, locs: [{ name: "Water Witch", line1: "163 W 900 S", lat: 40.7481, lng: -111.8971 }] },
  { name: "Master Muffler", group: "auto", leaves: ["exhaust-and-muffler", "brakes"], tier: "local_limited", drops: 2, rate: 0.58, locs: [{ name: "Master Muffler", line1: "2087 S Main St", lat: 40.7231, lng: -111.8912 }] },
  { name: "Burt Brothers Tire", group: "auto", leaves: ["tires", "oil-change"], tier: "local_limited", drops: 2, rate: 0.63, locs: [{ name: "Burt Brothers — Holladay", line1: "4885 S Highland Dr", lat: 40.6690, lng: -111.8244 }] },
  { name: "Neighborly Plumbing", group: "home-services", leaves: ["plumbing"], tier: "local_starter", drops: 2, rate: 0.52, locs: [{ name: "Neighborly Plumbing", line1: "3900 S 500 E", lat: 40.6889, lng: -111.8713 }] },
  { name: "Wasatch Home Cleaning", group: "home-services", leaves: ["house-cleaning"], tier: "local_limited", drops: 2, rate: 0.6, locs: [{ name: "Wasatch Home Cleaning", line1: "2250 S 1300 E", lat: 40.7231, lng: -111.8541 }] },
  { name: "Lunatic Fringe Salon", group: "personal-care", leaves: ["hair-salon", "hair-color"], tier: "local_limited", drops: 3, rate: 0.77, locs: [{ name: "Lunatic Fringe — Sugar House", line1: "1158 E Wilmington Ave", lat: 40.7221, lng: -111.8551 }] },
  { name: "Spruce Barbershop", group: "personal-care", leaves: ["barber"], tier: "local_starter", drops: 2, rate: 0.64, locs: [{ name: "Spruce Barbershop", line1: "878 E 900 S", lat: 40.7511, lng: -111.8651 }] },
  { name: "The Front Climbing Club", group: "fitness", leaves: ["climbing-gym"], tier: "local_boss", drops: 4, rate: 0.83, locs: [{ name: "The Front — SLC", line1: "1470 S 400 W", lat: 40.7391, lng: -111.9021 }] },
  { name: "Fit Stop Gym", group: "fitness", leaves: ["gym-membership"], tier: "local_limited", drops: 3, rate: 0.59, locs: [{ name: "Fit Stop", line1: "3900 S Highland Dr", lat: 40.6901, lng: -111.8281 }] },
  { name: "Brewvies Cinema Pub", group: "entertainment", leaves: ["movie-theater"], tier: "local_limited", drops: 3, rate: 0.75, locs: [{ name: "Brewvies", line1: "677 S 200 W", lat: 40.7541, lng: -111.9011 }] },
  { name: "Quarters Arcade Bar", group: "entertainment", leaves: ["arcade"], tier: "local_limited", drops: 2, rate: 0.7, locs: [{ name: "Quarters", line1: "5 E 400 S", lat: 40.7591, lng: -111.8891 }] },
  { name: "Fice Gallery", group: "retail-apparel", leaves: ["streetwear", "sneakers-and-collectibles"], tier: "local_starter", drops: 2, rate: 0.57, locs: [{ name: "Fice", line1: "160 E 200 S", lat: 40.7669, lng: -111.8872 }] },
  { name: "Lucky Ones", group: "retail-apparel", leaves: ["womens-clothing"], tier: "local_limited", drops: 2, rate: 0.62, locs: [{ name: "Lucky Ones", line1: "926 E 900 S", lat: 40.7511, lng: -111.8631 }] },
  { name: "Now & Again", group: "retail-home-and-lifestyle", leaves: ["home-decor"], tier: "local_limited", drops: 2, rate: 0.67, locs: [{ name: "Now & Again", line1: "207 E 300 S", lat: 40.7641, lng: -111.8861 }] },
  { name: "Caputo's Market & Deli", group: "grocery-and-specialty-food", leaves: ["cheese-shop", "butcher"], tier: "local_limited", drops: 3, rate: 0.81, locs: [{ name: "Caputo's — Downtown", line1: "314 W 300 S", lat: 40.7611, lng: -111.8991 }] },
];

// Offer templates per group (title, description, terms).
const OFFERS: Record<string, { t: string; d: string }[]> = {
  "food-and-drink": [{ t: "Half-off first entrée", d: "Any entrée, half price, dine-in." }, { t: "$5 street tacos", d: "Three tacos, your choice, five dollars." }, { t: "Two entrées, one price", d: "Bring a friend — pay for one." }, { t: "Free appetizer with entrée", d: "Start on the house." }],
  "coffee-and-bakery": [{ t: "Buy one, get one latte", d: "Any two espresso drinks, pay for one." }, { t: "$2 morning pastry", d: "Croissant, roll, or scone — two dollars til 10am." }, { t: "Half-off a dozen", d: "A dozen, half price." }, { t: "Free drip with any bag", d: "Buy beans, drink free." }],
  "bars-and-nightlife": [{ t: "$6 house cocktail", d: "Any signature cocktail, six dollars." }, { t: "Two-for-one drafts", d: "Local drafts, buy one get one." }, { t: "Half-off the bottle list", d: "Wine by the bottle, half price." }],
  "auto": [{ t: "$29 oil change", d: "Full synthetic, most vehicles." }, { t: "Free brake inspection", d: "Full brake check, no charge." }, { t: "$99 four-tire rotation & align", d: "Rotation plus alignment." }],
  "home-services": [{ t: "$79 drain clearing", d: "One drain, cleared." }, { t: "Half-off first clean", d: "First visit, half price." }, { t: "Free in-home estimate", d: "We come to you, no charge." }],
  "personal-care": [{ t: "$25 cut & style", d: "Wash, cut, style." }, { t: "Half-off first color", d: "New clients, first color half price." }, { t: "$15 beard trim & line", d: "Trim, line, hot towel." }],
  "fitness": [{ t: "First month free", d: "New members, first month on us." }, { t: "$10 day pass, unlimited", d: "One full day, all access." }, { t: "Half-off intro class pack", d: "Five classes, half price." }],
  "entertainment": [{ t: "$5 matinee", d: "Any before-5pm show." }, { t: "$20 arcade play card", d: "Twenty dollars of play, ten cost." }, { t: "Two tickets, one price", d: "Bring someone." }],
  "retail-apparel": [{ t: "30% off one item", d: "Any single item, 30 percent off." }, { t: "$40 off sneakers", d: "Forty off any pair over 100." }, { t: "Buy two, third half off", d: "Third item half price." }],
  "retail-home-and-lifestyle": [{ t: "25% off one piece", d: "Any single home piece." }, { t: "$15 candle bar", d: "Pour your own, fifteen dollars." }],
  "grocery-and-specialty-food": [{ t: "Half-off the cheese counter", d: "Cut-to-order cheese, half price per pound." }, { t: "$10 butcher box", d: "Butcher's choice, ten dollars." }, { t: "Free loaf with $25", d: "Fresh loaf on any 25-dollar basket." }],
};

const QTY = [10, 25, 50, 100, 200];
// Sell-through spread 5%–95%; 0.05 and 0.07 are "just opened" (>90% left).
const SELL = [0.05, 0.5, 0.92, 0.2, 0.7, 0.35, 0.95, 0.07, 0.6, 0.8, 0.45, 0.88, 0.15, 0.55, 0.75, 0.3, 0.9, 0.4, 0.65, 0.25];
const NAMES = ["parley", "brigit", "orson", "lenora", "ezra", "mabel", "walt", "iris", "clyde", "opal", "hazel", "milo", "june", "arlo", "greta", "silas", "nova", "dashiell", "cleo", "otis", "wren", "hugo", "posy", "dean", "tess", "roscoe", "vera", "finn", "lark", "abel", "sunny", "cyrus", "delia", "beau", "esme", "jonah", "marlo", "reva", "sol", "thea"];

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const DAY = 864e5;

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB }); await pg.connect();
  const admin = await session("info@juicyninja.com");
  const q = (sql: string, p: any[] = []) => pg.query(sql, p);

  // 1. SLC live + out of cold-start so pressure/heat ranking shows.
  const slc = (await q(`select id from cities where name='Salt Lake City' limit 1`)).rows[0].id as string;
  await q(`update cities set active=true, launched_at=now()-interval '90 days', coldstart_min_events=50 where id=$1`, [slc]);

  // Leaf/group slug -> tag id.
  const tagId = new Map<string, string>();
  for (const r of (await q(`select id, slug from tags`)).rows) tagId.set(r.slug, r.id);

  // ---- bulk user helper (auth.users + users), phone-verified, location granted ----
  let uCount = 0;
  async function mkUser(handle: string, name: string, phoneDigits: string, opts: { verified?: boolean } = {}): Promise<string> {
    const id = (await q(`insert into auth.users (id, instance_id, aud, role, email, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token, created_at, updated_at)
      values (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'','','','','','','','', now(), now()) returning id`, [`${handle}@demo.thedrop.test`])).rows[0].id as string;
    await q(`insert into users (id, handle, full_name, email, phone, location_perm_granted_at, phone_verified_at)
      values ($1,$2,$3,$4,$5, now(), ${opts.verified === false ? "null" : "now()"})`,
      [id, handle, name, `${handle}@demo.thedrop.test`, `+1801${phoneDigits}`]);
    uCount++;
    return id;
  }

  // 2. Merchants: owner user (SQL) + org (app_create_org) + locations + org_tags + score.
  //    Demo owner (Sapa) is registered through the API so it is sign-in-able.
  const DEMO_OWNER_EMAIL = "demo.owner@thedrop.test";
  const DEMO_BUYER_EMAIL = "demo.buyer@thedrop.test";
  let demoOwnerToken = "";
  interface Live { dropId: string; locId: string; orgId: string; qty: number; sold: number; code: string; group: string; merchant: string; ownerId: string; demoOwner: boolean }
  const orgs: { m: Merchant; orgId: string; ownerId: string; locIds: string[] }[] = [];
  let phoneSeq = 2000000;

  for (const m of M) {
    const [maxLoc, perCycle, pooled] = LIMITS[m.tier];
    let ownerId: string;
    if (m.demoOwner) {
      demoOwnerToken = await session(DEMO_OWNER_EMAIL);
      await api("/v1/auth/register/complete", { method: "POST", token: demoOwnerToken, body: { full_name: "Kenji Kimoto", handle: "kimoto", phone: "+18015550101", address: { label: "Home", line1: "722 S State St", city: "Salt Lake City", region: "UT", postal_code: "84111" } } });
      ownerId = (await q(`select id from users where email=$1`, [DEMO_OWNER_EMAIL])).rows[0].id as string;
      await q(`update users set phone_verified_at=now() where id=$1`, [ownerId]);
    } else {
      const oh = m.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) + "own";
      ownerId = await mkUser(oh, `${m.name} Owner`, String(phoneSeq++));
    }
    const orgId = (await q(`select id from app_create_org($1,$2,'local',$3::subscription_tier,$4,$5,$6)`, [ownerId, m.name, m.tier, maxLoc, perCycle, pooled])).rows[0].id as string;
    const locIds: string[] = [];
    for (const l of m.locs) {
      const lid = (await q(`insert into locations (org_id, name, line1, city, region, postal_code, lat, lng, geofence_radius_m, city_id, active)
        values ($1,$2,$3,'Salt Lake City','UT','84101',$4,$5,150,$6,true) returning id`, [orgId, l.name, l.line1, l.lat, l.lng, slc])).rows[0].id as string;
      locIds.push(lid);
    }
    for (const leaf of m.leaves) { const tid = tagId.get(leaf); if (tid) await q(`insert into org_tags (org_id, tag_id) values ($1,$2) on conflict do nothing`, [orgId, tid]); }
    await q(`insert into merchant_scores (org_id, redemption_rate, whisper_score, drops_counted) values ($1,$2,$3,$4) on conflict (org_id) do update set redemption_rate=$2, whisper_score=$3`, [orgId, m.rate, Math.min(1, m.rate + 0.05), m.drops]);
    // Wire the merchant logo when its generated mark exists; otherwise leave it
    // null and the card falls back to a monogram (§4.2). Keyed on a stable slug.
    const slug = logoSlug(m.name);
    if (existsSync(join(process.cwd(), "public", "tiles", "logos", `${slug}.webp`))) {
      await q(`update organizations set logo_url=$2 where id=$1`, [orgId, `/tiles/logos/${slug}.webp`]);
    }
    orgs.push({ m, orgId, ownerId, locIds });
  }

  // 3. Drops: insert as draft -> scheduled (SQL); one admin tick makes them live.
  interface Plan { id: string; orgId: string; locId: string; ownerId: string; qty: number; state: "live" | "gone" | "expired"; sell: number; group: string; merchant: string; demoOwner: boolean }
  const plans: Plan[] = [];
  let gi = 0;
  for (const o of orgs) {
    const pool = OFFERS[o.m.group];
    for (let d = 0; d < o.m.drops; d++) {
      const qty = QTY[(gi * 3 + 1) % QTY.length]; // decoupled from sell so low-sell isn't stuck at qty 10
      let state: Plan["state"] = "live";
      if (gi % 9 === 4) state = "gone"; else if (gi % 11 === 7) state = "expired";
      const sell = state === "gone" ? 1 : SELL[gi % SELL.length];
      const offer = pool[(gi + d) % pool.length];
      const locId = o.locIds[d % o.locIds.length];
      // Expired: a valid window entirely in the past (redeem_until > redeem_from),
      // so the same tick's runClose closes it to 'expired' after go-live.
      const liveAt = state === "expired" ? iso(-3 * DAY) : iso(-2000 - gi * 1000);
      const liveUntil = state === "expired" ? iso(-1 * DAY) : iso(3 * DAY);
      const redeemFrom = state === "expired" ? iso(-3 * DAY) : iso(-1000);
      const redeemUntil = state === "expired" ? iso(-1 * DAY) : iso(6 * 3600 * 1000);
      const id = (await q(`insert into drops (lane, org_id, location_id, city_id, status, title, description, quantity_total, quantity_remaining, live_at, live_until, redeem_from, redeem_until, created_by)
        values ('local',$1,$2,$3,'draft',$4,$5,$6,$6,$7,$8,$9,$10,$11) returning id`,
        [o.orgId, locId, slc, `${offer.t} — ${o.m.name}`, offer.d, qty, liveAt, liveUntil, redeemFrom, redeemUntil, o.ownerId])).rows[0].id as string;
      await q(`update drops set status='scheduled' where id=$1`, [id]);
      plans.push({ id, orgId: o.orgId, locId, ownerId: o.ownerId, qty, state, sell, group: o.m.group, merchant: o.m.name, demoOwner: !!o.m.demoOwner });
      gi++;
    }
  }

  // 4. Go live: one scheduler tick mints codes + seeds Redis for every scheduled drop.
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });

  // 5. Apply sell-through / gone / expired over the now-live rows.
  const live: Live[] = [];
  for (const p of plans) {
    const code = (await q(`select code from drops where id=$1`, [p.id])).rows[0].code as string;
    if (p.state === "gone") {
      await q(`update drops set status='gone', gone_at=now(), quantity_remaining=0 where id=$1`, [p.id]);
      await redis.set(`drop:${p.id}:inventory`, 0);
    } else if (p.state === "expired") {
      // runClose already expired it during the tick; force only if it somehow stayed live.
      await q(`update drops set status='expired' where id=$1 and status='live'`, [p.id]);
    } else {
      const sold = Math.min(p.qty - 1, Math.round(p.qty * p.sell));
      const remaining = p.qty - sold;
      await q(`update drops set quantity_remaining=$2 where id=$1`, [p.id, remaining]);
      await redis.set(`drop:${p.id}:inventory`, remaining);
      live.push({ dropId: p.id, locId: p.locId, orgId: p.orgId, qty: p.qty, sold, code, group: p.group, merchant: p.merchant, ownerId: p.ownerId, demoOwner: p.demoOwner });
    }
  }

  // 6. Encore: take the first gone drop, encore it into a fresh live drop.
  const goneOne = plans.find((p) => p.state === "gone")!;
  const encoreId = (await q(`insert into drops (lane, org_id, location_id, city_id, status, title, description, quantity_total, quantity_remaining, live_at, live_until, redeem_from, redeem_until, created_by, parent_drop_id)
    values ('local',$1,$2,$3,'draft',$4,$5,$6,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [goneOne.orgId, goneOne.locId, slc, `Encore — ${OFFERS[goneOne.group][0].t}`, "Back by demand. New supply, never a restock.", 60, iso(-1500), iso(3 * DAY), iso(-1000), iso(6 * 3600 * 1000), goneOne.ownerId, goneOne.id])).rows[0].id as string;
  await q(`update drops set status='encore_pending' where id=$1`, [goneOne.id]);
  await q(`update drops set status='scheduled' where id=$1`, [encoreId]);
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });
  { const c = (await q(`select code from drops where id=$1`, [encoreId])).rows[0].code as string; await q(`update drops set quantity_remaining=44 where id=$1`, [encoreId]); await redis.set(`drop:${encoreId}:inventory`, 44); live.push({ dropId: encoreId, locId: goneOne.locId, orgId: goneOne.orgId, qty: 60, sold: 16, code: c, group: goneOne.group, merchant: goneOne.merchant, ownerId: goneOne.ownerId, demoOwner: goneOne.demoOwner }); }

  // 6b. Allowance usage: direct-SQL drops bypass app_consume_drop_allowance, so
  //     seed drop_allowance_usage per scope (pooled → org row; else per location)
  //     from the real drop counts so every operator scoreboard reads consumed.
  for (const o of orgs) {
    const [, , pooled] = LIMITS[o.m.tier];
    const cyc = (await q(`select cycle_anchor_at cs, cycle_anchor_at + interval '30 days' ce from organizations where id=$1`, [o.orgId])).rows[0];
    if (pooled) {
      const used = Number((await q(`select count(*)::int n from drops where org_id=$1`, [o.orgId])).rows[0].n);
      await q(`insert into drop_allowance_usage (org_id, location_id, cycle_start, cycle_end, drops_used) values ($1,null,$2,$3,$4)`, [o.orgId, cyc.cs, cyc.ce, used]);
    } else {
      for (const lid of o.locIds) {
        const used = Number((await q(`select count(*)::int n from drops where org_id=$1 and location_id=$2`, [o.orgId, lid])).rows[0].n);
        if (used > 0) await q(`insert into drop_allowance_usage (org_id, location_id, cycle_start, cycle_end, drops_used) values ($1,$2,$3,$4,$5)`, [o.orgId, lid, cyc.cs, cyc.ce, used]);
      }
    }
  }

  // 7. Buyers: 40 via SQL (phone-verified). Demo buyer via API (sign-in-able).
  const buyers: string[] = [];
  for (let i = 0; i < NAMES.length; i++) buyers.push(await mkUser(NAMES[i] + (i + 10), NAMES[i][0].toUpperCase() + NAMES[i].slice(1) + " " + String.fromCharCode(65 + (i % 26)) + ".", String(phoneSeq++)));
  const demoBuyerToken = await session(DEMO_BUYER_EMAIL);
  await api("/v1/auth/register/complete", { method: "POST", token: demoBuyerToken, body: { full_name: "Parley Pratt", handle: "parleyp", phone: "+18015550142", address: { label: "Home", line1: "540 S 200 E", city: "Salt Lake City", region: "UT", postal_code: "84111" } } });
  const demoBuyer = (await q(`select id from users where email=$1`, [DEMO_BUYER_EMAIL])).rows[0].id as string;
  await q(`update users set phone_verified_at=now() where id=$1`, [demoBuyer]);
  // Home address gets SLC coords; add Work + Ski cabin, keep Home active.
  await q(`update addresses set lat=40.7601, lng=-111.8802, radius_miles=8 where user_id=$1 and is_home`, [demoBuyer]);
  await q(`insert into addresses (user_id, label, line1, city, region, postal_code, lat, lng, radius_miles, is_home) values
    ($1,'Work','15 W South Temple','Salt Lake City','UT','84101',40.7684,-111.8912,5,false),
    ($1,'Sugar House','2100 S 1100 E','Salt Lake City','UT','84106',40.7251,-111.8571,10,false)`, [demoBuyer]);

  // 8. Catches + redemptions + clout + whispers.
  const nextPos = new Map<string, number>(); // drop -> next position
  const pos = (d: string) => { const n = (nextPos.get(d) ?? 0) + 1; nextPos.set(d, n); return n; };
  let catches = 0, redemptions = 0, whispers = 0, cloutRows = 0;
  async function seedCatch(dropId: string, code: string, buyer: string, opts: { redeem?: boolean; whisper?: boolean; orgId?: string; locId?: string; ageDays?: number; unverified?: boolean } = {}): Promise<void> {
    const p = pos(dropId); const age = opts.ageDays ?? 2;
    const st = opts.redeem ? "redeemed" : "held";
    const cid = (await q(`insert into catches (drop_id, user_id, original_user_id, position_number, code, status, caught_at, expires_at)
      values ($1,$2,$2,$3,$4,$5::catch_status, now()-($6||' days')::interval, now()+interval '1 day') returning id`, [dropId, buyer, p, code, st, String(age)])).rows[0].id as string;
    catches++;
    if (opts.redeem) {
      const method = opts.unverified ? "unverified_timeout" : "gps_verified";
      const rid = (await q(`insert into redemptions (catch_id, drop_id, location_id, user_id, method, lat, lng, accuracy_m, distance_m, velocity_flagged, redeemed_at)
        values ($1,$2,$3,$4,$5::redemption_method,40.76,-111.89,$6,40,false, now()-($7||' days')::interval) returning id`, [cid, dropId, opts.locId, buyer, method, opts.unverified ? 999 : 12, String(age)])).rows[0].id as string;
      redemptions++;
      await q(`insert into clout_events (user_id, source, points, city_id, ref_type, ref_id, occurred_at) values ($1,'redemption',10,$2,'redemption',$3, now()-($4||' days')::interval)`, [buyer, slc, rid, String(age)]); cloutRows++;
      if (opts.whisper) {
        const wid = (await q(`insert into whispers (redemption_id, user_id, org_id, location_id, would_return_at_full_price, dim_2, dim_3, dim_4, note)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [rid, buyer, opts.orgId, opts.locId, (p % 5 !== 0), 3 + (p % 3), 4 + (p % 2), 3 + ((p + 1) % 3), null])).rows[0].id as string;
        whispers++;
        await q(`insert into clout_events (user_id, source, points, city_id, ref_type, ref_id, occurred_at) values ($1,'whisper',5,$2,'whisper',$3, now()-($4||' days')::interval)`, [buyer, slc, wid, String(age)]); cloutRows++;
      }
    }
  }

  // Demo buyer: 4 held catches at low position numbers (001–004) on the hottest
  // drops, 6 redemptions (3 whispered), 2 attributed shares → mid-tier clout.
  const demoLive = [...live].sort((a, b) => b.sold - a.sold).slice(0, 12);
  for (let i = 0; i < 4; i++) { nextPos.set(demoLive[i].dropId, i); await seedCatch(demoLive[i].dropId, demoLive[i].code, demoBuyer, {}); }
  for (let i = 4; i < 10; i++) await seedCatch(demoLive[i].dropId, demoLive[i].code, demoBuyer, { redeem: true, whisper: i < 7, orgId: demoLive[i].orgId, locId: demoLive[i].locId, ageDays: 2 + (i - 4) });
  for (let i = 0; i < 2; i++) { await q(`insert into clout_events (user_id, source, points, city_id, ref_type, ref_id, occurred_at) values ($1,'attributed_share',15,$2,'share',gen_random_uuid(), now()-($3||' days')::interval)`, [demoBuyer, slc, String(1 + i * 2)]); cloutRows++; }

  // Population: spread catches across drops and buyers; ~55% redeemed, ~30% of those whispered.
  const catchable = live.filter((l) => l.sold >= 2);
  let k = 0;
  for (const l of catchable) {
    const n = 1 + (l.sold % 4);
    for (let j = 0; j < n && j < 5; j++) {
      const buyer = buyers[(k * 7 + j) % buyers.length];
      const redeem = (k + j) % 100 < 55;
      const whisper = redeem && (k + j) % 100 < 30;
      const unverified = (k + j) % 17 === 0;
      await seedCatch(l.dropId, l.code, buyer, { redeem, whisper, orgId: l.orgId, locId: l.locId, ageDays: 1 + ((k + j) % 20), unverified });
      k++;
    }
  }
  // A few attributed-share clout events for source variety.
  for (let i = 0; i < 12; i++) { await q(`insert into clout_events (user_id, source, points, city_id, ref_type, ref_id, occurred_at) values ($1,'attributed_share',15,$2,'share',gen_random_uuid(), now()-($3||' days')::interval)`, [buyers[i * 3 % buyers.length], slc, String(1 + i * 2)]); cloutRows++; }

  // 9. Follows + Fanatics for the demo buyer + a sample of buyers (≤10 fanatics/lane).
  const sample = orgs.slice(0, 12);
  for (let i = 0; i < sample.length; i++) {
    const tier = i < 4 ? "fanatic" : "follower";
    await q(`insert into follows (user_id, org_id, lane, tier) values ($1,$2,'local',$3::follow_tier) on conflict (user_id,org_id) do update set tier=excluded.tier`, [demoBuyer, sample[i].orgId, tier]);
  }
  for (let b = 0; b < 20; b++) for (let f = 0; f < 3; f++) { const org = orgs[(b + f * 5) % orgs.length]; await q(`insert into follows (user_id, org_id, lane, tier) values ($1,$2,'local',$3::follow_tier) on conflict (user_id,org_id) do nothing`, [buyers[b], org.orgId, f === 0 ? "fanatic" : "follower"]); }

  // 10. Real clout recompute → tiers + percentiles per city.
  await api("/v1/admin/clout/recompute", { method: "POST", token: admin });

  // 11. Drop tiles (§15). Wire EVERY drop to its committed combo tile
  //     (subject × ground × weight) so a reseed produces a complete board with no
  //     manual step. The 33 canonical combo tiles live in public/tiles/drops/_gen/;
  //     the per-drop file is derived — mirrored for right-weighted drops (§15.5),
  //     keyed by the run's random drop id, and gitignored (regenerated each seed).
  const genDir = join(process.cwd(), "public", "tiles", "drops", "_gen");
  const dropDir = join(process.cwd(), "public", "tiles", "drops");
  const tileRows = (await q(
    `select distinct on (d.id) d.id, d.title, gp.slug gslug
       from drops d
       join org_tags ot on ot.org_id = d.org_id
       join tags leaf on leaf.id = ot.tag_id
       join tags gp on gp.id = leaf.parent_id
      where d.city_id = $1
      order by d.id`,
    [slc],
  )).rows as { id: string; title: string; gslug: string }[];
  let tiled = 0, tmiss = 0;
  for (const r of tileRows) {
    const src = join(genDir, `${comboSlug(subjectFor(r.title), groundFor(r.gslug))}.webp`);
    if (!existsSync(src)) { tmiss++; continue; }
    const buf = readFileSync(src);
    const out = tileWeight(r.id) === "right" ? await sharp(buf).flop().webp({ quality: 82 }).toBuffer() : buf;
    writeFileSync(join(dropDir, `${r.id}.webp`), out);
    await q(`update drops set image_urls = $2 where id = $1`, [r.id, [`/tiles/drops/${r.id}.webp`]]);
    tiled++;
  }
  // Keep the Gone lane visible on a fresh seed: refresh gone drops into the board's
  // 5-minute window so a demo viewer sees a Gone card without any manual flip.
  await q(`update drops set gone_at = now() where status = 'gone' and city_id = $1`, [slc]);

  // ---- report ----
  const cnt = async (sql: string, p: any[] = []) => Number((await q(sql, p)).rows[0].n);
  const byState = (await q(`select status, count(*)::int n from drops group by status order by n desc`)).rows;
  const invMin = await cnt(`select min(quantity_total)::int n from drops`);
  const invMax = await cnt(`select max(quantity_total)::int n from drops`);
  const nearly = await cnt(`select count(*)::int n from drops where status='live' and quantity_remaining::float/quantity_total < 0.1`);
  const fresh = await cnt(`select count(*)::int n from drops where status='live' and quantity_remaining::float/quantity_total > 0.9`);
  const band = (await q(`select
    count(*) filter (where quantity_remaining::float/quantity_total > 0.9)::int b90,
    count(*) filter (where quantity_remaining::float/quantity_total >= 0.6 and quantity_remaining::float/quantity_total <= 0.9)::int b60,
    count(*) filter (where quantity_remaining::float/quantity_total >= 0.3 and quantity_remaining::float/quantity_total < 0.6)::int b30,
    count(*) filter (where quantity_remaining::float/quantity_total >= 0.1 and quantity_remaining::float/quantity_total < 0.3)::int b10,
    count(*) filter (where quantity_remaining::float/quantity_total < 0.1)::int b0
    from drops where status='live'`)).rows[0];
  const tierDist = (await q(`select tier, count(*)::int n from clout_scores where city_id=$1 group by tier order by tier`, [slc])).rows;
  const demoClout = (await q(`select tier, decayed_score from clout_scores where user_id=$1 and city_id=$2`, [demoBuyer, slc])).rows[0];
  const demoOwnerOrg = orgs.find((o) => o.m.demoOwner)!;
  const usage = (await q(`select coalesce(sum(drops_used),0)::int used from drop_allowance_usage where org_id=$1`, [demoOwnerOrg.orgId])).rows[0].used;
  const ownerWhispers = await cnt(`select count(*)::int n from whispers where org_id=$1`, [demoOwnerOrg.orgId]);
  const ownerLive = await cnt(`select count(*)::int n from drops where org_id=$1 and status='live'`, [demoOwnerOrg.orgId]);

  console.log("\n================  THE DROP — DEMO DATASET SEEDED  ================\n");
  console.log(`Salt Lake City market — active, out of cold-start.`);
  console.log(`Merchants: ${orgs.length}   Locations: ${(await cnt(`select count(*)::int n from locations`))}   Users: ${uCount + 2} (owners+buyers+2 demo)`);
  console.log(`\nDROPS by state:`); for (const r of byState) console.log(`   ${String(r.status).padEnd(14)} ${r.n}`);
  console.log(`   live nearly-gone (<10% left): ${nearly}    just-opened (>90% left): ${fresh}`);
  console.log(`   live sell-through spread → >90% left: ${band.b90}  60–90%: ${band.b60}  30–60%: ${band.b30}  10–30%: ${band.b10}  <10%: ${band.b0}`);
  console.log(`   inventory scale: ${invMin}–${invMax} units    encore: linked to a Gone parent`);
  console.log(`\nHISTORY: catches ${catches}   redemptions ${redemptions}   whispers ${whispers}   clout_events ${cloutRows}`);
  console.log(`clout tiers in SLC:`); for (const r of tierDist) console.log(`   tier ${r.tier}: ${r.n}`);
  console.log(`\nDEMO OWNER  ${DEMO_OWNER_EMAIL}   (handle kimoto — owns ${demoOwnerOrg.m.name}, ${demoOwnerOrg.m.tier}; ${ownerLive} live drops, ${ownerWhispers} whispers received, allowance used ${usage}/${LIMITS[demoOwnerOrg.m.tier][1]} per location)`);
  console.log(`DEMO BUYER  ${DEMO_BUYER_EMAIL}   (handle parleyp — clout tier ${demoClout?.tier}, 3 saved addresses, follows+fanatics)`);
  console.log(`Dev sign-in is passwordless: type the email on the sign-in screen.\n`);
  console.log(`Drop tiles: wired ${tiled} drops to §15 combo tiles${tmiss ? ` (${tmiss} missing combo)` : ""} — subject × ground × weight, no manual step.`);
  await pg.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
