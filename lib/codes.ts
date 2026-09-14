/**
 * The redemption code alphabet and helpers (PRD §7.2). One code per drop.
 *
 * 24 characters, excluding every glyph that fails spoken across a noisy counter
 * or read from a printed card: 0 O 1 I L S 2 Z 8 B. `5` is kept because `S` is
 * excluded. 4 characters → 24⁴ ≈ 331k, scoped per drop.
 */
export const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY345679";

export function mintCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

/** NATO phonetic spelling for staff to read a code aloud (Today's Code). */
const PHONETIC: Record<string, string> = {
  A: "Alpha", C: "Charlie", D: "Delta", E: "Echo", F: "Foxtrot", G: "Golf",
  H: "Hotel", J: "Juliet", K: "Kilo", M: "Mike", N: "November", P: "Papa",
  Q: "Quebec", R: "Romeo", T: "Tango", U: "Uniform", V: "Victor", W: "Whiskey",
  X: "X-ray", Y: "Yankee",
  "3": "Three", "4": "Four", "5": "Five", "6": "Six", "7": "Seven", "9": "Nine",
};

export function phonetic(code: string): string {
  return [...code].map((c) => PHONETIC[c] ?? c).join(" ");
}
