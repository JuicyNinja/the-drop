import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { getEnv } from "@/lib/env";
import { kvDel, kvGet, kvSet } from "@/lib/redis";

/**
 * OAuth identity establishment. Mirrors the SMS decision: a provider interface
 * with a dev implementation so the whole flow is testable now and swaps to
 * real Google/Apple with a credential change.
 *
 * Security posture (API-CONTRACT §2): server-side PKCE with the verifier held
 * in Redis keyed by `state`; `state` single-use and 10-minute TTL; `return_to`
 * validated as an internal path before it is ever used for a redirect. The
 * IdP establishes identity (an email); our own session is minted separately.
 */

export const OAUTH_PROVIDERS = ["google", "apple"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

const STATE_TTL_SECONDS = 10 * 60;
const stateKey = (state: string) => `oauthstate:${state}`;

interface StateRecord {
  provider: OAuthProvider;
  codeVerifier: string;
  returnTo: string;
}

export interface Identity {
  email: string;
  fullName: string | null;
  providerAccountId: string;
}

export interface IdentityProvider {
  readonly kind: "dev" | "google" | "apple";
  authorizeUrl(opts: {
    provider: OAuthProvider;
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchange(opts: {
    provider: OAuthProvider;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<Identity>;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeVerifier(): string {
  return base64url(randomBytes(48));
}

function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/**
 * `return_to` must be an internal path: begins with a single slash, is not a
 * protocol-relative `//host`, and carries no scheme. An open redirect here is
 * a known OAuth exploit, so anything else collapses to the board root.
 */
export function safeReturnTo(raw: string | undefined | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.includes("://")) return "/";
  if (raw.includes("\\")) return "/";
  return raw;
}

export function redirectUri(): string {
  return `${getEnv().APP_URL}/v1/auth/oauth/callback`;
}

// ---------------------------------------------------------------------------
// Dev identity provider. authorizeUrl points at a local consent stub; exchange
// accepts a code of the form `dev-code:<email>` (optionally `|Full Name`).
// No external round trip; the mechanism (state, PKCE, return_to) is real.
// ---------------------------------------------------------------------------
export class DevIdentityProvider implements IdentityProvider {
  readonly kind = "dev" as const;

  authorizeUrl(opts: {
    provider: OAuthProvider;
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    const u = new URL(`${getEnv().APP_URL}/dev-oauth`);
    u.searchParams.set("provider", opts.provider);
    u.searchParams.set("state", opts.state);
    u.searchParams.set("code_challenge", opts.codeChallenge);
    u.searchParams.set("redirect_uri", opts.redirectUri);
    return u.toString();
  }

  async exchange(opts: { code: string }): Promise<Identity> {
    const m = /^dev-code:([^|]+)(?:\|(.*))?$/.exec(opts.code);
    if (!m) {
      throw new ApiError("VALIDATION_ERROR", "Invalid authorization code.", {
        code: [{ path: "code", message: "unrecognized" }],
      });
    }
    const email = m[1].trim().toLowerCase();
    const fullName = m[2]?.trim() || null;
    return { email, fullName, providerAccountId: `dev:${email}` };
  }
}

let provider: IdentityProvider | undefined;

export function getIdentityProvider(): IdentityProvider {
  if (!provider) {
    // Real Google/Apple providers plug in here when their credentials exist.
    // Until then the dev provider drives the full flow.
    provider = new DevIdentityProvider();
  }
  return provider;
}

/** Test hook only. */
export function resetIdentityProvider(): void {
  provider = undefined;
}

/**
 * Begin an OAuth flow: mint PKCE + state, persist the verifier and validated
 * return_to keyed by state, and return the provider's authorize URL.
 */
export async function beginOAuth(
  providerName: OAuthProvider,
  returnToRaw: string | undefined,
): Promise<{ authorize_url: string; state: string }> {
  const state = base64url(randomBytes(24));
  const codeVerifier = makeVerifier();
  const codeChallenge = challengeFor(codeVerifier);
  const returnTo = safeReturnTo(returnToRaw);

  await kvSet<StateRecord>(
    stateKey(state),
    { provider: providerName, codeVerifier, returnTo },
    STATE_TTL_SECONDS,
  );

  const authorize_url = getIdentityProvider().authorizeUrl({
    provider: providerName,
    state,
    codeChallenge,
    redirectUri: redirectUri(),
  });
  return { authorize_url, state };
}

/**
 * Complete the provider half of the callback: consume `state` (single-use),
 * retrieve the verifier, and exchange the code for an identity. Returns the
 * identity and the validated return_to. Session minting happens after this.
 */
export async function resolveOAuthCallback(
  code: string,
  state: string,
): Promise<{ identity: Identity; returnTo: string }> {
  const record = await kvGet<StateRecord>(stateKey(state));
  if (!record) {
    throw new ApiError("UNAUTHENTICATED", "Invalid or expired authorization state.");
  }
  await kvDel(stateKey(state)); // single-use

  const identity = await getIdentityProvider().exchange({
    provider: record.provider,
    code,
    codeVerifier: record.codeVerifier,
    redirectUri: redirectUri(),
  });
  return { identity, returnTo: safeReturnTo(record.returnTo) };
}
