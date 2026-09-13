import fs from "node:fs";
import path from "node:path";
import { Client, DatabaseError } from "pg";

/**
 * WP-2 acceptance gate.
 *
 * Every operation below MUST fail at the database layer. The harness runs
 * each one inside a savepoint against a real Postgres, records the actual
 * SQLSTATE and message, and rolls the savepoint back. Nothing here mocks or
 * stubs the database: if Postgres lets an operation through, the check fails.
 *
 * Also verifies the seed (taxonomy counts, founder as user_number 1, cities,
 * empty badges), seed idempotency, deletion behaviour, and the RLS posture.
 */

export const LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export interface SqlError {
  code: string;
  message: string;
  constraint?: string;
}

export interface GateCheck {
  id: string;
  title: string;
  role: string;
  sql: string;
  /** The error Postgres raised. Null means the statement was allowed: a failure. */
  error: SqlError | null;
  passed: boolean;
}

export interface GateFact {
  label: string;
  value: string;
  ok: boolean;
}

export interface GateReport {
  databaseUrl: string;
  checks: GateCheck[];
  facts: GateFact[];
  passed: boolean;
}

const FOUNDER_ID = "00000000-0000-4000-8000-000000000001";
const INSTANCE_ID = "00000000-0000-0000-0000-000000000000";

type Role = "postgres" | "authenticated" | "service_role" | "anon";

function toSqlError(error: unknown): SqlError {
  if (error instanceof DatabaseError) {
    return {
      code: error.code ?? "?????",
      message: error.message,
      constraint: error.constraint ?? undefined,
    };
  }
  return { code: "?????", message: String(error) };
}

