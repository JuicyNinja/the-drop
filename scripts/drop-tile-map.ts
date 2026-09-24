/**
 * Drop-tile grammar maps (§15) — shared by the demo seed (which wires each
 * drop to its combo tile) and gen-drop-manifest (which builds the generation
 * list). Offer title → single concrete subject; group slug → ground colour word.
 * The subject/ground/weight triple keys a committed combo tile under
 * public/tiles/drops/_gen/<comboSlug>.webp; the per-drop file is derived from it.
 */

export const SUBJECT: Record<string, string> = {
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
export const GROUND_WORD: Record<string, string> = {
  "food-and-drink": "orange", "grocery-and-specialty-food": "orange", "coffee-and-bakery": "golden yellow",
  "bars-and-nightlife": "brick red", "entertainment": "brick red", "auto": "steel blue", "home-services": "teal",
  "personal-care": "coral blush", "fitness": "mint green", "retail-apparel": "coral blush", "retail-home-and-lifestyle": "bone cream",
};

/** §15 drop-tile prompt: single subject weighted to one third, clean negative space opposite. */
export function prompt(subject: string, ground: string, weight: "left" | "right"): string {
  const empty = weight === "left" ? "right" : "left";
  return `Wide 16:9 tile. ${subject}, a single subject, on a flat solid ${ground} background — a deep, saturated, full-strength ${ground}, the true rich shade, never pale, washed out, or greyed. The subject is placed in the ${weight} third of the frame; the entire ${empty} two-thirds are empty negative space — clean flat ground only, no objects, no shadow reaching into it, held for a text overlay. Shot straight down from directly above, or straight on. One subject only, no duplicates, no scattering. Bright even studio light, soft contact shadow only under the subject, no dramatic or raking light. The background is a single flat uniform color with absolutely no gradient, no shading, no texture, no wall, no surface detail — a solid color fill from edge to edge. No text, no logos, no faces, no hands, no props, no clutter. Clean, flat, graphic, modern, punchy, cheerful.`;
}


/** Offer title from a drop title ("<offer> — <merchant>", or "Encore — <offer>"). */
export function offerOf(title: string): string {
  const h = title.split(" — ");
  return h[0] === "Encore" ? (h[1] ?? h[0]) : h[0];
}
export function subjectFor(title: string): string {
  return SUBJECT[offerOf(title)] ?? "a single representative item";
}
export function groundFor(groupSlug: string): string {
  return GROUND_WORD[groupSlug] ?? "bone cream";
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
/** Stable filename key for a subject×ground combo tile (no truncation → no collisions). */
export function comboSlug(subject: string, ground: string): string {
  return `${slug(subject)}__${slug(ground)}`;
}
