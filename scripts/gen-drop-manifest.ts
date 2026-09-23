/* eslint-disable @typescript-eslint/no-explicit-any -- dev tooling */
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { tileWeight } from "../lib/tile-weight";

/**
 * Builds the drop-tile generation manifest: one entry per drop with its subject,
 * ground color word, and left/right weighting (§15.4/§15.5). Read-only over the DB;
 * writes a JSON the operator (me) drives the Runware MCP from. No images here.
 */
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OUT = process.argv[2] ?? "scratchpad/drop-tiles.json";

// offer title → single concrete subject (§15.4: merchant contributes the subject only).
const SUBJECT: Record<string, string> = {
  "Half-off first entrée": "a single plated restaurant entrée", "$5 street tacos": "three street tacos on a small plate",
  "Two entrées, one price": "a single plated dinner entrée", "Free appetizer with entrée": "a shareable appetizer plate",
  "Buy one, get one latte": "a latte with leaf art in a ceramic cup", "$2 morning pastry": "a single flaky croissant",
  "Half-off a dozen": "a bakery box of a dozen donuts", "Free drip with any bag": "a bag of coffee beans beside a paper cup",
  "$6 house cocktail": "a single craft cocktail in a coupe glass", "Two-for-one drafts": "a full pint of amber draft beer",
  "Half-off the bottle list": "a bottle of red wine and a filled glass",
  "$29 oil change": "a bottle of motor oil and a clean oil filter", "Free brake inspection": "a set of car brake pads",
  "$99 four-tire rotation & align": "a single car tire with deep tread",
  "$79 drain clearing": "a red sink plunger and a pipe wrench", "Half-off first clean": "a stack of folded white towels and a spray bottle",
  "Free in-home estimate": "a clipboard with a pen and a set of house keys",
  "$25 cut & style": "a pair of barber scissors and a comb", "Half-off first color": "a hair-color brush and a mixing bowl",
  "$15 beard trim & line": "a straight razor and a comb",
  "First month free": "a single chrome dumbbell", "$10 day pass, unlimited": "a black kettlebell", "Half-off intro class pack": "a rolled yoga mat",
  "$5 matinee": "a red-striped bucket of popcorn", "$20 arcade play card": "a red arcade joystick", "Two tickets, one price": "two paper movie ticket stubs",
  "30% off one item": "a folded denim jacket", "$40 off sneakers": "a single white sneaker", "Buy two, third half off": "a neatly folded t-shirt",
  "25% off one piece": "a ceramic vase", "$15 candle bar": "a lit scented candle in a glass jar",
  "Half-off the cheese counter": "a wedge of aged cheese", "$10 butcher box": "a raw steak on butcher paper", "Free loaf with $25": "a rustic loaf of bread",
};
const GROUND_WORD: Record<string, string> = {
  "food-and-drink": "orange", "grocery-and-specialty-food": "orange", "coffee-and-bakery": "golden yellow",
  "bars-and-nightlife": "brick red", "entertainment": "brick red", "auto": "steel blue", "home-services": "teal",
  "personal-care": "coral blush", "fitness": "mint green", "retail-apparel": "coral blush", "retail-home-and-lifestyle": "bone cream",
};

/** §15 drop-tile prompt: single subject weighted to one third, clean negative space opposite. */
function prompt(subject: string, ground: string, weight: "left" | "right"): string {
  const empty = weight === "left" ? "right" : "left";
  return `Wide 16:9 tile. ${subject}, a single subject, on a flat solid ${ground} background — a deep, saturated, full-strength ${ground}, the true rich shade, never pale, washed out, or greyed. The subject is placed in the ${weight} third of the frame; the entire ${empty} two-thirds are empty negative space — clean flat ground only, no objects, no shadow reaching into it, held for a text overlay. Shot straight down from directly above, or straight on. One subject only, no duplicates, no scattering. Bright even studio light, soft contact shadow only under the subject, no dramatic or raking light. The background is a single flat uniform color with absolutely no gradient, no shading, no texture, no wall, no surface detail — a solid color fill from edge to edge. No text, no logos, no faces, no hands, no props, no clutter. Clean, flat, graphic, modern, punchy, cheerful.`;
}

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
    const head = String(r.title).split(" — ");
    const offerTitle = head[0] === "Encore" ? head[1] : head[0];
    const subject = SUBJECT[offerTitle] ?? "a single representative item";
    const ground = GROUND_WORD[r.gslug] ?? "bone cream";
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
