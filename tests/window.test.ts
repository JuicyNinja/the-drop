import { describe, expect, it } from "vitest";
import {
  fmtClock,
  isDailyWindowOpen,
  nextDailyOpen,
  formatRedeemWindow,
  windowOverlaps,
  resolveRedeemFilter,
  type RedeemWindow,
} from "@/lib/window";

const MT = "America/Denver";

// A continuous window (null days): the outer range only.
const continuous = (from: string, until: string): RedeemWindow => ({
  redeem_from: from, redeem_until: until, redeem_days: null, redeem_time_start: null, redeem_time_end: null,
});
// A recurring daily window on the given JS DOWs, city-local times.
const daily = (days: number[], start: string, end: string, until = "2027-01-01T00:00:00Z"): RedeemWindow => ({
  redeem_from: "2026-01-01T00:00:00Z", redeem_until: until, redeem_days: days, redeem_time_start: start, redeem_time_end: end,
});

describe("fmtClock", () => {
  it("drops :00 minutes and uses am/pm", () => {
    expect(fmtClock(10, 0)).toBe("10am");
    expect(fmtClock(15, 50)).toBe("3:50pm");
    expect(fmtClock(0, 0)).toBe("12am");
    expect(fmtClock(12, 0)).toBe("12pm");
  });
});

describe("isDailyWindowOpen", () => {
  it("a continuous window is always open", () => {
    expect(isDailyWindowOpen(continuous("2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z"), MT)).toBe(true);
  });

  it("is open inside the daily window on a valid day", () => {
    // Tuesday 2026-09-22, 11:00 MT = 17:00Z
    const w = daily([2], "10:00", "15:50");
    expect(isDailyWindowOpen(w, MT, new Date("2026-09-22T17:00:00Z"))).toBe(true);
  });

  it("is closed before the window opens on a valid day", () => {
    const w = daily([2], "10:00", "15:50");
    // Tuesday 09:00 MT = 15:00Z
    expect(isDailyWindowOpen(w, MT, new Date("2026-09-22T15:00:00Z"))).toBe(false);
  });

  it("is closed at exactly the closing time (end-exclusive)", () => {
    const w = daily([2], "10:00", "15:50");
    // Tuesday 15:50 MT = 21:50Z
    expect(isDailyWindowOpen(w, MT, new Date("2026-09-22T21:50:00Z"))).toBe(false);
  });

  it("is closed on a day not in the set", () => {
    const w = daily([2], "10:00", "15:50");
    // Wednesday 2026-09-23, 11:00 MT
    expect(isDailyWindowOpen(w, MT, new Date("2026-09-23T17:00:00Z"))).toBe(false);
  });
});

describe("nextDailyOpen", () => {
  it("returns null for a continuous window", () => {
    expect(nextDailyOpen(continuous("2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z"), MT)).toBeNull();
  });

  it("finds the next opening later the same day", () => {
    const w = daily([2], "10:00", "15:50");
    // Tuesday 08:00 MT = 14:00Z → opens 10:00 MT = 16:00Z
    const next = nextDailyOpen(w, MT, new Date("2026-09-22T14:00:00Z"));
    expect(next?.toISOString()).toBe("2026-09-22T16:00:00.000Z");
  });

  it("rolls to the next valid day when today is closed", () => {
    const w = daily([2, 4], "10:00", "15:50"); // Tue & Thu
    // Wednesday 12:00 MT → next is Thursday 10:00 MT = 2026-09-24T16:00Z
    const next = nextDailyOpen(w, MT, new Date("2026-09-23T18:00:00Z"));
    expect(next?.toISOString()).toBe("2026-09-24T16:00:00.000Z");
  });

  it("returns null when the next opening is past the final close", () => {
    const w = daily([2], "10:00", "15:50", "2026-09-22T12:00:00Z"); // closes before next Tue open
    const next = nextDailyOpen(w, MT, new Date("2026-09-22T20:00:00Z"));
    expect(next).toBeNull();
  });
});

