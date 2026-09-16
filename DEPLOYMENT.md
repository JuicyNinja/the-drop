# DEPLOYMENT

Everything between the code as it stands (all v1 work packages complete, WP-2 →
WP-14 gates green locally) and a real launch. Concretely, this is what closes the
two v1 release-gate items that are **deployment, not code**:

- **Gate 9** — the precise QStash per-drop scheduler wired, with the tick sweep as
  the reconciliation net (§8).
- **Gate 11** — one real merchant runs one real drop end to end in production
  (the whole document, verified by §11's launch checklist).

Do the sections **in order**. Each says what to **create**, which **env var** it
produces, and how to **verify** it. The first verifier for any deployed
environment is always the same: **`GET /v1/ready` returns `200`** (it pings
Supabase and Redis and returns `503 NOT_READY` naming the failed dependency
otherwise). Do not move past a section whose verify step fails.

Two deployed environments: **staging** and **production**. Build each fully
before promoting. Nothing here should be run against `local`.

---

## The environment contract

Every server-read variable is declared and validated in `lib/env.ts`, parsed once
at boot (`instrumentation.ts`) and lazily on first use. A missing or malformed
value fails loudly **with the variable's name** — never an `undefined` reaching a
client three layers deep. `.env.example` is the annotated source of truth; keep it
in sync when a variable is added.

`APP_ENV` (`local` | `staging` | `production`) is the master switch. When
`APP_ENV=production`, `lib/env.ts` **requires** the real-provider keys
(`GOOGLE_GEOCODING_API_KEY`, `STRIPE_SECRET_KEY`, all `TWILIO_*`, all `RESEND_*`,
all `VAPID_*`) and boot fails without them — because each of those providers has a
dev fallback that *succeeds plausibly with no network call* (the dev geocoder
returns coordinates; the dev subscription gateway grants a tier with no charge),
which in production is a silent, expensive failure. Each provider also refuses its
dev implementation in production at its own factory (defense in depth). Set
`APP_ENV=staging` on staging so you can still exercise dev fallbacks selectively;
set `APP_ENV=production` on production and expect a hard boot failure until every
required key is present.

`APP_URL` is the public origin, no trailing slash. The OAuth redirect URI is built
from it and `return_to` values are validated as internal paths against it, so it
**must** exactly match the deployed origin per environment.

---

## 1. Supabase — staging and production projects

**Create.** Two Supabase projects (`the-drop-staging`, `the-drop-prod`). For each:

1. Apply migrations. Link the project and push the committed migrations — never
   hand-edit the remote schema:
   ```bash
   supabase link --project-ref <ref>
   supabase db push          # applies supabase/migrations/* in order
   ```
   This runs everything through `20260916000100_wp14_admin.sql` (the WP-14 admin
   schema, `buyer_risk_profiles`, `users.clout_frozen_at`).
2. Load seeds. Run the seed SQL against the linked DB in this order (idempotent,
   guarded on email/user_number): `supabase/seed/base.sql` (founder as
   user_number 1, cities seeded **inactive/unlaunched**, empty badges),
   `supabase/seed/reserved-handles.sql`, `supabase/seed/taxonomy-seed.sql`.
   Markets are launched later, deliberately, from the admin portal (§ city
   config) — the seed must leave every city `active=false`.

**Produces.** From Project Settings → API:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (server-only secret). For running migrations and the
gate scripts against the project you also need the direct Postgres connection
string as `DATABASE_URL` (Project Settings → Database → Connection string; use the
pooler for app runtime, the direct connection for migrations/gates).

**Verify.**
- `supabase migration list` shows every local migration applied remote.
- `npm run db:gate` against the project (`DATABASE_URL=<project> npm run db:gate`)
  → **GATE PASSED**: RLS enabled on every table, `buyer_risk_profiles` admin-only,
  ledgers append-only, founder is user_number 1, cities inactive.
- The founder row is usable via GoTrue (the db gate's `admin generate_link` fact).

---

## 2. Upstash Redis — staging and production

Redis holds live-window inventory; `DECR` is the atomic authority for the catch
contract. It is not a cache — an unreachable Redis means no catches.

**Create.** Two Upstash Redis databases (`the-drop-staging`, `the-drop-prod`),
each in the region closest to the Vercel deployment region to keep DECR latency
low. Enable the REST API. Eviction **off** (inventory keys must never be evicted).

**Produces.** From the database → REST API section:
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

**Verify.**
- With Supabase (§1) and these set, `GET /v1/ready` → `200` with
  `checks.redis: "ok"`. **This is the first green light for the environment.**
- Full burst re-validation is §9 — do it before launch, not here.

---

## 3. Vercel — project, env vars per environment, APP_ENV mapping

**Create.** One Vercel project from the repo. Framework: Next.js. Map Vercel
environments to `APP_ENV`:

| Vercel environment | `APP_ENV` | `APP_URL` |
|---|---|---|
| Preview / staging deploy | `staging` | the staging origin |
| Production | `production` | the production origin |

Set **every** variable from `lib/env.ts` per environment (matrix in §12). The
`NEXT_PUBLIC_*` pair is exposed to the client by design; **everything else is a
server secret** and must not be prefixed `NEXT_PUBLIC_`. Note the Vercel **egress
IP** (or configure a static egress / NAT) — §5 needs it.

**Produces.** `APP_ENV`, `APP_URL` (plus all the keys the later sections produce,
entered here).

**Verify.**
- A production deploy **boots**. Because `APP_ENV=production` triggers the
  `lib/env.ts` production guard, a missing required key fails the build/boot with
  that variable's name — a green production boot means every required provider key
  is present.
- `GET /v1/ready` → `200` on the deployed origin.
- `GET /v1/health` → `200` (liveness, header-exempt).

---

## 4. Google OAuth — redirect URIs for the deployed origins

**Create.** In the Google Cloud OAuth client, add the authorized redirect URI for
each deployed origin. The app builds the redirect URI from `APP_URL`, so it must
match exactly, per environment (staging and production origins are distinct
entries). Keep `http://127.0.0.1:3000` only for local.

**Produces.** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (and, if/when
Apple is enabled, `APPLE_OAUTH_CLIENT_ID` / `APPLE_OAUTH_CLIENT_SECRET`). Absent →
the dev identity provider, which must not run in a real environment.

**Verify.** Sign in on the deployed origin completes the real Google round trip
and returns to an internal `return_to` path — no `redirect_uri_mismatch`, and the
callback lands back on `APP_URL`.

---

## 5. Google Geocoding — key IP restriction for Vercel egress

Address → coordinates governs discovery. The dev geocoder is deterministic and
offline; in production a wrong or unrestricted key is a silent failure or an open
billing surface.

**Create.** Restrict the Geocoding API key to the **Vercel egress IP(s)** from §3
(and any static NAT you configured). Restrict the key to the Geocoding API only.

**Produces.** `GOOGLE_GEOCODING_API_KEY` (production-required by `lib/env.ts`).

**Verify.** Creating a location on the deployed app geocodes a real address to
coordinates and resolves it to a supported city; a request from an unlisted IP is
rejected by Google (confirm the restriction actually bites).

---

## 6. Notifications — Twilio, Resend, VAPID

All three are production-required (`lib/env.ts`); a dev sender that silently logs
would drop the demand engine (WP-12 routing matrix).

**Twilio (SMS / phone verification).**
- Create. Messaging service + a number, and complete **A2P 10DLC** brand and
  campaign registration (US application-to-person; unregistered traffic is
  filtered — start this early, it has a lead time).
- Produces. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
- Verify. Phone verification send/confirm on the deployed app delivers a real SMS
  and confirms; the number is A2P-approved.

**Resend (email / digest).**
- Create. Verify the sending domain (SPF, DKIM, DMARC DNS records) in Resend.
- Produces. `RESEND_API_KEY`, `RESEND_FROM` (an address at the verified domain).
- Verify. A digest/test email is delivered from the verified domain and passes
  SPF/DKIM (not spam-foldered).

**Web Push (VAPID).**
- Create. Generate a VAPID key pair; `VAPID_SUBJECT` is a `mailto:` or `https:`
  contact.
- Produces. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- Verify. A push subscription is created on the deployed origin and a test push is
  received; the public key the client sees matches `VAPID_PUBLIC_KEY`.

---

## 7. Stripe Billing — products, price IDs, and the gateway swap

Today `lib/billing/subscription.ts` uses `DevSubscriptionGateway`, which grants a
tier upgrade **with no charge**. `getSubscriptionGateway()` selects
`StripeSubscriptionGateway` the moment `STRIPE_SECRET_KEY` is present, and refuses
the dev gateway outright when `APP_ENV=production`.

**Create.**
1. In Stripe, create the subscription **products and recurring prices**, one price
   per billable plan, and record each **price ID**. The billing plans live in
   `lib/billing/tiers.ts` — v1's self-serve priced tiers are `local_starter`
   ($99), `local_limited` ($149), `local_boss` ($199), `local_superstar` ($795);
   `local_enterprise` is contact-priced (no self-serve price). Reconcile the
   catalog with the intended **eight** products (e.g. monthly + annual per tier)
   before creating them, and keep `tiers.ts` and Stripe in lockstep — a price the
   catalog doesn't know, or a tier with no price ID, is a broken upgrade.
2. Implement `StripeSubscriptionGateway.upgrade` (currently throws
   `not implemented (WP-16)`): proration MUST use
   `proration_behavior=always_invoice`, and the **Stripe webhook** confirms the
   charge — never the synchronous API response (see BUILD-PLAN WP-16). Map
   `tier → price ID` (add the price-ID env vars to `lib/env.ts` and `.env.example`
   as you wire them). Add the downgrade path deferred in WP-6.

**Produces.** `STRIPE_SECRET_KEY` (production-required; flips the gateway from Dev
to Stripe), the per-tier price-ID variables you introduce, and a webhook signing
secret for the webhook handler.

**Verify.** With `APP_ENV=production` set, boot **refuses** the dev gateway unless
`STRIPE_SECRET_KEY` is present. An upgrade on the deployed app creates a real
Stripe subscription, prorates via `always_invoice`, and the tier changes **only
after** the confirming webhook — not on the API response. (Full payments are WP-16;
this section is the subscription-billing slice that unblocks a real merchant.)

---

## 8. QStash — per-drop scheduling, with the cron sweep as reconciliation — **GATE 9**

Today the only trigger is `POST /v1/admin/scheduler/tick` (a sweep). It is correct
and concurrency-safe (WP-6 gate: two concurrent ticks transition each drop exactly
once, seed Redis once), but a periodic sweep is the **reconciliation net**, not
the primary trigger — go-live and close must fire *precisely* at each drop's
timestamp, not on the next sweep.

**Create.**
1. On drop schedule (`status → scheduled`), enqueue two QStash messages: one at
   `live_at` to go live + seed Redis, one at `redeem_until` (or close time) to
   close. Both must call the same idempotent transition logic the tick uses —
   the transition UPDATE is conditional on current status and RETURNs the row
   (exactly one winner), Redis seeding is `SET NX` (duplicate seed is a no-op),
   and allowance is consumed at *schedule*, never at go-live (no double-consume).
2. Keep a low-frequency QStash **schedule** hitting `/v1/admin/scheduler/tick` as
   the reconciliation net that catches any missed or failed per-drop message.
3. Verify QStash request signatures on the receiving endpoints.

**Produces.** `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`,
`QSTASH_NEXT_SIGNING_KEY` — **add these to `lib/env.ts` and `.env.example`** (not
present yet; this section introduces them). Do **not** use Vercel Cron as the
primary trigger (1/min minimum; the go-live cadence is finer).

**Verify.** A drop scheduled for a near-future `live_at` goes live at that instant
(not on the next sweep) with Redis seeded exactly once; killing the per-drop
message still lets the sweep reconcile it; two messages/ticks firing together
transition it exactly once. **This closes release-gate item 9.**

---

## 9. Pre-launch Upstash burst re-validation (flagged in WP-7)

The WP-7 load gate runs against **local SRH** (the Upstash REST emulator) and,
when cloud credentials are present, also does a small SRH-vs-Upstash-cloud DECR
parity check (300 concurrent) — which is **SKIPPED without cloud creds**. Local
SRH is not the real thing under a 5,000-request burst: real Upstash REST has
network latency, rate limits, and connection-pool behavior SRH does not model.

**Create.** Nothing new — point the WP-7 load test at the **real** production (or a
production-equivalent) Upstash and run it before opening the doors.

**Produces.** No new env var; uses the production `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN`.

**Verify.** `npm run wp7:gate` against real Upstash → **zero oversell, positions
`1..N` exact, no duplicates or gaps** across runs, and the SRH-vs-cloud parity
check runs (not skipped) and agrees. Re-validating on the real backend is the
launch-blocking half of gate item 2's assurance.

---

## 10. PostgREST schema reload after deploy

Supabase's PostgREST caches the database schema. After migrations change the
schema on a running project (new tables/columns/policies — e.g. the WP-14 admin
schema), PostgREST must reload or it serves the **old** schema and new
tables/columns 404 or behave as absent.

**Create.** After every remote migration, trigger a schema reload:
`NOTIFY pgrst, 'reload schema';` (or restart the API from the Supabase dashboard).
Make this a step in the deploy pipeline, right after `supabase db push`.

**Produces.** No env var.

**Verify.** A query touching a newly migrated object works immediately post-deploy
— e.g. `GET /v1/admin/fraud/risk` (reads `buyer_risk_profiles`, added in WP-14)
returns `200` for an admin rather than a missing-relation error.

---

## 11. Launch checklist — release-gate items 9 and 11

Run in order; do not launch on a red line.

- [ ] §1 Supabase staging + prod: migrations applied, seeds loaded, `db:gate` green
- [ ] §2 Upstash staging + prod: `GET /v1/ready` → `200`
- [ ] §3 Vercel: prod boots (production guard satisfied), `/v1/ready` and
      `/v1/health` → `200`
- [ ] §4 Google OAuth: real sign-in completes on the deployed origin
- [ ] §5 Geocoding: key IP-restricted to Vercel egress; a real address geocodes
- [ ] §6 Twilio A2P approved, Resend domain verified, Web Push delivering
- [ ] §7 Stripe: products/prices created, `tiers.ts` reconciled, gateway swapped,
      an upgrade confirmed only by webhook
- [ ] §8 **QStash per-drop go-live/close wired, sweep as net → release-gate 9**
- [ ] §9 WP-7 burst re-validated against **real Upstash**: zero oversell
- [ ] §10 PostgREST schema reloaded post-deploy
- [ ] **Release-gate 11:** launch one city from the admin portal, onboard one real
      merchant, run **one real drop end to end in production** — go-live at the
      scheduled instant, a real catch, an in-person GPS redemption, the Gone card
      — with the audit trail and `/v1/ready` green throughout.

When §8 and the final box are done, the two deployment-only v1 release-gate items
are closed and v1 is launched.
