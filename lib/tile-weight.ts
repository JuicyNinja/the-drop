/**
 * Drop-tile subject weighting (DESIGN-SYSTEM §15.5): tiles alternate left- and
 * right-weighted by drop ID, and the coupon-print type block flips to the empty
 * side to match. This is the single source of truth for that parity — the tile
 * generator weights the subject to this side, and the card overlays the coupon
 * print on the opposite side, so the two never disagree.
 */
export type TileWeight = "left" | "right";

/** Deterministic left/right by the drop id's last hex nibble. */
export function tileWeight(id: string): TileWeight {
  const hex = id.replace(/[^0-9a-fA-F]/g, "");
  const n = hex.length ? parseInt(hex.slice(-1), 16) : 0;
  return n % 2 === 0 ? "left" : "right";
}

/** The side the coupon print overlays — always opposite the subject. */
export function couponSide(id: string): TileWeight {
  return tileWeight(id) === "left" ? "right" : "left";
}
