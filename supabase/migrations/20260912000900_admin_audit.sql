-- WP-2 / DATA-MODEL §16 admin_audit_log. Every admin action writes here.
-- Append-only for every role including admin (CLAUDE.md invariant #14),
-- enforced by trigger, by revoked privileges (RLS migration), and by the
-- absence of any UPDATE or DELETE policy.

set search_path = public, extensions;

create table admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid not null references users(id),
  action        text not null,
  target_type   text not null,
  target_id     uuid,
  before        jsonb,
  after         jsonb,
  ip_address    inet,
  occurred_at   timestamptz not null default now()
);

create index on admin_audit_log (actor_id, occurred_at desc);
create index on admin_audit_log (target_type, target_id);

create trigger trg_admin_audit_log_no_update before update on admin_audit_log
  for each row execute function forbid_row_update();
create trigger trg_admin_audit_log_no_delete before delete on admin_audit_log
  for each row execute function forbid_row_delete();
