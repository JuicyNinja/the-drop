import { describe, expect, it } from "vitest";
import { ENV_VARIABLE_NAMES, EnvError, parseEnv } from "@/lib/env";
import { VALID_ENV } from "./helpers/env";

describe("lib/env", () => {
  it("parses a complete environment", () => {
    const env = parseEnv(VALID_ENV);
    expect(env.APP_ENV).toBe("local");
    expect(env.UPSTASH_REDIS_REST_URL).toBe(VALID_ENV.UPSTASH_REDIS_REST_URL);
  });

  it("names a missing variable: 'X is required'", () => {
    const source = { ...VALID_ENV };
    delete source.SUPABASE_SERVICE_ROLE_KEY;

    let caught: unknown;
    try {
      parseEnv(source);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvError);
    const err = caught as EnvError;
    expect(err.problems).toEqual(["SUPABASE_SERVICE_ROLE_KEY is required"]);
    expect(err.message).toContain("SUPABASE_SERVICE_ROLE_KEY is required");
  });

  it("treats an empty string as missing", () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, UPSTASH_REDIS_REST_TOKEN: "" }),
    ).toThrow("UPSTASH_REDIS_REST_TOKEN is required");
  });

  it("requires dev-fallback provider keys in production (they must not ship)", () => {
    const prod = { ...VALID_ENV, APP_ENV: "production" as const };
    // Both dev-fallback keys are required in production.
    expect(() => parseEnv(prod)).toThrow(/GOOGLE_GEOCODING_API_KEY is required/);
    expect(() => parseEnv(prod)).toThrow(/STRIPE_SECRET_KEY is required/);
    // Missing just Stripe still fails on Stripe.
    expect(() =>
      parseEnv({ ...prod, GOOGLE_GEOCODING_API_KEY: "g" }),
    ).toThrow(/STRIPE_SECRET_KEY is required/);
    // Both present → fine.
    expect(
      parseEnv({ ...prod, GOOGLE_GEOCODING_API_KEY: "g", STRIPE_SECRET_KEY: "s" }).APP_ENV,
    ).toBe("production");
    // Not required outside production.
    expect(parseEnv({ ...VALID_ENV, APP_ENV: "staging" }).APP_ENV).toBe("staging");
    expect(parseEnv({ ...VALID_ENV, APP_ENV: "local" }).APP_ENV).toBe("local");
  });

  it("names an invalid value: 'X is invalid: ...'", () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: "not a url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL is invalid/);
    expect(() => parseEnv({ ...VALID_ENV, APP_ENV: "prod" })).toThrow(
      /APP_ENV is invalid/,
    );
  });

  it("reports every required problem at once, and omits optional vars", () => {
    let caught: EnvError | undefined;
    try {
      parseEnv({});
    } catch (error) {
      caught = error as EnvError;
    }
    const required = [
      "APP_ENV",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "APP_URL",
    ];
    expect(caught?.problems).toHaveLength(required.length);
    for (const name of required) {
      expect(caught?.problems).toContain(`${name} is required`);
    }
    // Optional provider vars must never be reported as required.
    for (const name of ENV_VARIABLE_NAMES) {
      if (!required.includes(name)) {
        expect(caught?.problems).not.toContain(`${name} is required`);
      }
    }
  });
});
