import { formatGateReport, runGate } from "@/lib/db/gate";

/**
 * `npm run db:gate`  runs the WP-2 acceptance gate against DATABASE_URL
 * (default: the local Supabase stack) and prints every operation with the
 * actual SQL error Postgres raised. Exits 1 if any operation was allowed or
 * any seed fact is wrong.
 */
async function main(): Promise<void> {
  const report = await runGate();
  console.log(formatGateReport(report));
  process.exit(report.passed ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
