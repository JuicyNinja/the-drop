import { getServiceClient } from "@/lib/supabase/server";
import { distanceMiles } from "@/lib/geo/distance";
import { getSmsSender } from "@/lib/sms";
import { getEmailSender } from "@/lib/email";
import { getPushSender, type WebPushSubscription } from "@/lib/push";

/**
 * Notifications (PRD §9). The demand engine, and a burst problem: a drop going
 * live to 500 Fanatics must not fire 500 SMS synchronously, and a slow or
 * failing provider must never delay the go-live transition. So the design is a
 * QUEUE:
 *
 *   - ENQUEUE writes `notifications` rows (fast, DB-only, no provider calls) and
 *     is what the triggering event does. `runGoLive` calls enqueueDropLive; the
 *     scheduler tick calls the window-closing / nearly-gone scans. None of them
 *     touch a provider, so none can be blocked by one.
 *   - DISPATCH (its own admin endpoint / cron cadence) drains pending rows and
 *     sends them through the SMS / email / push providers.
 *
 * Idempotency is enforced server-side two ways: enqueue writes one row per
 * (user, event, channel) via ON CONFLICT DO NOTHING on `dedup_key`, so a retried
 * fan-out never duplicates; and dispatch CLAIMS each row with a conditional
 * `sent_at IS NULL → now()` update before sending, so a retried or concurrent
 * dispatcher never sends the same alert twice.
 *
 * No quiet hours (PRD §9.4).
 */

const WINDOW_CLOSING_LEAD_MS = 2 * 60 * 60 * 1000; // 2h default (PRD §9.2)
const NEARLY_GONE_PCT = 0.15; // ~85% claimed

// PostgREST caps an unbounded select at 1000 rows. Every notification scan that
// grows with the user base (the digest's full-users pass, the drop-live radius
// scan, a big drop's holders, a large org's followers) MUST page past that cap,
// or recipients beyond row 1000 are silently dropped. `PAGE` is that cap; the two
// helpers below are the only sanctioned way to read such a set.
const PAGE = 1000;

/** Read every row of a select that can exceed PostgREST's 1000-row cap, paging on
 *  `.range()` until a short page. `page` must apply the same filters each call. */
async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`paginated select failed: ${error.message}`);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** Chunk a large id list into ≤PAGE batches, so both the request URL and each
 *  batch's result stay under the cap. */
