-- Tile grammar (DESIGN-SYSTEM §15) — SCHEMA only.
-- ground_hex: the group's flat solid ground color. Set ONLY on the 24 group
--   rows (parent_id is null); every leaf inherits its parent's ground at query
--   time (§15.3 — per-leaf tints are forbidden), so leaf ground_hex stays null.
-- tile_style: how a leaf's tile is composed (§15.2.3). Set on all 454 leaves.
--
-- The DATA backfill for both columns lives in supabase/seed/tile-grammar.sql, NOT
-- here: the tag rows are inserted by taxonomy-seed.sql in the seed phase, which
-- runs AFTER every migration. An UPDATE here would run against an empty tags
-- table and populate nothing (which is exactly the bug this split fixes).
alter table tags add column if not exists ground_hex text;
alter table tags add column if not exists tile_style text;
