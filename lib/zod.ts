import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

/**
 * The one place `zod` is imported. Everything else imports `z` from here.
 *
 * zod 4 copies prototype methods onto each schema instance when it is
 * constructed, so `extendZodWithOpenApi` only reaches schemas built after it
 * runs. Importing `z` from this module guarantees the extension is applied
 * before any schema exists, in every runtime and every import order.
 * Enforced by lint (no-restricted-imports on "zod").
 */
extendZodWithOpenApi(z);

export { z };
