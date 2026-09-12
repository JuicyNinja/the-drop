-- WP-2 / DATA-MODEL §17 row-level security.
--
-- Model (decided 2026-09-12 from CLAUDE.md precedence, invariants #7 and #15):
--   * RLS is enabled on every table.
--   * API roles (anon, authenticated) hold SELECT only. No client writes
--     anywhere: every mutation goes through /v1, which uses service_role.
--   * Policies below are all SELECT policies. There is no INSERT, UPDATE, or
--     DELETE policy on any table for any role.
--   * clout_events and admin_audit_log additionally lose UPDATE and DELETE
--     from service_role, so even the server cannot rewrite the ledgers.
--   * Public read exists only where the product surface is public: taxonomy,
--     cities, badges, organizations, locations, live and Gone drops, ranking
--     pressure, merchant scores, and a profile view limited to handle and
--     user_number (the auth uid is never exposed).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Helpers. security definer with a pinned search_path so RLS on user_roles
-- does not recurse into itself.
-- ---------------------------------------------------------------------------
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function is_org_owner(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles
    where user_id = auth.uid() and role = 'merchant_owner' and org_id = org
  );
$$;

create or replace function owns_drop(drop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from drops d
    join user_roles r on r.org_id = d.org_id
    where d.id = drop and r.user_id = auth.uid() and r.role = 'merchant_owner'
  );
$$;

create or replace function owns_order(ord uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from orders o
    where o.id = ord and (o.buyer_id = auth.uid() or is_org_owner(o.org_id))
  );
$$;

revoke all on function is_admin() from public;
revoke all on function is_org_owner(uuid) from public;
revoke all on function owns_drop(uuid) from public;
revoke all on function owns_order(uuid) from public;
grant execute on function is_admin() to anon, authenticated, service_role;
grant execute on function is_org_owner(uuid) to anon, authenticated, service_role;
grant execute on function owns_drop(uuid) to anon, authenticated, service_role;
grant execute on function owns_order(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges. Clients read; only the server writes.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

-- Ledgers: not even the server may rewrite them.
revoke update, delete, truncate on clout_events    from service_role;
revoke update, delete, truncate on admin_audit_log from service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- SELECT policies. §17 baseline plus the public surfaces.
-- ---------------------------------------------------------------------------

-- users: self or admin. Public read is the limited view below.
create policy users_select on users for select
  using (id = auth.uid() or is_admin());

create view public_profiles with (security_invoker = false) as
  select handle, user_number from users where deleted_at is null;
grant select on public_profiles to anon, authenticated, service_role;

create policy user_roles_select on user_roles for select
  using (user_id = auth.uid() or is_admin());

create policy reserved_handles_select on reserved_handles for select
  using (is_admin());

-- addresses: self only. Never exposed to merchants.
create policy addresses_select on addresses for select
  using (user_id = auth.uid());

-- Public surfaces.
create policy cities_select        on cities        for select using (true);
create policy tags_select          on tags          for select using (true);
create policy org_tags_select      on org_tags      for select using (true);
create policy organizations_select on organizations for select using (true);
create policy locations_select     on locations     for select using (true);
create policy badges_select        on badges        for select using (true);
create policy user_badges_select   on user_badges   for select using (true);
create policy drop_pressure_select on drop_pressure for select using (true);
create policy merchant_scores_select on merchant_scores for select using (true);

create policy user_tags_select on user_tags for select
  using (user_id = auth.uid());

create policy drop_allowance_usage_select on drop_allowance_usage for select
  using (is_org_owner(org_id) or is_admin());

-- drops: the board sees live drops and Gone stays browsable forever
-- (invariant #11). Drafts and the approval pipeline are owner and admin only.
create policy drops_select on drops for select
  using (
    status in ('live', 'gone', 'expired', 'encore_pending')
    or is_org_owner(org_id)
    or is_admin()
  );

-- catches: current holder reads own. Merchant reads catches on own drops.
create policy catches_select on catches for select
  using (user_id = auth.uid() or owns_drop(drop_id) or is_admin());

-- redemptions: redeeming user + owning org + admin.
create policy redemptions_select on redemptions for select
  using (user_id = auth.uid() or owns_drop(drop_id) or is_admin());

-- transfers: sender + recipient + admin.
create policy transfers_select on transfers for select
  using (from_user_id = auth.uid() or to_user_id = auth.uid() or is_admin());

create policy follows_select on follows for select
  using (user_id = auth.uid() or is_admin());

-- clout_events: self read only. No insert path from any client.
create policy clout_events_select on clout_events for select
  using (user_id = auth.uid());

create policy clout_scores_select on clout_scores for select
  using (user_id = auth.uid() or is_admin());

create policy share_links_select on share_links for select
  using (user_id = auth.uid() or is_admin());

-- whispers: author + owning org + admin. Never public, no exceptions.
create policy whispers_select on whispers for select
  using (user_id = auth.uid() or is_org_owner(org_id) or is_admin());

create policy notification_prefs_select on notification_prefs for select
  using (user_id = auth.uid());
create policy notifications_select on notifications for select
  using (user_id = auth.uid());
create policy push_subscriptions_select on push_subscriptions for select
  using (user_id = auth.uid());

-- Phase 2: buyer + owning org + admin.
create policy orders_select on orders for select
  using (buyer_id = auth.uid() or is_org_owner(org_id) or is_admin());
create policy invoices_select on invoices for select
  using (owns_order(order_id) or is_admin());
create policy rmas_select on rmas for select
  using (owns_order(order_id) or is_admin());

create policy maker_agreements_select on maker_agreements for select
  using (user_id = auth.uid() or is_org_owner(org_id) or is_admin());
create policy takedown_notices_select on takedown_notices for select
  using (is_admin());
create policy infringement_strikes_select on infringement_strikes for select
  using (is_admin());

-- admin_audit_log: admin read. No update or delete policy on any role.
create policy admin_audit_log_select on admin_audit_log for select
  using (is_admin());