export async function runGate(
  databaseUrl: string = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  projectRoot: string = process.cwd(),
): Promise<GateReport> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const checks: GateCheck[] = [];
  const facts: GateFact[] = [];

  const q = async <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ) => (await client.query<T>(sql, params)).rows;

  /** Run `sql` as `role`; the check passes only if Postgres raises. */
  async function expectFail(
    id: string,
    title: string,
    sql: string,
    params: unknown[] = [],
    role: Role = "postgres",
    claims?: Record<string, unknown>,
  ): Promise<void> {
    await client.query("savepoint gate");
    let error: SqlError | null = null;
    try {
      if (role !== "postgres") {
        await client.query(`set local role ${role}`);
        if (claims) {
          await client.query("select set_config('request.jwt.claims', $1, true)", [
            JSON.stringify(claims),
          ]);
        }
      }
      const result = await client.query(sql, params);
      // Reached only if Postgres allowed it. A zero-row UPDATE/DELETE is still
      // "allowed" and therefore still a failure of the gate.
      error = null;
      void result;
    } catch (e) {
      error = toSqlError(e);
    } finally {
      await client.query("rollback to savepoint gate");
      await client.query("release savepoint gate");
    }
    checks.push({ id, title, role, sql: sql.replace(/\s+/g, " ").trim(), error, passed: error !== null });
  }

  function fact(label: string, value: unknown, ok: boolean): void {
    facts.push({ label, value: String(value), ok });
  }

  try {
    await client.query("begin");

    // -----------------------------------------------------------------------
    // Seed facts (read before fixtures touch anything)
    // -----------------------------------------------------------------------
    const [founder] = await q<{
      id: string; user_number: string; handle: string; full_name: string; email: string;
      email_verified_at: string | null; phone_verified_at: string | null;
      location_perm_granted_at: string | null;
    }>("select id, user_number, handle, full_name, email, email_verified_at, phone_verified_at, location_perm_granted_at from users where email = 'info@juicyninja.com'");

    // Keyed on the founder's email, not on sequence position, so the gate does
    // not depend on a pristine DB: later packages register real users and
    // advance user_number_seq, but the founder is always number 1.
    fact("founder user_number (by email) is 1", founder?.user_number ?? "missing", founder?.user_number === "1");
    fact("founder identity", founder ? `${founder.full_name} / @${founder.handle} / ${founder.email}` : "missing",
      founder?.full_name === "Tad Timothy" && founder?.handle === "tad" && founder?.email === "info@juicyninja.com");
    fact("founder id is the auth uid", founder?.id ?? "missing", founder?.id === FOUNDER_ID);
    fact("founder email_verified_at / phone_verified_at / location_perm_granted_at",
      founder ? `${founder.email_verified_at} / ${founder.phone_verified_at} / ${founder.location_perm_granted_at}` : "missing",
      !!founder && founder.email_verified_at === null && founder.phone_verified_at === null && founder.location_perm_granted_at === null);

    const [authRow] = await q<{ n: string }>("select count(*)::text as n from auth.users where id = $1 and email = 'info@juicyninja.com'", [FOUNDER_ID]);
    fact("founder auth.users row exists", authRow.n, authRow.n === "1");

    const [adminRole] = await q<{ n: string }>("select count(*)::text as n from user_roles where user_id = $1 and role = 'admin'", [FOUNDER_ID]);
    fact("founder holds admin role", adminRole.n, adminRole.n === "1");

    const [reserved] = await q<{ reason: string }>("select reason from reserved_handles where handle = 'tad'");
    fact("handle 'tad' reserved", reserved?.reason ?? "missing", reserved?.reason === "system");

    const nextUserNumber = async () =>
      (await q<{ next: string }>(
        "select (case when is_called then last_value + 1 else last_value end)::text as next from user_number_seq",
      ))[0].next;
    const seqBefore = await nextUserNumber();
    // Founder consumed 1, so the next value is always ≥ 2. The exact value
    // depends on how many real users exist, which is not the gate's concern —
    // the idempotency check below (before === after) is what matters.
    fact("next user_number is past the founder (≥ 2)", seqBefore, Number(seqBefore) >= 2);

    const [tags] = await q<{ groups: string; leaves: string; synonyms: string; local: string; maker: string; digital: string }>(`
      select
        count(*) filter (where parent_id is null)::text as groups,
        count(*) filter (where parent_id is not null)::text as leaves,
        coalesce(sum(cardinality(synonyms)), 0)::text as synonyms,
        count(*) filter (where lanes @> array['local']::lane[])::text as local,
        count(*) filter (where lanes @> array['maker']::lane[])::text as maker,
        count(*) filter (where lanes @> array['digital']::lane[])::text as digital
      from tags`);
    fact("taxonomy groups", tags.groups, tags.groups === "24");
    fact("taxonomy leaves", tags.leaves, tags.leaves === "454");
    fact("taxonomy synonyms", tags.synonyms, tags.synonyms === "1305");
    fact("taxonomy lane coverage local/maker/digital", `${tags.local}/${tags.maker}/${tags.digital}`,
      tags.local === "413" && tags.maker === "115" && tags.digital === "52");
    const [badGroups] = await q<{ n: string }>("select count(*)::text as n from tags where parent_id is null and (selectable or cardinality(lanes) > 0)");
    fact("groups unselectable with empty lanes", `${badGroups.n} violations`, badGroups.n === "0");

    const cities = await q<{ name: string; active: boolean; launched_at: string | null }>("select name, active, launched_at from cities order by name");
    fact("cities seeded", cities.map((c) => `${c.name} (active=${c.active}, launched_at=${c.launched_at})`).join("; "),
      cities.length === 2 && cities.every((c) => !c.active && c.launched_at === null) &&
      cities.some((c) => c.name === "Salt Lake City") && cities.some((c) => c.name === "Provo"));

    const [badges] = await q<{ n: string }>("select count(*)::text as n from badges");
    fact("badges seeded (open product decision)", badges.n, badges.n === "0");

    // Seed idempotency: run base.sql again inside this transaction.
    const seedSql = fs.readFileSync(path.join(projectRoot, "supabase", "seed", "base.sql"), "utf8");
    await client.query(seedSql);
    const [afterSeed] = await q<{ users: string; founders: string; next: string; cities: string }>(`
      select (select count(*) from users)::text as users,
             (select count(*) from users where email = 'info@juicyninja.com')::text as founders,
             (select (case when is_called then last_value + 1 else last_value end) from user_number_seq)::text as next,
             (select count(*) from cities)::text as cities`);
    fact("base.sql re-run: founder rows / cities", `${afterSeed.founders} / ${afterSeed.cities}`,
      afterSeed.founders === "1" && afterSeed.cities === "2");
    fact("user_number_seq did not advance across seed re-run (before → after)",
      `${seqBefore} → ${afterSeed.next}`, afterSeed.next === seqBefore);

    // RLS posture.
    const [rls] = await q<{ off: string; write_policies: string }>(`
      select (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity)::text as off,
             (select count(*) from pg_policies where schemaname = 'public' and cmd <> 'SELECT')::text as write_policies`);
    fact("public tables with RLS disabled", rls.off, rls.off === "0");
    fact("non-SELECT RLS policies (any role)", rls.write_policies, rls.write_policies === "0");
    const [privs] = await q<{ a: boolean; b: boolean; c: boolean; d: boolean }>(`
      select has_table_privilege('authenticated', 'catches', 'insert') as a,
             has_table_privilege('anon', 'drops', 'update') as b,
             has_table_privilege('service_role', 'clout_events', 'update') as c,
             has_table_privilege('service_role', 'admin_audit_log', 'delete') as d`);
    fact("authenticated INSERT on catches / anon UPDATE on drops", `${privs.a} / ${privs.b}`, !privs.a && !privs.b);
    fact("service_role UPDATE clout_events / DELETE admin_audit_log", `${privs.c} / ${privs.d}`, !privs.c && !privs.d);

    // -----------------------------------------------------------------------
    // Fixtures (all inside the transaction, rolled back at the end)
    // -----------------------------------------------------------------------
    const users: Record<"a" | "b", string> = {
      a: "00000000-0000-4000-8000-00000000aaaa",
      b: "00000000-0000-4000-8000-00000000bbbb",
    };
    for (const [key, id] of Object.entries(users)) {
      await q(`insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ($1, $2, 'authenticated', 'authenticated', $3, '{}', '{}', now(), now())`,
        [id, INSTANCE_ID, `gate-${key}@example.test`]);
      // Explicit user_number: sequences are non-transactional, so letting the
      // default nextval() run here would advance user_number_seq even though
      // the whole gate rolls back. The gate must be repeatable without a reset.
      await q(`insert into users (id, user_number, handle, full_name, email, phone) values ($1, $2, $3, $4, $5, $6)`,
        [id, key === "a" ? 90000001 : 90000002, `gate_${key}`, `Gate ${key.toUpperCase()}`, `gate-${key}@example.test`, `+1999000000${key === "a" ? "1" : "2"}`]);
    }

    const orgIds: string[] = [];
    for (let i = 1; i <= 11; i++) {
      const [row] = await q<{ id: string }>(
        `insert into organizations (name, lane, tier, max_locations, drops_per_cycle, cycle_anchor_at)
         values ($1, 'local', 'local_starter', 1, 2, now()) returning id`,
        [`Gate Org ${i}`],
      );
      orgIds.push(row.id);
    }
    const [city] = await q<{ id: string }>("select id from cities where name = 'Salt Lake City'");
    const [location] = await q<{ id: string }>(
      `insert into locations (org_id, name, line1, city, region, postal_code, lat, lng, city_id)
       values ($1, 'Gate Location', '1 Main St', 'Salt Lake City', 'UT', '84101', 40.7608, -111.8910, $2) returning id`,
      [orgIds[0], city.id],
    );

    const [drop] = await q<{ id: string; redeem_until: string }>(
      `insert into drops (lane, org_id, location_id, city_id, title, description, quantity_total, quantity_remaining,
                          redeem_from, redeem_until, created_by)
       values ('local', $1, $2, $3, 'Gate Drop', 'Fixture', 10, 10, now(), now() + interval '1 day', $4)
       returning id, redeem_until`,
      [orgIds[0], location.id, city.id, FOUNDER_ID],
    );
    await q("update drops set status = 'scheduled' where id = $1", [drop.id]);
    await q("update drops set status = 'live' where id = $1", [drop.id]);
    await q("update drops set quantity_remaining = 9 where id = $1", [drop.id]);
    const [dropState] = await q<{ status: string; quantity_remaining: number }>("select status, quantity_remaining from drops where id = $1", [drop.id]);
    fact("fixture drop is live with remaining decreased to 9 (decrease allowed)",
      `${dropState.status} / ${dropState.quantity_remaining}`, dropState.status === "live" && dropState.quantity_remaining === 9);

    const [catchRow] = await q<{ id: string }>(
      `insert into catches (drop_id, user_id, original_user_id, position_number, code, expires_at)
       values ($1, $2, $2, 1, 'ACDE', $3) returning id`,
      [drop.id, users.a, drop.redeem_until],
    );
    const [clout] = await q<{ id: string }>(
      "insert into clout_events (user_id, source, points, city_id) values ($1, 'redemption', 10, $2) returning id",
      [users.a, city.id],
    );
    const [audit] = await q<{ id: string }>(
      "insert into admin_audit_log (actor_id, action, target_type) values ($1, 'gate.fixture', 'test') returning id",
      [FOUNDER_ID],
    );
    const [order] = await q<{ id: string }>(
      `insert into orders (catch_id, drop_id, buyer_id, org_id, subtotal_cents, total_cents, ship_to)
       values ($1, $2, $3, $4, 100, 100, '{}') returning id`,
      [catchRow.id, drop.id, users.a, orgIds[0]],
    );
    for (let i = 0; i < 10; i++) {
      await q("insert into follows (user_id, org_id, lane, tier) values ($1, $2, 'local', 'fanatic')", [users.a, orgIds[i]]);
    }
    const [fanatics] = await q<{ n: string }>("select count(*)::text as n from follows where user_id = $1 and tier = 'fanatic'", [users.a]);
    fact("fixture: 10 Fanatic follows accepted in lane local", fanatics.n, fanatics.n === "10");

    const adminClaims = { sub: FOUNDER_ID, role: "authenticated" };

    // -----------------------------------------------------------------------
    // The eleven operations (BUILD-PLAN WP-2 acceptance gate)
    // -----------------------------------------------------------------------

    // 1. UPDATE a live drop's frozen fields
    await expectFail("1a", "UPDATE live drop quantity_total", "update drops set quantity_total = 11 where id = $1", [drop.id]);
    await expectFail("1b", "UPDATE live drop price_cents", "update drops set price_cents = 100 where id = $1", [drop.id]);
    await expectFail("1c", "UPDATE live drop terms", "update drops set terms = 'changed' where id = $1", [drop.id]);
    await expectFail("1d", "UPDATE live drop title", "update drops set title = 'changed' where id = $1", [drop.id]);
    await expectFail("1e", "UPDATE live drop description", "update drops set description = 'changed' where id = $1", [drop.id]);
    await expectFail("1f", "UPDATE live drop redeem_from", "update drops set redeem_from = redeem_from - interval '1 hour' where id = $1", [drop.id]);
    await expectFail("1g", "UPDATE live drop redeem_until", "update drops set redeem_until = redeem_until + interval '1 hour' where id = $1", [drop.id]);

    // 2. UPDATE quantity_remaining upward on a live drop
    await expectFail("2", "UPDATE quantity_remaining upward on live drop (9 → 10)", "update drops set quantity_remaining = quantity_remaining + 1 where id = $1", [drop.id]);

    // 3. Second catch for the same original_user_id on the same drop
    await expectFail("3", "INSERT second catch for same original_user_id on same drop",
      "insert into catches (drop_id, user_id, original_user_id, position_number, code, expires_at) values ($1, $2, $3, 2, 'FGHJ', $4)",
      [drop.id, users.b, users.a, drop.redeem_until]);

    // 4. Duplicate position_number on the same drop
    await expectFail("4", "INSERT duplicate position_number on same drop",
      "insert into catches (drop_id, user_id, original_user_id, position_number, code, expires_at) values ($1, $2, $2, 1, 'KMNP', $3)",
      [drop.id, users.b, drop.redeem_until]);

    // 5. UPDATE a user_number
    await expectFail("5", "UPDATE user_number", "update users set user_number = 999 where id = $1", [FOUNDER_ID]);

    // 6. UPDATE a handle twice
    await q("update users set handle = 'gate_a_renamed' where id = $1", [users.a]);
    const [renamed] = await q<{ handle: string; locked: boolean }>("select handle, handle_changed_at is not null as locked from users where id = $1", [users.a]);
    fact("first handle change allowed and locks the handle", `${renamed.handle} / locked=${renamed.locked}`, renamed.handle === "gate_a_renamed" && renamed.locked);
    await expectFail("6", "UPDATE handle a second time", "update users set handle = 'gate_a_again' where id = $1", [users.a]);

    // 7. 11th Fanatic follow in one lane
    await expectFail("7", "INSERT 11th Fanatic follow in lane local",
      "insert into follows (user_id, org_id, lane, tier) values ($1, $2, 'local', 'fanatic')", [users.a, orgIds[10]]);

    // 8. UPDATE or DELETE clout_events as any role including admin
    await expectFail("8a", "UPDATE clout_events as postgres (table owner)", "update clout_events set points = 999 where id = $1", [clout.id]);
    await expectFail("8b", "DELETE clout_events as postgres (table owner)", "delete from clout_events where id = $1", [clout.id]);
    await expectFail("8c", "UPDATE clout_events as authenticated admin (founder JWT)", "update clout_events set points = 999 where id = $1", [clout.id], "authenticated", adminClaims);
    await expectFail("8d", "DELETE clout_events as authenticated admin (founder JWT)", "delete from clout_events where id = $1", [clout.id], "authenticated", adminClaims);
    await expectFail("8e", "UPDATE clout_events as service_role (the server)", "update clout_events set points = 999 where id = $1", [clout.id], "service_role");
    await expectFail("8f", "DELETE clout_events as service_role (the server)", "delete from clout_events where id = $1", [clout.id], "service_role");

    // 9. UPDATE or DELETE admin_audit_log as any role including admin
    await expectFail("9a", "UPDATE admin_audit_log as postgres (table owner)", "update admin_audit_log set action = 'rewritten' where id = $1", [audit.id]);
    await expectFail("9b", "DELETE admin_audit_log as postgres (table owner)", "delete from admin_audit_log where id = $1", [audit.id]);
    await expectFail("9c", "UPDATE admin_audit_log as authenticated admin (founder JWT)", "update admin_audit_log set action = 'rewritten' where id = $1", [audit.id], "authenticated", adminClaims);
    await expectFail("9d", "DELETE admin_audit_log as authenticated admin (founder JWT)", "delete from admin_audit_log where id = $1", [audit.id], "authenticated", adminClaims);
    await expectFail("9e", "UPDATE admin_audit_log as service_role (the server)", "update admin_audit_log set action = 'rewritten' where id = $1", [audit.id], "service_role");
    await expectFail("9f", "DELETE admin_audit_log as service_role (the server)", "delete from admin_audit_log where id = $1", [audit.id], "service_role");

    // 10. rmas row with refunded_at set and received_at null
    await expectFail("10", "INSERT rmas with refunded_at set and received_at null",
      "insert into rmas (order_id, reason, refund_amount_cents, refunded_at, received_at) values ($1, 'buyer_error', 80, now(), null)", [order.id]);

    // 11. drops row with lane='local' and status='submitted'
    await expectFail("11", "INSERT drops with lane='local' and status='submitted'",
      `insert into drops (lane, org_id, location_id, status, title, description, quantity_total, quantity_remaining, created_by)
       values ('local', $1, $2, 'submitted', 'x', 'x', 1, 1, $3)`, [orgIds[0], location.id, FOUNDER_ID]);
    const [draftDrop] = await q<{ id: string }>(
      `insert into drops (lane, org_id, location_id, title, description, quantity_total, quantity_remaining, created_by)
       values ('local', $1, $2, 'Gate Draft', 'Fixture', 1, 1, $3) returning id`, [orgIds[0], location.id, FOUNDER_ID]);
    await expectFail("11b", "UPDATE local drop draft → submitted", "update drops set status = 'submitted' where id = $1", [draftDrop.id]);
    await expectFail("11c", "UPDATE local drop draft → approved", "update drops set status = 'approved' where id = $1", [draftDrop.id]);
    await expectFail("11d", "INSERT drops with status='live' (must start as draft)",
      `insert into drops (lane, org_id, location_id, status, title, description, quantity_total, quantity_remaining, created_by)
       values ('local', $1, $2, 'live', 'x', 'x', 1, 1, $3)`, [orgIds[0], location.id, FOUNDER_ID]);

    // -----------------------------------------------------------------------
    // Deletion behaviour (decision 2026-09-12): an auth user cannot be
    // deleted while a users row exists; users and catches are never removed.
    // -----------------------------------------------------------------------
    await expectFail("D1", "DELETE auth.users for a user who holds a catch", "delete from auth.users where id = $1", [users.a]);
    await expectFail("D2", "DELETE users row (account deletion is a status, not a removal)", "delete from users where id = $1", [users.a]);
    await expectFail("D3", "DELETE catches row as postgres", "delete from catches where id = $1", [catchRow.id]);
    await expectFail("D4", "DELETE catches row as service_role", "delete from catches where id = $1", [catchRow.id], "service_role");
    await expectFail("D5", "UPDATE catches position_number", "update catches set position_number = 2 where id = $1", [catchRow.id]);
    const [stillThere] = await q<{ n: string; holder: string }>("select count(*)::text as n, min(user_id::text) as holder from catches where id = $1", [catchRow.id]);
    fact("catch survives every deletion attempt, holder intact", `${stillThere.n} row(s), holder ${stillThere.holder === users.a ? "unchanged" : "CHANGED"}`,
      stillThere.n === "1" && stillThere.holder === users.a);

    // Negative control: a well-formed insert that SHOULD succeed, proving the
    // fixtures are not failing for unrelated reasons.
    await client.query("savepoint control");
    let controlOk = false;
    try {
      await q("insert into catches (drop_id, user_id, original_user_id, position_number, code, expires_at) values ($1, $2, $2, 2, 'QRTU', $3)",
        [drop.id, users.b, drop.redeem_until]);
      controlOk = true;
    } catch (e) {
      fact("control insert error", toSqlError(e).message, false);
    } finally {
      await client.query("rollback to savepoint control");
    }
    fact("control: a valid second catch (new original user, new position) is accepted", String(controlOk), controlOk);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }

  const passed = checks.every((c) => c.passed) && facts.every((f) => f.ok);
  return { databaseUrl: databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@"), checks, facts, passed };
}

export function formatGateReport(report: GateReport): string {
  const lines: string[] = [];
  lines.push(`WP-2 acceptance gate against ${report.databaseUrl}`);
  lines.push("");
  lines.push("OPERATIONS THAT MUST FAIL AT THE DATABASE LAYER");
  for (const c of report.checks) {
    const status = c.passed ? "FAIL AS REQUIRED" : "ALLOWED (GATE FAILURE)";
    const err = c.error
      ? `${c.error.code}${c.error.constraint ? ` [${c.error.constraint}]` : ""}: ${c.error.message}`
      : "statement succeeded";
    lines.push(`  [${c.passed ? "PASS" : "FAIL"}] ${c.id.padEnd(3)} ${c.title}  (as ${c.role})`);
    lines.push(`         ${status} → ${err}`);
  }
  lines.push("");
  lines.push("FACTS");
  for (const f of report.facts) {
    lines.push(`  [${f.ok ? "PASS" : "FAIL"}] ${f.label}: ${f.value}`);
  }
  lines.push("");
  lines.push(report.passed ? "GATE PASSED" : "GATE FAILED");
  return lines.join("\n");
}
