import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registry } from "@/lib/api/registry";
import { HTTP_METHOD_EXPORTS } from "@/lib/api/route";
import pkg from "@/package.json";

/**
 * Generates `openapi.json` from the route definitions.
 *
 * "From the route definitions" is literal: this module walks `app/api/v1`,
 * imports every `route.ts` (which registers itself through `defineRoute`),
 * and then checks in both directions that the file tree and the registry
 * agree. A route file that exports a method with no matching registration,
 * or a registration with no file behind it, is an error, not a warning.
 */

export const ROUTE_ROOT = path.join("app", "api", "v1");

const isRouteFile = (file: string) =>
  path.basename(file) === "route.ts" || path.basename(file) === "route.js";

/** `app/api/v1/drops/[id]/route.ts` → `/v1/drops/{id}` */
export function contractPathFor(routeFile: string): string {
  const rel = path
    .relative(ROUTE_ROOT, path.dirname(routeFile))
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => segment.replace(/^\[(?:\.\.\.)?([^\]]+)\]$/, "{$1}"));
  return ["/v1", ...rel].join("/");
}

export interface LoadedRoute {
  file: string;
  path: string;
  methods: string[];
}

export async function loadRoutes(
  projectRoot: string = process.cwd(),
): Promise<LoadedRoute[]> {
  const appDir = path.join(projectRoot, "app");
  const allRouteFiles = fs
    .readdirSync(appDir, { recursive: true, encoding: "utf8" })
    .filter(isRouteFile)
    .map((rel) => path.join("app", rel))
    .sort();

  const outside = allRouteFiles.filter(
    (file) => !file.startsWith(ROUTE_ROOT + path.sep),
  );
  if (outside.length > 0) {
    throw new Error(
      `Route handlers must live under ${ROUTE_ROOT} (API-CONTRACT §0, versioned path prefix). Found: ${outside.join(", ")}`,
    );
  }

  const loaded: LoadedRoute[] = [];
  for (const file of allRouteFiles) {
    const absolute = path.join(projectRoot, file);
    const mod = (await import(pathToFileURL(absolute).href)) as Record<
      string,
      unknown
    >;
    const contractPath = contractPathFor(file);
    const methods = HTTP_METHOD_EXPORTS.filter(
      (m) => typeof mod[m] === "function",
    );
    if (methods.length === 0) {
      throw new Error(`${file} exports no HTTP method handler.`);
    }
    for (const method of methods) {
      const registered = registry.definitions.some(
        (def) =>
          def.type === "route" &&
          def.route.method === method.toLowerCase() &&
          def.route.path === contractPath,
      );
      if (!registered) {
        throw new Error(
          `${file} exports ${method} but no route is registered for ${method} ${contractPath}. Define it with defineRoute().`,
        );
      }
    }
    loaded.push({ file, path: contractPath, methods: [...methods] });
  }

  for (const def of registry.definitions) {
    if (def.type !== "route") continue;
    const backed = loaded.some(
      (r) =>
        r.path === def.route.path &&
        r.methods.includes(def.route.method.toUpperCase()),
    );
    if (!backed) {
      throw new Error(
        `${def.route.method.toUpperCase()} ${def.route.path} is registered but no route file exports it.`,
      );
    }
  }

  return loaded;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description?: string }[];
  paths?: Record<string, unknown>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

function sortKeys<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  ) as T;
}

export async function generateOpenApiDocument(
  projectRoot: string = process.cwd(),
): Promise<OpenApiDocument> {
  await loadRoutes(projectRoot);

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "The Drop API",
      version: pkg.version,
      description:
        "The native contract. Every capability of The Drop is reachable through these routes by web, iOS, and Android alike. Generated from route definitions; do not edit by hand.",
    },
    servers: [{ url: "/", description: "Same origin. Base path is /v1." }],
  }) as OpenApiDocument;

  if (document.paths) document.paths = sortKeys(document.paths);
  return document;
}

export function serializeOpenApi(document: OpenApiDocument): string {
  return JSON.stringify(document, null, 2) + "\n";
}

export const OPENAPI_FILE = "openapi.json";
