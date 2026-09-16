/**
 * The four whisper dimensions (PRD §10.5, DATA-MODEL §12). The whisper is
 * anchored on the would-return boolean; these three are 1–5 ratings stored as
 * dim_2 / dim_3 / dim_4. Names are canonical here so the submission form and the
 * operator read-view never drift.
 *
 * "Welcome" measures how a buyer was treated while redeeming a discounted offer —
 * the main failure mode of discount platforms and the thing worth catching early.
 * (There is deliberately no "value for money" dimension: it is meaningless on an
 * already-discounted redemption.)
 */
export const WHISPER_DIMENSIONS = [
  { key: "dim_2", label: "As described" },
  { key: "dim_3", label: "Quality" },
  { key: "dim_4", label: "Welcome" },
] as const;
