import { beforeAll, describe, expect, it } from "vitest";
import { formatGateReport, runGate, type GateReport } from "@/lib/db/gate";

/**
 * WP-2 acceptance gate as a test suite. Needs a real Postgres with the
 * migrations and seeds applied. Set DATABASE_URL (the CI db-invariants job
 * does, after `supabase start`). Without it this file skips LOUDLY: a
 * skipped gate is not a passed gate.
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn(
    "\n[tests/db/invariants] SKIPPED: DATABASE_URL is not set. The WP-2 gate did not run.\n" +
      "  Start the local stack (npx supabase start) and run: npm run db:gate\n",
  );
}

describe.skipIf(!databaseUrl)("WP-2 acceptance gate (database invariants)", () => {
  let report: GateReport;

  beforeAll(async () => {
    report = await runGate(databaseUrl);
  }, 60_000);

  it("every operation that must fail at the database layer fails", () => {
    const allowed = report.checks.filter((c) => !c.passed);
    expect(allowed, `Allowed by Postgres:\n${allowed.map((c) => `  ${c.id} ${c.title}`).join("\n")}\n\n${formatGateReport(report)}`).toEqual([]);
  });

  it("the eleven gate items are all covered", () => {
    const ids = new Set(report.checks.map((c) => c.id.replace(/[a-z]$/, "")));
    for (const n of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]) {
      expect(ids.has(n), `gate item ${n} missing`).toBe(true);
    }
  });

  it("seed, deletion behaviour, and RLS posture are as specified", () => {
    const wrong = report.facts.filter((f) => !f.ok);
    expect(wrong, `Wrong facts:\n${wrong.map((f) => `  ${f.label}: ${f.value}`).join("\n")}`).toEqual([]);
  });

  it("founder is exactly user_number 1", () => {
    const f = report.facts.find((x) => x.label === "founder user_number (by email) is 1");
    expect(f?.value).toBe("1");
  });
});
