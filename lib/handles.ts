/**
 * Handle format, normalization, and confusable collapsing.
 *
 * Handles are permanent, public, and tied to position numbers and clout, so
 * impersonation is the thing that makes that system worthless. Two defenses:
 *
 *  1. A tight format (below), validated identically here and in the client.
 *  2. A normalized form stored alongside the handle, with uniqueness enforced
 *     on the normalized form, so t_a_d, tad, and t0d cannot coexist.
 *
 * `normalizeHandle` MUST stay byte-for-byte equivalent to the SQL
 * `normalize_handle()` in the WP-3 migration. A test pins them together.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

export interface HandleProblem {
  rule: string;
  message: string;
}

/**
 * Validate a raw handle. Returns the lowercased handle when valid, or a
 * problem naming the specific rule broken (never a generic "invalid handle").
 */
export function validateHandle(
  raw: string,
): { ok: true; handle: string } | { ok: false; problem: HandleProblem } {
  const handle = raw.toLowerCase();

  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return {
      ok: false,
      problem: {
        rule: "length",
        message: `Handle must be ${HANDLE_MIN}–${HANDLE_MAX} characters.`,
      },
    };
  }
  if (!/^[a-z0-9_]+$/.test(handle)) {
    return {
      ok: false,
      problem: {
        rule: "charset",
        message: "Handle may use only lowercase letters, digits, and underscore.",
      },
    };
  }
  if (handle.startsWith("_") || handle.endsWith("_")) {
    return {
      ok: false,
      problem: {
        rule: "underscore_edge",
        message: "Handle may not start or end with an underscore.",
      },
    };
  }
  if (handle.includes("__")) {
    return {
      ok: false,
      problem: {
        rule: "underscore_run",
        message: "Handle may not contain consecutive underscores.",
      },
    };
  }
  if (!/[a-z]/.test(handle)) {
    return {
      ok: false,
      problem: {
        rule: "needs_letter",
        message: "Handle must contain at least one letter.",
      },
    };
  }
  return { ok: true, handle };
}

/**
 * The confusable-collapsed form used for uniqueness. Order is load-bearing and
 * must match SQL normalize_handle(): multi-character maps first (rn→m, vv→w),
 * then single-character homoglyphs (0→o, 1→l, 5→s), then strip underscores.
 */
export function normalizeHandle(handle: string): string {
  return handle
    .toLowerCase()
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .replace(/5/g, "s")
    .replace(/_/g, "");
}
