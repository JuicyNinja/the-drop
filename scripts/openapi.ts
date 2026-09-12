import fs from "node:fs";
import path from "node:path";
import {
  OPENAPI_FILE,
  generateOpenApiDocument,
  serializeOpenApi,
} from "@/lib/api/openapi";

/**
 * `npm run openapi:generate`  writes openapi.json from the route definitions.
 * `npm run openapi:check`     exits 1 if the committed openapi.json differs.
 *
 * The check is a CI job of its own. Drift between the committed contract and
 * the implementation is a build failure (API-CONTRACT §0, rule 4).
 */

function firstDifference(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) {
      return [
        `first difference at line ${i + 1}:`,
        `  committed: ${al[i] ?? "<end of file>"}`,
        `  generated: ${bl[i] ?? "<end of file>"}`,
      ].join("\n");
    }
  }
  return "files differ only in trailing content";
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const target = path.join(process.cwd(), OPENAPI_FILE);

  const document = await generateOpenApiDocument();
  const generated = serializeOpenApi(document);
  const pathCount = Object.keys(document.paths ?? {}).length;

  if (!check) {
    fs.writeFileSync(target, generated, "utf8");
    console.log(`wrote ${OPENAPI_FILE} (${pathCount} paths)`);
    return;
  }

  const committed = fs.existsSync(target)
    ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n")
    : null;

  if (committed === generated) {
    console.log(`${OPENAPI_FILE} matches route definitions (${pathCount} paths)`);
    return;
  }

  console.error(
    committed === null
      ? `${OPENAPI_FILE} is missing.`
      : `${OPENAPI_FILE} drifts from route definitions.\n${firstDifference(committed, generated)}`,
  );
  console.error(`Run \`npm run openapi:generate\` and commit the result.`);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