function chunk<T>(items: T[], size = PAGE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Channel = "sms" | "push" | "email" | "in_app";

interface Prefs { push: boolean; email: boolean; sms: boolean; digest_hour: number }
const DEFAULT_PREFS: Prefs = { push: true, email: true, sms: true, digest_hour: 8 };

async function prefsFor(userIds: string[]): Promise<Map<string, Prefs>> {
  const out = new Map<string, Prefs>();
  if (userIds.length === 0) return out;
  const svc = getServiceClient();
  // Chunk the id list: an `.in(...)` over >1000 ids would cap its result at 1000,
  // leaving the overflow users on DEFAULT_PREFS (and possibly notified against a
  // disabled channel). One batch per ≤1000 ids returns ≤1000 rows, never capped.
  for (const ids of chunk(userIds)) {
    const { data, error } = await svc
      .from("notification_prefs")
      .select("user_id, push_enabled, email_enabled, sms_enabled, digest_hour_local")
      .in("user_id", ids);
    if (error) throw new Error(`load notification prefs failed: ${error.message}`);
    for (const r of data ?? []) {
      out.set(r.user_id as string, {
        push: r.push_enabled as boolean, email: r.email_enabled as boolean,
        sms: r.sms_enabled as boolean, digest_hour: r.digest_hour_local as number,
      });
    }
  }
  return out;
}
const prefFor = (m: Map<string, Prefs>, uid: string): Prefs => m.get(uid) ?? DEFAULT_PREFS;

interface Row { user_id: string; kind: string; channel: Channel; payload: Record<string, unknown>; ref: string }

/** True when a user's prefs permit a channel. in_app is never gated (no external
 *  cost). Transfer SMS bypasses prefs entirely and is sent by lib/transfers, not
 *  here. */
function allowed(channel: Channel, p: Prefs): boolean {
  if (channel === "in_app") return true;
  if (channel === "push") return p.push;
  if (channel === "email") return p.email;
  if (channel === "sms") return p.sms;
  return false;
}

/** Bulk-enqueue with dedup. dedup_key = '<kind>:<ref>:<channel>'. */
async function enqueue(rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  const insert = rows.map((r) => ({
    user_id: r.user_id, kind: r.kind, channel: r.channel, payload: r.payload,
    dedup_key: `${r.kind}:${r.ref}:${r.channel}`,
  }));
  const { data, error } = await getServiceClient()
    .from("notifications")
    .upsert(insert, { onConflict: "user_id,dedup_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`enqueue notifications failed: ${error.message}`);
  return (data ?? []).length;
}

// ---------------------------------------------------------------------------
// Drop live (the burst). Routing matrix §9.2:
//   Fanatic → SMS + push,  Follower → push + in-app,  category/radius → email.
// ---------------------------------------------------------------------------
export async function enqueueDropLive(dropId: string): Promise<{ enqueued: number }> {
  const svc = getServiceClient();
  const { data: drop, error: dropErr } = await svc.from("drops").select("id, org_id, location_id, title").eq("id", dropId).maybeSingle();
  if (dropErr) throw new Error(`drop-live load drop failed: ${dropErr.message}`);
  if (!drop) return { enqueued: 0 };
  const orgId = drop.org_id as string;
  const title = drop.title as string;
  const payload = { drop_id: dropId, title, event: "drop_live" };

  // A popular org's followers or a broad tag's audience can both exceed 1000, so
  // page every fan-out scan — a truncated audience silently drops recipients.
  const follows = await fetchAllRows<{ user_id: string; tier: string }>(
    (from, to) => svc.from("follows").select("user_id, tier").eq("org_id", orgId).range(from, to),
  );
  const fanatics = follows.filter((f) => f.tier === "fanatic").map((f) => f.user_id);
  const followers = follows.filter((f) => f.tier === "follower").map((f) => f.user_id);
  const following = new Set([...fanatics, ...followers]);

  // Category matches: users whose selected tags intersect the org's tags.
  const { data: orgTags, error: otErr } = await svc.from("org_tags").select("tag_id").eq("org_id", orgId);
  if (otErr) throw new Error(`drop-live org tags failed: ${otErr.message}`);
  const tagIds = (orgTags ?? []).map((t) => t.tag_id as string);
  const categoryUsers = new Set<string>();
  if (tagIds.length > 0) {
    const ut = await fetchAllRows<{ user_id: string }>(
      (from, to) => svc.from("user_tags").select("user_id").in("tag_id", tagIds).range(from, to),
    );
    for (const r of ut) categoryUsers.add(r.user_id);
  }
  // Radius matches: users whose active address is within its radius of the drop
  // location. (v1 computes in JS over active addresses; a spatial query is the
  // production optimization — the addresses_geo GIST index exists for it.)
  if (drop.location_id) {
    const { data: loc, error: locErr } = await svc.from("locations").select("lat, lng").eq("id", drop.location_id as string).maybeSingle();
    if (locErr) throw new Error(`drop-live location load failed: ${locErr.message}`);
    if (loc && loc.lat !== null && loc.lng !== null) {
      const here = { lat: Number(loc.lat), lng: Number(loc.lng) };
      // Global scan over every address, paged past the 1000-row cap. The users
      // embed is disambiguated to the OWNER FK (`addresses_user_id_fkey`) —
      // `addresses` has two relationships to `users` (owner, and users.active_-
      // address_id back to addresses), and a bare `users!inner` is ambiguous and
      // errors. Only the owner's ACTIVE address counts for discovery (§9.2), so we
      // keep an address only when it is that user's active_address_id.
      const addrs = await fetchAllRows<{
        id: string; user_id: string; lat: number | null; lng: number | null; radius_miles: number; users: unknown;
      }>((from, to) =>
        svc.from("addresses")
          .select("id, user_id, lat, lng, radius_miles, users!addresses_user_id_fkey!inner(active_address_id)")
          .range(from, to),
      );
      for (const a of addrs) {
        // supabase-js types a to-one embed as an array; at runtime it is the object.
        const owner = a.users as unknown as { active_address_id: string | null } | null;
        if (a.lat === null || a.lng === null) continue;
        if (a.id !== owner?.active_address_id) continue; // active address only
        if (distanceMiles(here, { lat: Number(a.lat), lng: Number(a.lng) }) <= a.radius_miles) {
          categoryUsers.add(a.user_id); // union of category + radius
        }
      }
    }
  }
  for (const uid of following) categoryUsers.delete(uid); // not following → discovery email only

  const recipients = [...new Set([...fanatics, ...followers, ...categoryUsers])];
  const prefs = await prefsFor(recipients);
  const rows: Row[] = [];
  for (const uid of fanatics) {
    if (allowed("sms", prefFor(prefs, uid))) rows.push({ user_id: uid, kind: "drop_live", channel: "sms", payload, ref: dropId });
    if (allowed("push", prefFor(prefs, uid))) rows.push({ user_id: uid, kind: "drop_live", channel: "push", payload, ref: dropId });
  }
  for (const uid of followers) {
    if (allowed("push", prefFor(prefs, uid))) rows.push({ user_id: uid, kind: "drop_live", channel: "push", payload, ref: dropId });
    rows.push({ user_id: uid, kind: "drop_live", channel: "in_app", payload, ref: dropId });
  }
  for (const uid of categoryUsers) {
    if (allowed("email", prefFor(prefs, uid))) rows.push({ user_id: uid, kind: "drop_live", channel: "email", payload, ref: dropId });
  }
  return { enqueued: await enqueue(rows) };
}

// ---------------------------------------------------------------------------
// Redemption window closing (push, all holders), default 2h before redeem_until.
// ---------------------------------------------------------------------------
export async function enqueueWindowClosing(now: Date = new Date()): Promise<{ enqueued: number }> {
  const svc = getServiceClient();
  const horizon = new Date(now.getTime() + WINDOW_CLOSING_LEAD_MS).toISOString();
  // Live/gone drops whose redemption window closes within the lead time.
  const { data: drops, error: dErr } = await svc
    .from("drops")
    .select("id, title, redeem_until")
    .in("status", ["live", "gone"])
    .not("redeem_until", "is", null)
    .gt("redeem_until", now.toISOString())
    .lte("redeem_until", horizon);
  if (dErr) throw new Error(`window-closing drops query failed: ${dErr.message}`);
  const rows: Row[] = [];
  for (const d of drops ?? []) {
    const dropId = d.id as string;
    // A high-quantity drop can hold >1000 catches; page so no holder misses the
    // closing push.
    const holders = await fetchAllRows<{ user_id: string }>(
      (from, to) => svc.from("catches").select("user_id").eq("drop_id", dropId).eq("status", "held").range(from, to),
    );
    const uids = holders.map((h) => h.user_id);
    const prefs = await prefsFor(uids);
    const payload = { drop_id: dropId, title: d.title as string, redeem_until: d.redeem_until, event: "window_closing" };
    for (const uid of uids) if (allowed("push", prefFor(prefs, uid))) rows.push({ user_id: uid, kind: "window_closing", channel: "push", payload, ref: dropId });
  }
  return { enqueued: await enqueue(rows) };
}

// ---------------------------------------------------------------------------
// Nearly gone (~85% claimed): push to Fanatics + Followers who did NOT catch.
// "Viewed" is taken as "was notified of the drop" (Fanatics + Followers) — v1
// has no per-user view tracking, and the matrix scopes this to those tiers.
// ---------------------------------------------------------------------------
export async function enqueueNearlyGone(now: Date = new Date()): Promise<{ enqueued: number }> {
  void now;
  const svc = getServiceClient();
  const drops = await fetchAllRows<{ id: string; org_id: string; title: string; drop_pressure: unknown }>(
    (from, to) => svc.from("drops").select("id, org_id, title, drop_pressure!inner(pct_remaining)").eq("status", "live").range(from, to),
  );
  const rows: Row[] = [];
  for (const d of drops) {
    const pct = (d.drop_pressure as unknown as { pct_remaining: number } | null)?.pct_remaining;
    if (pct === undefined || pct === null || Number(pct) > NEARLY_GONE_PCT) continue;
    const dropId = d.id;
    const follows = await fetchAllRows<{ user_id: string }>(
      (from, to) => svc.from("follows").select("user_id").eq("org_id", d.org_id).range(from, to),
    );
    const audience = follows.map((f) => f.user_id);
    if (audience.length === 0) continue;
    // Look up prior catches in ≤1000-id batches: a >1000 `.in(...)` would cap its
    // result and under-detect catchers, over-notifying them.
    const caught = new Set<string>();
    for (const ids of chunk(audience)) {
      const { data: caughtRows, error: cErr } = await svc.from("catches").select("original_user_id").eq("drop_id", dropId).in("original_user_id", ids);
      if (cErr) throw new Error(`nearly-gone caught lookup failed: ${cErr.message}`);
      for (const c of caughtRows ?? []) caught.add(c.original_user_id as string);
    }
    const uncaught = audience.filter((u) => !caught.has(u));
    const prefs = await prefsFor(uncaught);
    const payload = { drop_id: dropId, title: d.title as string, event: "nearly_gone" };
    for (const uid of uncaught) if (allowed("push", prefFor(prefs, uid))) rows.push({ user_id: uid, kind: "nearly_gone", channel: "push", payload, ref: dropId });
  }
  return { enqueued: await enqueue(rows) };
}

// ---------------------------------------------------------------------------
// Daily combined digest (email). Sent to each user at their digest_hour_local,
// resolved against their IANA TIMEZONE (DST-correct) — never a UTC hour. The
// timezone is the user's own (defaulted from their Home city at registration),
// falling back to the active address's city timezone, then the launch-market
// default; never UTC. Local matched on the active address's city; Maker/Digital
// on preference tags. One per user per day (dedup on the local date).
// ---------------------------------------------------------------------------

/** The local hour (0–23) in an IANA zone at an instant, DST-correct. */
export function hourInZone(now: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(now);
  const n = parseInt(h, 10);
  return Number.isNaN(n) ? now.getUTCHours() : n % 24; // '24' at midnight → 0
}

/** The local date (YYYY-MM-DD) in an IANA zone — the digest's dedup key, so a
 *  user gets one digest per THEIR day, not per UTC day. */
function dateInZone(now: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p; // en-CA formats as YYYY-MM-DD
}

export async function enqueueDigests(now: Date = new Date()): Promise<{ enqueued: number }> {
  const svc = getServiceClient();
  const { resolveTimezone, DEFAULT_TIMEZONE } = await import("@/lib/cities");

  // Both scans are over the whole user base and MUST page the 1000-row cap — the
  // digest silently skipping everyone past row 1000 is exactly the bug this fixes.
  const prefRows = await fetchAllRows<{ user_id: string; digest_hour_local: number; email_enabled: boolean }>(
    (from, to) => svc.from("notification_prefs").select("user_id, digest_hour_local, email_enabled").range(from, to),
  );
  const prefByUser = new Map<string, { hour: number; email: boolean }>();
  for (const r of prefRows) prefByUser.set(r.user_id, { hour: r.digest_hour_local, email: r.email_enabled });

  const allUsers = await fetchAllRows<{ id: string; timezone: string | null; active_address_id: string | null }>(
    (from, to) => svc.from("users").select("id, timezone, active_address_id").is("deleted_at", null).range(from, to),
  );
  const rows: Row[] = [];
  for (const u of allUsers) {
    const uid = u.id as string;
    const p = prefByUser.get(uid);
    if (p && !p.email) continue; // digest is email; respect the pref
    const wantHour = p?.hour ?? DEFAULT_PREFS.digest_hour;

    // Resolve the timezone: the user's own, else their active address's city,
    // else the launch-market default. Never UTC.
    let tz = (u.timezone as string | null) ?? null;
    if (!tz && u.active_address_id) {
      const { data: addr, error: addrErr } = await svc.from("addresses").select("lat, lng").eq("id", u.active_address_id as string).maybeSingle();
      if (addrErr) throw new Error(`digest address timezone lookup failed: ${addrErr.message}`);
      if (addr?.lat != null && addr?.lng != null) tz = await resolveTimezone(Number(addr.lat), Number(addr.lng));
    }
    tz = tz ?? DEFAULT_TIMEZONE;

    if (hourInZone(now, tz) !== wantHour) continue;
    rows.push({ user_id: uid, kind: "digest", channel: "email", payload: { event: "digest", date: dateInZone(now, tz) }, ref: dateInZone(now, tz) });
  }
  return { enqueued: await enqueue(rows) };
}

// ---------------------------------------------------------------------------
// Dispatch: drain pending rows through the providers, exactly once each.
// ---------------------------------------------------------------------------
export interface DispatchResult { sent: number; failed: number; skipped: number }

export async function dispatchPending(limit = 500): Promise<DispatchResult> {
  const svc = getServiceClient();
  const { data: pending, error: pendErr } = await svc
    .from("notifications")
    .select("id, user_id, kind, channel, payload")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (pendErr) throw new Error(`dispatch pending query failed: ${pendErr.message}`);

  let sent = 0, failed = 0, skipped = 0;
  for (const n of pending ?? []) {
    const id = n.id as string;
    // CLAIM: atomically take the row so a concurrent/retried dispatcher cannot
    // also send it. Only the winner proceeds.
    const { data: claimed, error: claimErr } = await svc.from("notifications").update({ sent_at: new Date().toISOString() }).eq("id", id).is("sent_at", null).select("id");
    if (claimErr) throw new Error(`dispatch claim failed for ${id}: ${claimErr.message}`);
    if (!claimed || claimed.length === 0) { skipped++; continue; }
    try {
      await deliver(n.user_id as string, n.channel as Channel, n.payload as Record<string, unknown>);
      sent++;
    } catch (e) {
      // Delivery failed — release the claim so a later dispatch retries it.
      const { error: relErr } = await svc.from("notifications").update({ sent_at: null }).eq("id", id);
      if (relErr) console.error(`[notifications] release claim after delivery failure also failed for ${id}`, relErr.message);
      failed++;
      console.error(`[notifications] dispatch failed for ${id}`, e instanceof Error ? e.message : e);
    }
  }
  return { sent, failed, skipped };
}

async function deliver(userId: string, channel: Channel, payload: Record<string, unknown>): Promise<void> {
  if (channel === "in_app") return; // delivered by existing as a queryable row
  const svc = getServiceClient();
  const { data: user, error: userErr } = await svc.from("users").select("email, phone").eq("id", userId).maybeSingle();
  if (userErr) throw new Error(`deliver recipient lookup failed: ${userErr.message}`);
  const title = (payload.title as string) ?? "The Drop";
  const body = messageFor(payload);
  if (channel === "email") {
    await getEmailSender().send({ to: (user?.email as string) ?? "", subject: title, text: body });
  } else if (channel === "sms") {
    if (user?.phone) await getSmsSender().send(user.phone as string, body);
  } else if (channel === "push") {
    const { data: subs, error: subsErr } = await svc.from("push_subscriptions").select("endpoint, keys").eq("user_id", userId);
    if (subsErr) throw new Error(`deliver push subscriptions failed: ${subsErr.message}`);
    for (const s of subs ?? []) {
      await getPushSender().send({ endpoint: s.endpoint as string, keys: s.keys as WebPushSubscription["keys"] }, { title, body });
    }
  }
}

// ---------------------------------------------------------------------------
// Preferences, push subscriptions, and the in-app inbox.
// ---------------------------------------------------------------------------
export interface NotificationPrefs { push_enabled: boolean; email_enabled: boolean; sms_enabled: boolean; digest_hour_local: number }

export async function getPrefs(userId: string): Promise<NotificationPrefs> {
  const { data, error } = await getServiceClient().from("notification_prefs").select("push_enabled, email_enabled, sms_enabled, digest_hour_local").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`load notification prefs failed: ${error.message}`);
  return {
    push_enabled: (data?.push_enabled as boolean) ?? DEFAULT_PREFS.push,
    email_enabled: (data?.email_enabled as boolean) ?? DEFAULT_PREFS.email,
    sms_enabled: (data?.sms_enabled as boolean) ?? DEFAULT_PREFS.sms,
    digest_hour_local: (data?.digest_hour_local as number) ?? DEFAULT_PREFS.digest_hour,
  };
}

export async function setPrefs(userId: string, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const svc = getServiceClient();
  const current = await getPrefs(userId);
  const next = { ...current, ...patch };
  const { error } = await svc.from("notification_prefs").upsert({ user_id: userId, ...next }, { onConflict: "user_id" });
  if (error) throw new Error(`set prefs failed: ${error.message}`);
  return next;
}

export async function addPushSubscription(userId: string, endpoint: string, keys: Record<string, unknown>): Promise<{ id: string }> {
  const { data, error } = await getServiceClient().from("push_subscriptions").insert({ user_id: userId, endpoint, keys }).select("id").single();
  if (error) throw new Error(`add push subscription failed: ${error.message}`);
  return { id: data.id as string };
}

export interface InboxItem { id: string; kind: string; channel: string; payload: Record<string, unknown>; read_at: string | null; created_at: string }

export async function listUserNotifications(userId: string, limit = 50): Promise<InboxItem[]> {
  const { data, error } = await getServiceClient()
    .from("notifications")
    .select("id, kind, channel, payload, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`list notifications failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string, kind: r.kind as string, channel: r.channel as string,
    payload: (r.payload as Record<string, unknown>) ?? {}, read_at: (r.read_at as string | null) ?? null, created_at: r.created_at as string,
  }));
}

function messageFor(payload: Record<string, unknown>): string {
  const title = (payload.title as string) ?? "";
  switch (payload.event) {
    case "drop_live": return `${title} just dropped.`;
    case "window_closing": return `Your redemption window for ${title} is closing soon.`;
    case "nearly_gone": return `${title} is almost gone.`;
    case "digest": return `Today's drops near you.`;
    default: return title;
  }
}
