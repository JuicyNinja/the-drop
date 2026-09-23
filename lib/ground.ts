/**
 * The nine group grounds (DESIGN-SYSTEM §15.3). A group's `ground_hex` maps to a
 * stable slug so the same color can be applied through a CSS class rather than an
 * inline style — the strict CSP (no unsafe-inline) forbids a dynamic style attr.
 * One source of truth for the category chips (§15.2.1) and the logo monogram
 * fallback (§4.2), which paints a merchant's initials on its group ground.
 */
export const GROUND_SLUG: Record<string, string> = {
  "#F25C05": "orange", "#F5B428": "amber", "#C0271A": "oxide", "#2E5A78": "steel",
  "#1E7A6F": "teal", "#5E7444": "moss", "#E4826E": "blush", "#58B89C": "mint", "#EDE6D8": "bone",
};

/** Group ground hex → slug; falls back to "bone" (the neutral ground). */
export function groundSlug(hex: string | null): string {
  return (hex && GROUND_SLUG[hex.toUpperCase()]) || "bone";
}
