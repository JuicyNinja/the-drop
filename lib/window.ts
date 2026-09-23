/**
 * Redemption windows (PRD §4.4). A drop has an OUTER date range
 * (`redeem_from`..`redeem_until`) which is the final close and catch-expiry, plus
 * an optional recurring DAILY window (`redeem_days` + `redeem_time_start`/`_end`)
 * interpreted in the location's city timezone. `redeem_days` is null for a single
 * continuous window (JS day-of-week: 0=Sun … 6=Sat when present).
 *
 * This module is the one place that (a) decides whether a redemption is inside the
 * daily window, (b) computes the next opening for a closed-window error, and (c)
 * formats a window into natural language for the card, drop detail, wallet, and
 * the code sheet.
 */

export interface RedeemWindow {
  redeem_from: string | null;
  redeem_until: string | null;
  redeem_days: number[] | null;
  redeem_time_start: string | null; // "HH:MM" or "HH:MM:SS"
  redeem_time_end: string | null;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseHHMM(t: string | null): { h: number; m: number } | null {
  if (!t) return null;
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return Number.isFinite(h) && Number.isFinite(m) ? { h, m } : null;
}

/** The bare clock, no meridiem: "10", "3:50", "12" — minutes dropped when :00. */
function clockCore(h: number, m: number): string {
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr}` : `${hr}:${String(m).padStart(2, "0")}`;
}
const meridiem = (h: number): "am" | "pm" => (h < 12 ? "am" : "pm");

/** "10am", "3:50pm", "12pm" — minutes dropped when :00. */
export function fmtClock(h: number, m: number): string {
  return `${clockCore(h, m)}${meridiem(h)}`;
}

/** A clock range, collapsing a shared meridiem: "3–6pm", "10am–3:50pm". */
function fmtClockRange(sh: number, sm: number, eh: number, em: number): string {
  const sap = meridiem(sh), eap = meridiem(eh);
  const start = sap === eap ? clockCore(sh, sm) : `${clockCore(sh, sm)}${sap}`;
  return `${start}–${clockCore(eh, em)}${eap}`;
}

/** City-local parts of a UTC instant. */
function localParts(instant: Date, tz: string): { y: number; mo: number; d: number; dow: number; minutes: number } {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(instant)) p[part.type] = part.value;
  const dow = DAY_SHORT.indexOf(p.weekday);
  const hour = p.hour === "24" ? 0 : parseInt(p.hour, 10); // Intl can emit "24" at midnight
  return { y: +p.year, mo: +p.month, d: +p.day, dow, minutes: hour * 60 + parseInt(p.minute, 10) };
}

/** The tz offset (ms) at a given UTC instant, so a wall-clock time can be resolved to UTC. */
function tzOffsetMs(utc: number, tz: string): number {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(utc))) p[part.type] = part.value;
  const h = p.hour === "24" ? 0 : +p.hour;
  return Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second) - utc;
}

/** A city-local wall time (Y-M-D HH:MM in tz) → the UTC instant it names. */
function zonedToUtc(y: number, mo: number, d: number, h: number, m: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, m, 0);
  return new Date(guess - tzOffsetMs(guess, tz));
}

/** Is `now` inside the daily window? True when there is no daily window (continuous). */
export function isDailyWindowOpen(w: RedeemWindow, tz: string, now: Date = new Date()): boolean {
  if (!w.redeem_days || w.redeem_days.length === 0) return true; // continuous
  const start = parseHHMM(w.redeem_time_start);
  const end = parseHHMM(w.redeem_time_end);
  if (!start || !end) return true;
  const { dow, minutes } = localParts(now, tz);
  if (!w.redeem_days.includes(dow)) return false;
  const s = start.h * 60 + start.m, e = end.h * 60 + end.m;
  return minutes >= s && minutes < e;
}

/** Next daily opening at/after `now`, bounded by redeem_until; null if none/continuous. */
export function nextDailyOpen(w: RedeemWindow, tz: string, now: Date = new Date()): Date | null {
  if (!w.redeem_days || w.redeem_days.length === 0) return null;
  const start = parseHHMM(w.redeem_time_start);
  if (!start) return null;
  const until = w.redeem_until ? new Date(w.redeem_until).getTime() : Infinity;
  for (let i = 0; i < 8; i++) {
    const probe = new Date(now.getTime() + i * 86_400_000);
    const { y, mo, d, dow } = localParts(probe, tz);
    if (!w.redeem_days.includes(dow)) continue;
    const open = zonedToUtc(y, mo, d, start.h, start.m, tz);
    if (open.getTime() > now.getTime() && open.getTime() <= until) return open;
  }
  return null;
}

/** "Weekdays", "Weekends", "Tuesday", "Tue & Thu", "Mon, Wed & Fri", "Daily". */
function daysLabel(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return "Daily";
  const isWeekdays = set.length === 5 && [1, 2, 3, 4, 5].every((d) => set.includes(d));
  if (isWeekdays) return "Weekdays";
  const isWeekend = set.length === 2 && set.includes(0) && set.includes(6);
  if (isWeekend) return "Weekends";
  if (set.length === 1) return DAY_FULL[set[0]];
  const names = set.map((d) => DAY_SHORT[d]);
  return names.length === 2 ? `${names[0]} & ${names[1]}` : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/**
 * Natural-language window: "Weekdays 10am–3:50pm", "Tue & Thu 3–6pm",
 * "Tuesday 10am–3:50pm". A continuous window (no redeem_days) reads as its
 * city-local day/date range: same day → "Tuesday 10am–3:50pm", else a date range.
 */
export function formatRedeemWindow(w: RedeemWindow, tz: string): string {
  if (w.redeem_days && w.redeem_days.length > 0) {
    const s = parseHHMM(w.redeem_time_start), e = parseHHMM(w.redeem_time_end);
    if (s && e) return `${daysLabel(w.redeem_days)} ${fmtClockRange(s.h, s.m, e.h, e.m)}`;
  }
  if (!w.redeem_from || !w.redeem_until) return "";
  const a = localParts(new Date(w.redeem_from), tz), b = localParts(new Date(w.redeem_until), tz);
  if (a.y === b.y && a.mo === b.mo && a.d === b.d) {
    return `${DAY_FULL[a.dow]} ${fmtClockRange(Math.floor(a.minutes / 60), a.minutes % 60, Math.floor(b.minutes / 60), b.minutes % 60)}`;
  }
  const md = (p: typeof a) => `${DAY_SHORT[p.dow]} ${p.mo}/${p.d}`;
  const clockA = fmtClock(Math.floor(a.minutes / 60), a.minutes % 60);
  const clockB = fmtClock(Math.floor(b.minutes / 60), b.minutes % 60);
  return `${md(a)} ${clockA} – ${md(b)} ${clockB}`;
}

// ---------------------------------------------------------------------------
// "Redeemable when" board filter (PRD §4.4). A drop matches when its redemption
// window is OPEN AT ALL during the selected time band — planning ahead, not
// "open right now": catch tonight, redeem at breakfast. All bands are resolved
// in the LOCATION city timezone, server-side.
// ---------------------------------------------------------------------------

/** Start of the next city-local day (00:00) after `now`, as a UTC instant. */
function nextLocalMidnight(now: Date, tz: string): Date {
  const p = localParts(now, tz);
  return zonedToUtc(p.y, p.mo, p.d + 1, 0, 0, tz); // Date.UTC rolls over month/year
}

/**
 * Does the drop's redemption window overlap the band [from, to)? "Overlap" =
 * there is at least one instant in the band at which the drop is redeemable.
 * The band is first clipped to the outer range (redeem_from..redeem_until); a
 * continuous window is redeemable throughout it, a recurring one only on its
 * days during its daily hours (checked per city-local day the band spans).
 */
export function windowOverlaps(w: RedeemWindow, tz: string, from: Date, to: Date): boolean {
  let s = from.getTime();
  let e = to.getTime();
  if (w.redeem_from) s = Math.max(s, new Date(w.redeem_from).getTime());
  if (w.redeem_until) e = Math.min(e, new Date(w.redeem_until).getTime());
  if (s >= e) return false; // band does not intersect the outer range

  if (!w.redeem_days || w.redeem_days.length === 0) return true; // continuous → open throughout
  const start = parseHHMM(w.redeem_time_start), end = parseHHMM(w.redeem_time_end);
  if (!start || !end) return true; // malformed daily window → treat as continuous (matches isDailyWindowOpen)

  // Walk each city-local day the clipped band touches; bands are short (hours to
  // a weekend), so this is a handful of iterations.
  for (let cursor = s, i = 0; cursor < e && i < 400; i++) {
    const p = localParts(new Date(cursor), tz);
    if (w.redeem_days.includes(p.dow)) {
      const open = zonedToUtc(p.y, p.mo, p.d, start.h, start.m, tz).getTime();
      const close = zonedToUtc(p.y, p.mo, p.d, end.h, end.m, tz).getTime();
      if (Math.max(s, open) < Math.min(e, close)) return true;
    }
    cursor = nextLocalMidnight(new Date(cursor), tz).getTime();
  }
  return false;
}

export type RedeemPreset = "now" | "tonight" | "tomorrow_morning" | "tomorrow" | "this_weekend";

export interface RedeemFilterSpec {
  preset?: RedeemPreset;
  // Custom band: a specific city-local date (YYYY-MM-DD) + HH:MM start/end.
  date?: string;
  start?: string;
  end?: string;
}

/**
 * Resolve a filter spec to a concrete [from, to) band of UTC instants, in the
 * city timezone. Bands that include "today" are clamped to start no earlier than
 * `now`, so an already-closed slot earlier today never matches. Returns null when
 * the spec is empty or malformed (→ no filter).
 *
 * Band boundaries (city-local): Now = now→end of today; Tonight = 5pm→midnight;
 * Tomorrow morning = 6–11am tomorrow; Tomorrow = all of tomorrow; This weekend =
 * Saturday 00:00 → end of Sunday.
 */
export function resolveRedeemFilter(spec: RedeemFilterSpec, tz: string, now: Date = new Date()): { from: Date; to: Date } | null {
  const p = localParts(now, tz);
  const at = (y: number, mo: number, d: number, h: number, m: number) => zonedToUtc(y, mo, d, h, m, tz);
  const endOfDay = (d: number) => at(p.y, p.mo, d + 1, 0, 0); // exclusive: next midnight
  const clampFrom = (from: Date, to: Date): { from: Date; to: Date } | null => {
    const f = new Date(Math.max(now.getTime(), from.getTime()));
    return f.getTime() < to.getTime() ? { from: f, to } : null;
  };

  switch (spec.preset) {
    case "now": return clampFrom(now, endOfDay(p.d));
    case "tonight": return clampFrom(at(p.y, p.mo, p.d, 17, 0), endOfDay(p.d));
    case "tomorrow_morning": return clampFrom(at(p.y, p.mo, p.d + 1, 6, 0), at(p.y, p.mo, p.d + 1, 11, 0));
    case "tomorrow": return clampFrom(at(p.y, p.mo, p.d + 1, 0, 0), endOfDay(p.d + 1));
    case "this_weekend": {
      const daysToSat = (6 - p.dow + 7) % 7; // 0=Sun..6=Sat → days until Saturday (0 if today is Sat)
      const satD = p.d + daysToSat;
      return clampFrom(at(p.y, p.mo, satD, 0, 0), at(p.y, p.mo, satD + 2, 0, 0)); // Sat 00:00 → end of Sun
    }
  }
  if (spec.date && spec.start && spec.end) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spec.date);
    const s = parseHHMM(spec.start), e = parseHHMM(spec.end);
    if (m && s && e) {
      const to = at(+m[1], +m[2], +m[3], e.h, e.m);
      return clampFrom(at(+m[1], +m[2], +m[3], s.h, s.m), to);
    }
  }
  return null;
}
