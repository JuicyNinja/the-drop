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
const envSchema = z.object({
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
});

export type Env = z.infer<typeof envSchema>;

export const ENV_VARIABLE_NAMES = Object.keys(envSchema.shape) as (keyof Env)[];

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
