/* eslint-disable @typescript-eslint/no-explicit-any -- dev gate harness over dynamic JSON responses */
import { Client } from "pg";

/**
 * WP-14 admin gate. Real HTTP API on a running dev server + local Postgres. No
 * endpoint is stubbed. Proves the four gate items with actual output:
 *   1. every admin mutation writes actor, before, after, and IP;
 *   2. the audit log is not updatable or deletable by any role;
 *   3. the transfer-pattern view surfaces one account receiving from many senders;
 *   4. the buyer risk profile is unreachable by any non-admin role — RLS-verified
 *      by connecting AS anon, AS a non-admin, and AS an admin, not asserted from code.
 */

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FOUNDER_ID = "00000000-0000-4000-8000-000000000001";
const TEST_IP = "203.0.113.7"; // TEST-NET-3, unmistakable in the audit trail
const CLIENT = { "x-client": "web", "x-client-version": "1.0.0" };

async function api(p: string, opts: { method?: string; body?: unknown; token?: string; ip?: string; idem?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  const res = await fetch(`${BASE}${p}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const raw = await res.text();
  let body: any = raw; try { body = JSON.parse(raw); } catch { /* keep */ }
  return { status: res.status, body };
}
const subOf = (t: string) => JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8")).sub as string;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });

async function session(email: string): Promise<string> {
  const s = await api("/v1/auth/oauth/start", { method: "POST", body: { provider: "google", return_to: "/" } });
  const c = await api("/v1/auth/oauth/callback", { method: "POST", body: { code: `dev-code:${email}`, state: s.body.data.state } });
  return c.body.data.session.access_token;
}
async function register(email: string, handle: string): Promise<{ token: string; uid: string; handle: string }> {
  const token = await session(email);
  await api("/v1/auth/register/complete", { method: "POST", token, body: { full_name: `N ${handle}`, handle, phone: `+1801${Math.floor(1000000 + Math.random() * 8999999)}`, address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" } } });
  await api("/v1/users/me/location-permission", { method: "POST", token, body: { granted: true } });
  return { token, uid: subOf(token), handle };
}

async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const stamp = Date.now();
  const admin = await session("info@juicyninja.com");
  const adminUid = subOf(admin);

  const auditRow = async (action: string, targetId: string) =>
    (await pg.query(
      `select actor_id, before, after, host(ip_address) as ip from admin_audit_log where action=$1 and target_id=$2 order by occurred_at desc limit 1`,
      [action, targetId],
    )).rows[0] as { actor_id: string; before: any; after: any; ip: string | null } | undefined;

  // =======================================================================
  // GATE 1 — every admin mutation writes actor, before, after, and IP.
  // Exercise one mutation of each kind through the real API with an IP header,
  // then read the audit row back and require all four fields populated.
  // =======================================================================
  const owner = await register(`w14own_${stamp}@t.test`, `w14o${stamp % 100000}`);
  const orgId = (await api("/v1/orgs", { method: "POST", token: owner.token, body: { name: "Gate Org", tier: "local_superstar" } })).body.data.id;
  const victim = await register(`w14vic_${stamp}@t.test`, `w14v${stamp % 100000}`);
  const cityId = (await api("/v1/admin/cities", { token: admin })).body.data[0].id;
  const aTag = (await api("/v1/admin/tags", { token: admin })).body.data.find((t: any) => t.parent_id !== null);

  const mutations: { label: string; call: () => Promise<{ status: number; body: any }>; action: string; target: string }[] = [
    { label: "org.suspend", action: "org.suspend", target: orgId, call: () => api(`/v1/admin/orgs/${orgId}/suspend`, { method: "POST", token: admin, ip: TEST_IP }) },
    { label: "org.update", action: "org.update", target: orgId, call: () => api(`/v1/admin/orgs/${orgId}`, { method: "PATCH", token: admin, ip: TEST_IP, body: { drops_per_cycle: 999 } }) },
    { label: "user.suspend", action: "user.suspend", target: victim.uid, call: () => api(`/v1/admin/users/${victim.uid}/suspend`, { method: "POST", token: admin, ip: TEST_IP, body: { suspended: true } }) },
    { label: "user.clout_freeze", action: "user.clout_freeze", target: victim.uid, call: () => api(`/v1/admin/users/${victim.uid}/clout/freeze`, { method: "POST", token: admin, ip: TEST_IP, body: { frozen: true } }) },
    { label: "city.update", action: "city.update", target: cityId, call: () => api(`/v1/admin/cities/${cityId}`, { method: "PATCH", token: admin, ip: TEST_IP, body: { coldstart_days: 31 } }) },
    { label: "tag.update", action: "tag.update", target: aTag.id, call: () => api(`/v1/admin/tags/${aTag.id}`, { method: "PATCH", token: admin, ip: TEST_IP, body: { sort_order: 7 } }) },
  ];

  for (const m of mutations) {
    const res = await m.call();
    const row = await auditRow(m.action, m.target);
    const ok = res.status === 200 &&
      !!row && row.actor_id === adminUid && row.before !== null && row.after !== null && row.ip === TEST_IP;
    check(`GATE 1 — ${m.label} audited (actor/before/after/ip)`, ok,
      row ? `status ${res.status}; actor=${row.actor_id === adminUid ? "admin✓" : row.actor_id}; before=${row.before !== null ? "set" : "NULL"}; after=${row.after !== null ? "set" : "NULL"}; ip=${row.ip}` : `no audit row (status ${res.status})`);
  }

  // =======================================================================
  // GATE 2 — the audit log is not updatable or deletable by ANY role.
  // Run UPDATE and DELETE against a real row inside a rolled-back savepoint.
  // =======================================================================
  const [seed] = (await pg.query(`select id from admin_audit_log limit 1`)).rows;
  async function expectDbFail(name: string, role: string, sql: string): Promise<void> {
    await pg.query("begin");
    let err: string | null = null;
    try {
      if (role !== "postgres") await pg.query(`set local role ${role}`);
      await pg.query(sql, [seed.id]);
    } catch (e) { err = e instanceof Error ? e.message : String(e); }
    finally { await pg.query("rollback"); }
    check(name, err !== null, err ? `blocked: ${err.split("\n")[0].slice(0, 90)}` : "ALLOWED — gate fails");
  }
  await expectDbFail("GATE 2 — UPDATE admin_audit_log (postgres) blocked", "postgres", `update admin_audit_log set action='tamper' where id=$1`);
  await expectDbFail("GATE 2 — DELETE admin_audit_log (postgres) blocked", "postgres", `delete from admin_audit_log where id=$1`);
  await expectDbFail("GATE 2 — UPDATE admin_audit_log (service_role) blocked", "service_role", `update admin_audit_log set action='tamper' where id=$1`);
  await expectDbFail("GATE 2 — DELETE admin_audit_log (service_role) blocked", "service_role", `delete from admin_audit_log where id=$1`);

  // =======================================================================
  // GATE 3 — transfer-pattern view surfaces one account receiving from many
  // senders. Three senders each catch a drop and transfer to one recipient.
  // =======================================================================
  const owner2 = await register(`w14o2_${stamp}@t.test`, `w14t${stamp % 100000}`);
  const org2 = (await api("/v1/orgs", { method: "POST", token: owner2.token, body: { name: "Transfer Org", tier: "local_superstar" } })).body.data.id;
  const loc2 = (await api(`/v1/orgs/${org2}/locations`, { method: "POST", token: owner2.token, body: { name: "T Loc", line1: "1 Main", city: "Salt Lake City", region: "UT", postal_code: "84101" } })).body.data.id;
  const drop = (await api("/v1/drops", { method: "POST", token: owner2.token, body: { location_id: loc2, title: "Transfer gate drop", description: "d", quantity_total: 3, live_at: iso(-2000), live_until: iso(864e5), redeem_from: iso(-1000), redeem_until: iso(6 * 3600 * 1000), publish: true } })).body.data.id;
  await api("/v1/admin/scheduler/tick", { method: "POST", token: admin });

  const recipient = await register(`w14rcp_${stamp}@t.test`, `w14r${stamp % 100000}`);
  const senders = [] as { token: string; uid: string; handle: string }[];
  for (let i = 0; i < 3; i++) senders.push(await register(`w14s${i}_${stamp}@t.test`, `w14s${i}${stamp % 100000}`));

  let transferred = 0;
  for (const s of senders) {
    const caught = await api("/v1/catches", { method: "POST", token: s.token, ip: "10.0.0.9", idem: `${stamp}-${s.handle}`, body: { drop_id: drop } });
    const catchId = caught.body?.data?.catch_id;
    if (!catchId) continue;
    const tr = await api("/v1/transfers", { method: "POST", token: s.token, body: { catch_id: catchId, to_handle: recipient.handle } });
    const trId = tr.body?.data?.transfer_id;
    if (!trId) continue;
    const acc = await api(`/v1/transfers/${trId}/accept`, { method: "POST", token: recipient.token });
    if (acc.status === 200) transferred++;
  }

  const patterns = await api("/v1/admin/fraud/transfer-patterns", { token: admin });
  const rHit = (patterns.body?.data ?? []).find((r: any) => r.user_id === recipient.uid);
  check("GATE 3 — transfer-pattern view surfaces the many-sender recipient",
    !!rHit && rHit.distinct_senders >= 3,
    rHit ? `@${rHit.user_handle}: distinct_senders=${rHit.distinct_senders}, received=${rHit.transfers_received} (transferred ${transferred}/3)` : `recipient not surfaced (transferred ${transferred}/3)`);

  // =======================================================================
  // GATE 4 — buyer risk profile unreachable by any non-admin role. RLS verified
  // by connecting AS anon, AS a non-admin, and AS an admin. Recompute first so
  // rows exist for the admin to see.
  // =======================================================================
  const recompute = await api("/v1/admin/fraud/risk/recompute", { method: "POST", token: admin });
  const profiles = recompute.body?.data?.profiles ?? 0;

  async function countAs(role: string, sub: string | null): Promise<number | string> {
    await pg.query("begin");
    try {
      await pg.query(`set local role ${role}`);
      if (sub) await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role })]);
      const n = (await pg.query(`select count(*)::int as n from buyer_risk_profiles`)).rows[0].n as number;
      return n;
    } catch (e) { return `denied: ${(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 60)}`; }
    finally { await pg.query("rollback"); }
  }

  const asAnon = await countAs("anon", null);
  const asNonAdmin = await countAs("authenticated", senders[0].uid);
  const asAdmin = await countAs("authenticated", FOUNDER_ID);

  check("GATE 4 — RLS: anon sees zero risk profiles", asAnon === 0, `anon count = ${asAnon} (recomputed ${profiles} profiles total)`);
  check("GATE 4 — RLS: non-admin authenticated sees zero risk profiles", asNonAdmin === 0, `non-admin count = ${asNonAdmin}`);
  check("GATE 4 — RLS: admin authenticated sees the risk profiles", typeof asAdmin === "number" && asAdmin > 0, `admin count = ${asAdmin}`);

  // The endpoint itself is admin-only: a non-admin token is 403, admin is 200.
  const nonAdminHit = await api(`/v1/admin/users/${senders[0].uid}/risk`, { token: senders[0].token });
  const adminHit = await api(`/v1/admin/users/${recipient.uid}/risk`, { token: admin });
  check("GATE 4 — endpoint admin-only: non-admin → 403", nonAdminHit.status === 403, `non-admin GET risk → ${nonAdminHit.status} (${nonAdminHit.body?.error?.code ?? ""})`);
  check("GATE 4 — endpoint admin-only: admin → 200", adminHit.status === 200, `admin GET risk → ${adminHit.status}`);

  await pg.end();

  // ---- Report -----------------------------------------------------------
  console.log("\n=== WP-14 ADMIN GATE ===\n");
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}\n      ${r.detail}`);
  }
  console.log(`\n${allPass ? "ALL PASS" : "FAILURES PRESENT"} — ${results.filter((r) => r.pass).length}/${results.length}\n`);
  if (!allPass) process.exit(1);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
