/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { Client } from "pg";

/**
 * WP-4 acceptance gate. Drives the real HTTP API on a running dev server.
 * The dev geocoder maps launch cities to real centers, so switching the active
 * address between SLC, Provo, and Manhattan moves the discovery market for real.
 */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

async function api(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });
const subOf = (t: string) => JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8")).sub as string;

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const stamp = Date.now();

  // --- Register a user (Home is created in SLC by register/complete). ---
  const start = await api("/v1/auth/oauth/start", { method: "POST", body: { provider: "google", return_to: "/" } });
  const cb = await api("/v1/auth/oauth/callback", {
    method: "POST",
    body: { code: `dev-code:wp4_${stamp}@example.test`, state: start.body.data.state },
  });
  const token = cb.body.data.session.access_token as string;
  const uid = subOf(token);
  const reg = await api("/v1/auth/register/complete", {
    method: "POST",
    token,
    body: {
      full_name: "WP4 User",
      handle: `wp4u${stamp % 100000}`,
      phone: `+1801777${stamp % 10000}`,
      address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101", country: "US" },
    },
  });
  if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);

  const homeId = (await pg.query(`select id from addresses where user_id=$1 and is_home`, [uid])).rows[0].id as string;

  // --- Additional addresses (per-address radius). ---
  const work = await api("/v1/addresses", {
    method: "POST",
    token,
    body: { label: "Work", line1: "100 N University Ave", city: "Provo", region: "UT", postal_code: "84601", radius_miles: 25 },
  });
  const trip = await api("/v1/addresses", {
    method: "POST",
    token,
    body: { label: "Trip", line1: "20 W 34th St", city: "Manhattan", region: "NY", postal_code: "10001", radius_miles: 5 },
  });
  check(
    "per-address radius stored distinctly (Work=25, Trip=5)",
    work.body.data?.radius_miles === 25 && trip.body.data?.radius_miles === 5,
    `Work=${work.body.data?.radius_miles} Trip=${trip.body.data?.radius_miles}`,
  );
  check(
    "server-side geocoding populated lat/lng (client supplied none)",
    typeof work.body.data?.lat === "number" && typeof trip.body.data?.lat === "number",
    `Work=(${work.body.data?.lat},${work.body.data?.lng}) Trip=(${trip.body.data?.lat},${trip.body.data?.lng})`,
  );
  const workId = work.body.data.id as string;

  // --- Addition: client-supplied lat/lng rejected. ---
  const spoofCreate = await api("/v1/addresses", {
    method: "POST",
    token,
    body: { label: "Spoof", line1: "1 Main", city: "Provo", region: "UT", postal_code: "84601", lat: 40.76, lng: -111.89 },
  });
  check(
    "POST address with lat/lng is rejected with VALIDATION_ERROR",
    spoofCreate.status === 422 && spoofCreate.body.error?.code === "VALIDATION_ERROR",
    `${spoofCreate.status} ${JSON.stringify(spoofCreate.body.error ?? spoofCreate.body)}`,
  );
  const spoofPatch = await api(`/v1/addresses/${workId}`, {
    method: "PATCH",
    token,
    body: { lat: 0, lng: 0 },
  });
  check(
    "PATCH address with lat/lng is rejected with VALIDATION_ERROR",
    spoofPatch.status === 422 && spoofPatch.body.error?.code === "VALIDATION_ERROR",
    `${spoofPatch.status} ${JSON.stringify(spoofPatch.body.error ?? spoofPatch.body)}`,
  );

  // --- Seed one live local drop in an SLC location and one in a Provo location. ---
  const org = (await pg.query(`insert into organizations (name,lane,tier,max_locations,drops_per_cycle,cycle_anchor_at) values ('WP4 Org','local','local_starter',1,2,now()) returning id`)).rows[0].id;
  const cityUt = (await pg.query(`select id from cities where name='Salt Lake City'`)).rows[0].id;
  const slcLoc = (await pg.query(`insert into locations (org_id,name,line1,city,region,postal_code,lat,lng,city_id) values ($1,'SLC Shop','1 Main','Salt Lake City','UT','84101',40.7608,-111.8910,$2) returning id`, [org, cityUt])).rows[0].id;
  const provoLoc = (await pg.query(`insert into locations (org_id,name,line1,city,region,postal_code,lat,lng,city_id) values ($1,'Provo Shop','1 Center','Provo','UT','84601',40.2338,-111.6585,$2) returning id`, [org, cityUt])).rows[0].id;
  const founder = (await pg.query(`select id from users where user_number=1`)).rows[0].id;
  async function liveDrop(loc: string, title: string): Promise<string> {
    const id = (await pg.query(`insert into drops (lane,org_id,location_id,city_id,title,description,quantity_total,quantity_remaining,redeem_from,redeem_until,created_by) values ('local',$1,$2,$3,$4,'x',10,10,now(),now()+interval '1 day',$5) returning id`, [org, loc, cityUt, title, founder])).rows[0].id as string;
    await pg.query(`update drops set status='scheduled' where id=$1`, [id]);
    await pg.query(`update drops set status='live' where id=$1`, [id]);
    return id;
  }
  const slcDrop = await liveDrop(slcLoc, "SLC Drop");
  const provoDrop = await liveDrop(provoLoc, "Provo Drop");

  const discover = async () =>
    (await pg.query(`select id, title from app_discover_local_drops($1)`, [uid])).rows.map((r) => r.title as string);

  // ========================================================================
  // GATE 1 — switching the active address changes the Local board market.
  // ========================================================================
  const toHome = await api("/v1/users/me/active-address", { method: "PUT", token, body: { address_id: homeId } });
  const homeMarket = toHome.body.data?.market?.nearest_city?.name;
  const homeBoard = await discover();

  const toWork = await api("/v1/users/me/active-address", { method: "PUT", token, body: { address_id: workId } });
  const workMarket = toWork.body.data?.market?.nearest_city?.name;
  const workBoard = await discover();

  check(
    "1. active-address switch moves the resolved market (SLC → Provo)",
    homeMarket === "Salt Lake City" && workMarket === "Provo",
    `Home→${homeMarket}; Work→${workMarket}`,
  );
  // Set-based: the market includes its own city's drops and excludes the other
  // city's, robust to a dev DB that accumulates drops across gate runs.
  check(
    "1. Local board (discovery) includes the active city's drop and excludes the other's",
    homeBoard.includes("SLC Drop") &&
      !homeBoard.includes("Provo Drop") &&
      workBoard.includes("Provo Drop") &&
      !workBoard.includes("SLC Drop"),
    `Home board=${JSON.stringify(homeBoard)}; Work board=${JSON.stringify(workBoard)}`,
  );
  void slcDrop;
  void provoDrop;

  // ========================================================================
  // GATE 3 — drift suggestion never mutates the active address.
  // ========================================================================
  await api("/v1/users/me/active-address", { method: "PUT", token, body: { address_id: homeId } });
  const activeBefore = (await api("/v1/users/me", { token })).body.data.active_address_id;
  const drift = await api(`/v1/users/me/location-drift?lat=40.7580&lng=-73.9855`, { token }); // standing in Manhattan
  const activeAfter = (await api("/v1/users/me", { token })).body.data.active_address_id;
  check(
    "3. drift detects the mismatch and suggests the Manhattan address",
    drift.body.data?.drift_detected === true && drift.body.data?.suggested_label === "Trip",
    `detected=${drift.body.data?.drift_detected} suggested=${drift.body.data?.suggested_label} (active ${drift.body.data?.active_distance_miles}mi, suggested ${drift.body.data?.suggested_distance_miles}mi)`,
  );
  check(
    "3. drift NEVER mutates the active address (unchanged before/after)",
    activeBefore === activeAfter && activeAfter === homeId,
    `before=${activeBefore} after=${activeAfter}`,
  );

  // ========================================================================
  // Home protection + active fallback.
  // ========================================================================
  const delHome = await api(`/v1/addresses/${homeId}`, { method: "DELETE", token });
  check(
    "Home address is undeletable",
    delHome.status === 422 && /home/i.test(JSON.stringify(delHome.body.error ?? "")),
    `${delHome.status} ${JSON.stringify(delHome.body.error ?? delHome.body)}`,
  );

  await api("/v1/users/me/active-address", { method: "PUT", token, body: { address_id: workId } });
  const delWork = await api(`/v1/addresses/${workId}`, { method: "DELETE", token });
  const activeAfterDelete = (await api("/v1/users/me", { token })).body.data.active_address_id;
  check(
    "deleting the active address falls back to Home",
    delWork.status === 200 && delWork.body.data?.active_address_id === homeId && activeAfterDelete === homeId,
    `delete active_address_id=${delWork.body.data?.active_address_id}; /me active=${activeAfterDelete}`,
  );

  // Editing only the label does not re-geocode (permanent cache).
  const before = (await pg.query(`select geocoded_at from addresses where id=$1`, [homeId])).rows[0].geocoded_at;
  await api(`/v1/addresses/${homeId}`, { method: "PATCH", token, body: { label: "Home Base" } });
  const after = (await pg.query(`select geocoded_at from addresses where id=$1`, [homeId])).rows[0].geocoded_at;
  check(
    "label-only edit does not re-geocode (geocoded_at unchanged)",
    String(before) === String(after),
    `before=${before} after=${after}`,
  );

  await pg.end();

  console.log("\nWP-4 acceptance gate against " + BASE + "\n");
  for (const r of results) {
    console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`);
    console.log(`         ${r.detail}`);
  }
  const passed = results.every((r) => r.pass);
  console.log("\n" + (passed ? "GATE PASSED" : "GATE FAILED"));
  process.exit(passed ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
