import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import theDrop from "./eslint-rules/the-drop.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "node_modules/**",
    "next-env.d.ts",
    "supabase/.temp/**",
  ]),
  {
    plugins: { "the-drop": theDrop },
  },

  // Schemas must be built from the extended zod instance (see lib/zod.ts).
  {
    ignores: ["lib/zod.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "zod",
              message: "Import { z } from \"@/lib/zod\" so OpenAPI metadata works in every import order.",
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // Architectural boundary. Both rules are "error" and fail CI.
  // Do not disable, downgrade, or suppress. See eslint-rules/the-drop.mjs
  // for the reasoning behind each. BUILD-PLAN WP-1, CLAUDE.md invariant #15.
  // ---------------------------------------------------------------------

  // Rule 1: no Supabase client import inside UI code.
  {
    files: ["app/(ui)/**", "components/**"],
    rules: { "the-drop/no-supabase-in-ui": "error" },
  },

  // Rule 2: no 'use server' anywhere in the codebase.
  {
    rules: { "the-drop/no-server-actions": "error" },
  },

  // Rule 3: no dangerouslySetInnerHTML anywhere (WP-3 security decision).
  {
    rules: { "the-drop/no-dangerous-html": "error" },
  },
]);

export default eslintConfig;