describe("formatRedeemWindow", () => {
  it("labels weekdays", () => {
    expect(formatRedeemWindow(daily([1, 2, 3, 4, 5], "10:00", "15:50"), MT)).toBe("Weekdays 10am–3:50pm");
  });
  it("labels weekends", () => {
    expect(formatRedeemWindow(daily([0, 6], "09:00", "12:00"), MT)).toBe("Weekends 9am–12pm");
  });
  it("labels a single day in full", () => {
    expect(formatRedeemWindow(daily([2], "10:00", "15:50"), MT)).toBe("Tuesday 10am–3:50pm");
  });
  it("labels two days with an ampersand", () => {
    expect(formatRedeemWindow(daily([2, 4], "15:00", "18:00"), MT)).toBe("Tue & Thu 3–6pm");
  });
  it("labels three days with a serial ampersand", () => {
    expect(formatRedeemWindow(daily([1, 3, 5], "15:00", "18:00"), MT)).toBe("Mon, Wed & Fri 3–6pm");
  });
  it("a continuous same-day window reads as its city-local day and clock", () => {
    // Tuesday 2026-09-22 10:00–15:50 MT = 16:00Z–21:50Z
    const w = continuous("2026-09-22T16:00:00Z", "2026-09-22T21:50:00Z");
    expect(formatRedeemWindow(w, MT)).toBe("Tuesday 10am–3:50pm");
  });
});

// A fixed "now": Monday 2026-09-21, 12:00 MDT (UTC-6) = 18:00Z. Tomorrow is Tue 09-22.
const NOW = new Date("2026-09-21T18:00:00Z");
const wideOuter = { redeem_from: "2026-01-01T00:00:00Z", redeem_until: "2027-01-01T00:00:00Z" };
const recur = (days: number[], start: string, end: string): RedeemWindow => ({ ...wideOuter, redeem_days: days, redeem_time_start: start, redeem_time_end: end });

describe("resolveRedeemFilter (bands in the city timezone)", () => {
  it("tomorrow_morning is 6–11am tomorrow, city-local", () => {
    const b = resolveRedeemFilter({ preset: "tomorrow_morning" }, MT, NOW)!;
    // Tue 09-22 06:00 MDT = 12:00Z; 11:00 MDT = 17:00Z
    expect(b.from.toISOString()).toBe("2026-09-22T12:00:00.000Z");
    expect(b.to.toISOString()).toBe("2026-09-22T17:00:00.000Z");
  });
  it("tonight is 5pm→midnight today, clamped to now", () => {
    const b = resolveRedeemFilter({ preset: "tonight" }, MT, NOW)!;
    // 5pm MDT today = 23:00Z; midnight = next day 06:00Z
    expect(b.from.toISOString()).toBe("2026-09-21T23:00:00.000Z");
    expect(b.to.toISOString()).toBe("2026-09-22T06:00:00.000Z");
  });
  it("empty spec → null (no filter)", () => {
    expect(resolveRedeemFilter({}, MT, NOW)).toBeNull();
  });
});

describe("windowOverlaps (open at all during the band)", () => {
  const morning = resolveRedeemFilter({ preset: "tomorrow_morning" }, MT, NOW)!;
  const tonight = resolveRedeemFilter({ preset: "tonight" }, MT, NOW)!;

  it("a drop open tomorrow 7–10am overlaps Tomorrow morning", () => {
    expect(windowOverlaps(recur([2], "07:00", "10:00"), MT, morning.from, morning.to)).toBe(true);
  });
  it("the same drop does NOT overlap Tonight", () => {
    expect(windowOverlaps(recur([2], "07:00", "10:00"), MT, tonight.from, tonight.to)).toBe(false);
  });
  it("a drop open tomorrow 2–5pm does NOT overlap Tomorrow morning (6–11am)", () => {
    expect(windowOverlaps(recur([2], "14:00", "17:00"), MT, morning.from, morning.to)).toBe(false);
  });
  it("a continuous drop within its outer range overlaps any band", () => {
    expect(windowOverlaps(continuous("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"), MT, morning.from, morning.to)).toBe(true);
  });
  it("outer range gates overlap: a drop whose outer close precedes the band does not match", () => {
    const w: RedeemWindow = { redeem_from: "2026-09-01T00:00:00Z", redeem_until: "2026-09-10T00:00:00Z", redeem_days: null, redeem_time_start: null, redeem_time_end: null };
    expect(windowOverlaps(w, MT, morning.from, morning.to)).toBe(false);
  });
});
