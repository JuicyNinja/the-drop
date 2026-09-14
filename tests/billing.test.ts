import { describe, expect, it } from "vitest";
import { currentCycle, scopeLocation } from "@/lib/billing/allowance";
import { seedLimitsFor, upgradeOptions, isSelfServeTier } from "@/lib/billing/tiers";

describe("tier catalog (seed/presentation only)", () => {
  it("seeds self-serve limits from the ladder", () => {
    expect(seedLimitsFor("local_starter")).toEqual({ max_locations: 1, drops_per_cycle: 2, pooled: false });
    expect(seedLimitsFor("local_superstar")).toEqual({ max_locations: 8, drops_per_cycle: 64, pooled: true });
  });

  it("does not treat enterprise as self-serve", () => {
    expect(isSelfServeTier("local_enterprise")).toBe(false);
    expect(() => seedLimitsFor("local_enterprise")).toThrow();
  });

  it("offers only higher-ranked tiers as upgrades, with proration", () => {
    const end = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(); // ~half a cycle
    const { options } = upgradeOptions("local_starter", "drops", end);
    const tiers = options.map((o) => o.tier);
    expect(tiers).toEqual(["local_limited", "local_boss", "local_superstar"]);
    // ~half the cycle remains, so prorated is roughly half the price.
    const limited = options.find((o) => o.tier === "local_limited")!;
    expect(limited.drops_per_cycle).toBe(8);
    expect(limited.prorated_now_cents).toBeGreaterThan(6000);
    expect(limited.prorated_now_cents).toBeLessThan(8000);
  });

  it("routes to enterprise contact when nothing self-serve is higher", () => {
    expect(upgradeOptions("local_superstar", "locations", new Date().toISOString()).enterprise_contact).toBe(true);
    expect(upgradeOptions("local_enterprise", "drops", new Date().toISOString()).enterprise_contact).toBe(true);
  });
});

describe("allowance scope and cycle", () => {
  it("pooled counts org-wide (null location); per-location counts per location", () => {
    expect(scopeLocation(true, "loc-1")).toBeNull();
    expect(scopeLocation(false, "loc-1")).toBe("loc-1");
  });

  it("computes the current 30-day cycle window from the anchor", () => {
    const anchor = "2026-01-01T00:00:00.000Z";
    const now = new Date("2026-01-10T00:00:00.000Z"); // 9 days in → cycle 0
    const c = currentCycle(anchor, now);
    expect(c.start).toBe("2026-01-01T00:00:00.000Z");
    expect(c.end).toBe("2026-01-31T00:00:00.000Z");

    const later = new Date("2026-02-05T00:00:00.000Z"); // 35 days in → cycle 1
    const c2 = currentCycle(anchor, later);
    expect(c2.start).toBe("2026-01-31T00:00:00.000Z");
    expect(c2.end).toBe("2026-03-02T00:00:00.000Z");
  });
});
