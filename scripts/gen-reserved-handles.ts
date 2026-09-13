import fs from "node:fs";
import path from "node:path";
import en from "naughty-words/en.json";
import { normalizeHandle } from "@/lib/handles";

/**
 * Generates supabase/seed/reserved-handles.sql from an established open-source
 * profanity list (naughty-words, LDNOOBW-derived) plus platform/system names
 * and platform-adjacent brands. Run: `tsx scripts/gen-reserved-handles.ts`.
 *
 * Never hand-edit the SQL. The profanity list is matched against the same
 * normalized form used for uniqueness (see lib/handles.ts), so f_u_c_k and
 * fuck collapse to one reserved entry.
 */

const SYSTEM = [
  "admin", "administrator", "root", "support", "help", "api", "www", "mail",
  "official", "staff", "team", "moderator", "mod", "security", "billing",
  "legal", "abuse", "noreply", "verify", "login", "signup", "settings",
  "account", "the_drop", "thedrop", "drop", "drops", "catch", "catches",
  "gone", "encore", "whisper", "clout", "board", "wallet", "you", "me",
  "auth", "users", "user", "orgs", "org", "locations", "redemptions",
  "transfers", "follows", "notifications", "health", "ready", "v1", "tags",
  "superstar", "fanatic", "founder",
];

const BRAND = [
  "thedropapp", "dropofficial", "instagram", "tiktok", "google", "apple",
  "stripe", "twilio", "supabase", "vercel", "juicyninja",
];

const shape = (h: string) => /^[a-z0-9_]{3,20}$/.test(h) && /[a-z]/.test(h);

function main(): void {
  const rows = new Map<string, { handle: string; reason: string }>();
  const add = (raw: string, reason: string) => {
    const h = raw.toLowerCase().trim();
    if (!shape(h)) return;
    const key = normalizeHandle(h);
    if (!rows.has(key)) rows.set(key, { handle: h, reason });
  };

  for (const h of SYSTEM) add(h, "system");
  for (const h of BRAND) add(h, "brand");
  for (const w of en as string[]) add(w.replace(/[^a-z0-9_]/gi, ""), "profanity");

  const esc = (s: string) => s.replace(/'/g, "''");
  const values = [...rows.values()]
    .map((r) => `  ('${esc(r.handle)}', '${r.reason}')`)
    .join(",\n");

  const sql = `-- WP-3 reserved handles. Generated from naughty-words (LDNOOBW-derived) plus
-- platform/system and platform-adjacent brand names. Regenerate with
-- scripts/gen-reserved-handles.ts; do not hand-edit. Reserved handles return
-- HANDLE_TAKEN; the namespace never reveals which names are special.
--
-- Uniqueness elsewhere is on normalize_handle(); entries here are compared the
-- same way, so a single canonical spelling per reserved name is enough.

insert into reserved_handles (handle, reason) values
${values}
on conflict (handle) do nothing;
`;

  const out = path.join("supabase", "seed", "reserved-handles.sql");
  fs.writeFileSync(out, sql);
  const counts = [...rows.values()].reduce<Record<string, number>>(
    (a, r) => ((a[r.reason] = (a[r.reason] ?? 0) + 1), a),
    {},
  );
  console.log(`wrote ${out}:`, counts, "total", rows.size);
}

main();
