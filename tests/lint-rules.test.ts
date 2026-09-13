import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, expect, it } from "vitest";
import theDrop from "../eslint-rules/the-drop.mjs";

/**
 * The two rules are the architectural boundary (BUILD-PLAN WP-1). These
 * tests pin their behaviour so a future "relaxation" is a visible red diff.
 */

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

describe("the-drop/no-supabase-in-ui", () => {
  tester.run("no-supabase-in-ui", theDrop.rules["no-supabase-in-ui"], {
    valid: [
      { code: `import { useState } from "react";` },
      { code: `const res = await fetch("/v1/board");` },
      { code: `import { subscribeBoard } from "@/lib/realtime";` },
      { code: `import { formatPosition } from "@/lib/format";` },
    ],
    invalid: [
      {
        code: `import { createClient } from "@supabase/supabase-js";`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `import { createBrowserClient } from "@supabase/ssr";`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `import { getServiceClient } from "@/lib/supabase/server";`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `import { decrementInventory } from "@/lib/redis";`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `const mod = await import("@supabase/supabase-js");`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `const { createClient } = require("@supabase/supabase-js");`,
        errors: [{ messageId: "banned" }],
      },
      {
        code: `export * from "@/lib/supabase/server";`,
        errors: [{ messageId: "banned" }],
      },
    ],
  });
});

describe("the-drop/no-server-actions", () => {
  tester.run("no-server-actions", theDrop.rules["no-server-actions"], {
    valid: [
      { code: `"use client";\nexport default function Page() { return null; }` },
      { code: `"use strict";\nmodule.exports = {};` },
      { code: `const s = "use server"; // a string, not a directive` },
      { code: `export async function GET() { return Response.json({}); }` },
    ],
    invalid: [
      {
        code: `"use server";\nexport async function catchDrop() {}`,
        errors: [{ messageId: "serverAction" }],
      },
      {
        code: `'use server';\nexport async function readOnlyLookup() { return 1; }`,
        errors: [{ messageId: "serverAction" }],
      },
      {
        code: `export async function action() {\n  "use server";\n  return 1;\n}`,
        errors: [{ messageId: "serverAction" }],
      },
      {
        code: `const f = async () => {\n  "use server";\n};`,
        errors: [{ messageId: "serverAction" }],
      },
    ],
  });
});

describe("the-drop/no-dangerous-html", () => {
  const jsxTester = new RuleTester({
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });
  jsxTester.run("no-dangerous-html", theDrop.rules["no-dangerous-html"], {
    valid: [
      { code: `const el = <p>{title}</p>;` },
      { code: `const el = <span title={handle}>{name}</span>;` },
    ],
    invalid: [
      {
        code: `const el = <div dangerouslySetInnerHTML={{ __html: body }} />;`,
        errors: [{ messageId: "dangerousHtml" }],
      },
      {
        code: `React.createElement("div", { dangerouslySetInnerHTML: { __html: x } });`,
        errors: [{ messageId: "dangerousHtml" }],
      },
    ],
  });
});

describe("plugin shape", () => {
  it("exposes exactly the three boundary rules", () => {
    expect(Object.keys(theDrop.rules).sort()).toEqual([
      "no-dangerous-html",
      "no-server-actions",
      "no-supabase-in-ui",
    ]);
  });
});
