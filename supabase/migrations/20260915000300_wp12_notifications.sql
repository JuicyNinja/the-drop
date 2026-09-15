-- WP-12: notification delivery must be idempotent (one per user per event+channel).

set search_path = public, extensions;

-- A stable per-event key. The fan-out enqueues rows with ON CONFLICT DO NOTHING
-- against this unique index, so a retried enqueue never creates a duplicate and
-- the dispatcher never sends the same alert twice. Shape: '<kind>:<ref>:<channel>'
-- (a Fanatic gets one sms row AND one push row for a drop-live — different
-- channels, so different keys; a retry of either is a no-op).
alter table notifications add column dedup_key text;

-- Full (non-partial) unique index so ON CONFLICT (user_id, dedup_key) DO NOTHING
-- resolves cleanly. dedup_key is nullable and NULLs are distinct, so a row left
-- unkeyed is never constrained; a keyed row is unique per user.
create unique index notifications_dedup on notifications (user_id, dedup_key);
