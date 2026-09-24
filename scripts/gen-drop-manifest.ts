/* eslint-disable @typescript-eslint/no-explicit-any -- dev tooling */
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { tileWeight } from "../lib/tile-weight";
import { subjectFor, groundFor, prompt } from "./drop-tile-map";

/**
 * Builds the drop-tile generation manifest: one entry per drop with its subject,
 * ground color word, and left/right weighting (§15.4/§15.5). Read-only over the DB;
 * writes a JSON the operator (me) drives the Runware MCP from. No images here.
 */
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OUT = process.argv[2] ?? "scratchpad/drop-tiles.json";

// offer title → single concrete subject (§15.4: merchant contributes the subject only).
async function main(): Promise<void> {
  const pg = new Client({ connectionString: DB }); await pg.connect();
  const rows = (await pg.query(`
    select distinct on (d.id) d.id, d.title, d.status,
      gp.slug gslug, (d.quantity_remaining::float / d.quantity_total) pct
    from drops d
    join org_tags ot on ot.org_id = d.org_id
    join tags leaf on leaf.id = ot.tag_id
    join tags gp on gp.id = leaf.parent_id
    order by d.id`)).rows as any[];
  const out = rows.map((r) => {
    const subject = subjectFor(String(r.title));
    const ground = groundFor(r.gslug as string);
    const weight = tileWeight(r.id) as "left" | "right";
    return { id: r.id as string, file: `${r.id}.webp`, status: r.status as string, pct: Number(r.pct), gslug: r.gslug as string, weight, subject, ground, prompt: prompt(subject, ground, weight) };
  });
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  const byGround: Record<string, number> = {}; for (const o of out) byGround[o.ground] = (byGround[o.ground] ?? 0) + 1;
  const left = out.filter((o) => o.weight === "left").length;
  console.log(`wrote ${out.length} drop-tile manifest entries → ${OUT}`);
  console.log(`weighting: left ${left}  right ${out.length - left}`);
  console.log(`grounds:`, JSON.stringify(byGround));
  const missing = out.filter((o) => o.subject === "a single representative item").map((o) => o.id);
  if (missing.length) console.log(`WARN unmatched subjects: ${missing.length}`);
  await pg.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
