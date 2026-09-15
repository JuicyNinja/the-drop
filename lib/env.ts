import { z } from "@/lib/zod";

/**
 * Every environment variable the server reads, in one place.
 *
 * Parsed once at boot (see instrumentation.ts) and lazily on first use. A
 * missing or malformed value fails with the variable's name, never with an
 * `undefined` reaching a client constructor three layers deep at runtime.
 *
 * Do not read `process.env` anywhere else in the codebase. Add a variable
 * here, then document where it comes from in `.env.example`.
 */
const envObject = z.object({
  /** Which deployment this is. Set per Vercel environment; `local` for dev. */
  APP_ENV: z.enum(["local", "staging", "production"]),

  /** Supabase → Project Settings → API → Project URL */
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  /** Supabase → Project Settings → API → anon (public) key */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  /** Supabase → Project Settings → API → service_role (secret). Server only. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  /** Upstash → database → REST API → UPSTASH_REDIS_REST_URL */
  UPSTASH_REDIS_REST_URL: z.url(),
  /** Upstash → database → REST API → UPSTASH_REDIS_REST_TOKEN */
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),

  /**
   * Public base URL of the web app (no trailing slash). The OAuth redirect
   * URI is built from it, and `return_to` values are validated as internal
   * paths against it. Local: http://127.0.0.1:3000.
   */
  APP_URL: z.url(),

  // --- SMS (Twilio). Absent → dev sender that logs the code. ---
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_FROM_NUMBER: z.string().min(1).optional(),

  // --- Email (Resend). Absent → dev sender that logs the message. ---
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().min(1).optional(),

  // --- Web Push (VAPID). Absent → dev push sender that logs. ---
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).optional(), // mailto: or https: contact

  // --- OAuth identity providers. Absent → dev identity provider. ---
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  APPLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  APPLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),

  // --- Geocoding (Google). Absent → dev geocoder (deterministic, no network). ---
  GOOGLE_GEOCODING_API_KEY: z.string().min(1).optional(),

  // --- Billing (Stripe subscriptions). Absent → dev subscription gateway. ---
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
});

/**
 * Production guard for dev-fallback providers.
 *
 * These providers have real dev implementations that succeed plausibly with no
 * network call (the dev geocoder returns coordinates; the dev subscription
 * gateway grants a tier upgrade). In production that is a SILENT failure — a
 * buyer in the wrong market, a tier granted with no charge. So each key is
 * required when APP_ENV=production and fails loudly at boot, exactly like any
 * other required var. Each provider ALSO refuses its dev impl in production at
 * the factory (defense in depth).
 */
const PRODUCTION_REQUIRED = [
  "GOOGLE_GEOCODING_API_KEY",
  "STRIPE_SECRET_KEY",
  // Notification providers (WP-12). The routing matrix requires real SMS, email,
  // and push in production; a dev sender that silently logs would drop the demand
  // engine. Required at boot, and refused at each factory (defense in depth).
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;

const envSchema = envObject.superRefine((val, ctx) => {
  if (val.APP_ENV !== "production") return;
  for (const key of PRODUCTION_REQUIRED) {
    if (!val[key]) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `is required when APP_ENV=production (its dev fallback must never run in production)`,
      });
    }
  }
});

export type Env = z.infer<typeof envObject>;

export const ENV_VARIABLE_NAMES = Object.keys(envObject.shape) as (keyof Env)[];

export class EnvError extends Error {
  readonly problems: readonly string[];

  constructor(problems: string[]) {
    super(`Environment is not configured.\n  ${problems.join("\n  ")}`);
    this.name = "EnvError";
    this.problems = problems;
  }
}

/**
 * Validate an environment source. Throws `EnvError` listing every problem,
 * each as `NAME is required` or `NAME is invalid: <reason>`.
 */
export function parseEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const name = String(issue.path[0]);
    const raw = source[name];
    if (raw === undefined || raw === "") return `${name} is required`;
    return `${name} is invalid: ${issue.message}`;
  });

  throw new EnvError([...new Set(problems)]);
}

let cached: Env | undefined;

/** The validated environment. Parses on first call, then returns the cache. */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Test hook only. Application code never calls this. */
export function resetEnvCache(): void {
  cached = undefined;
}
