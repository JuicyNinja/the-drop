# THE DROP — BUILD PLAN

**Version:** 1.0
**Companion to:** THE-DROP-PRD.md, THE-DROP-DATA-MODEL.md, THE-DROP-API-CONTRACT.md, CLAUDE.md
**Consumer:** Claude Code / autonomous coding agent

---

## 0. HOW TO USE THIS DOCUMENT

Work packages are numbered `WP-n`. Each has a **goal**, **dependencies**, **scope**, and an **acceptance gate**.

**Rules of engagement:**

1. **Do not start a work package until its dependencies have passed their acceptance gates.** Dependencies are hard, not advisory.
2. **Read CLAUDE.md before every session.** It contains invariants that may not be violated for any reason, including performance, developer convenience, or user-experience smoothing.
3. **An acceptance gate is a test suite, not a judgment call.** If the tests do not pass, the package is not done.
4. **When a requirement in this plan conflicts with the PRD, the PRD wins.** When the PRD conflicts with CLAUDE.md, CLAUDE.md wins.
5. **Do not build ahead.** Phase 2 and Phase 3 tables exist in the schema; their endpoints and UI do not get built in v1 regardless of how straightforward they appear.
6. **If a requirement appears missing, stop and ask.** Do not infer product decisions. Every ambiguity in this document is an unmade decision, not an invitation.
7. **A gate connects to exactly what the server connects to.** Three gates (WP-3, WP-6, WP-11) shipped the same defect: a Redis or Postgres client in the gate script read cloud env (`.env.local`) while the running dev server wrote the local stack (SRH / local Postgres via `.env.development.local`), so the gate queried an empty cloud database and reported a phantom failure. The rule, once: **every gate script resolves its clients through the same env precedence the server uses** — `.env.development.local` overrides `.env.local`, matching Next.js dev — and **a new gate uses the shared client modules (`lib/redis.ts`, `lib/supabase/server.ts`, or the `@upstash/redis` / `pg` clients configured from that precedence) rather than hand-rolling a connection or a raw REST call.** A gate that reads a different database than the server writes is not testing the server; it is manufacturing a failure that will be mistaken for a real one three packages later.
8. **A new precondition on a shared path requires re-running every gate, not just the one being worked.** WP-3's phone-verification gate (registration cannot complete unverified; `POST /v1/catches` rejects an unverified account) was correct, but the catch path is shared: five gates — WP-8, WP-9, WP-10, WP-11, WP-14 — register accounts and then catch, and none verified a phone, so every one of them silently broke and was not noticed because only WP-3 was re-run. The rule, once: **when a change adds or tightens a precondition on a path many gates traverse — authentication, verification, permission, allowance, suspension — re-run the full gate suite, because the surface it touches is every gate that reaches that path, not the package that introduced it.** The fix in each was to satisfy the precondition as a setup step (set `phone_verified_at` directly; the SMS chain itself stays proven once, in WP-3). The seed carries the same obligation for the same reason. This is the second rule from this class of bug, alongside rule 7.
9. **The reachability audit is a standing gate item.** Every package — v1 and Phase 2/3 — whose acceptance gate names a surface must, as part of that gate, cross-reference every non-admin `/v1` endpoint against UI call sites and report anything the backend supports that no client can reach (invariant #15). It is not optional and does not wait to be asked. The method found **sixteen** missing controls when first run against WP-13 and **one** (share-return attribution — `POST /v1/shares/{token}/verify`, the sole clout path for a share) on the second pass; both were gaps a scope-narrow gate had missed. A capability with no client path is not shipped, however complete its handler. This generalizes rule of engagement: a gate verifies every capability a named surface exposes is reachable, not only the specific items a task happened to list.

10. **A query's error must be handled explicitly — never treated as an empty result.** The drop-live radius matcher embedded `users!inner` on `addresses`, a table with two relationships to `users` (owner, and the reverse via `active_address_id`); the embed was ambiguous and every call errored, but the error was discarded (`const { data } = …`, no `error`), so a hard failure was indistinguishable from a legitimately empty match — and radius discovery, the entire path by which a merchant with no followers reaches nearby buyers (§9.2), was dead from WP-12 through WP-14 without a single gate noticing. The rule, once: **every Supabase query destructures `error` and handles it — throw where a failed read must abort, and continue only where proceeding on no rows is genuinely correct — and never leaves `error` undestructured, because a swallowed error reads exactly like a query that correctly found nothing.** Its gate corollary: a gate that asserts *routing* (what happens to a recipient already matched) does not prove *matching* (that recipients are produced at all); when a matcher can silently yield nothing, its gate must seed an input that MUST match and assert a non-empty result. This is the third rule from a swallowed-signal bug, alongside rules 7 and 8.

---

## 1. PHASE MAP

| Phase | Content | Packages |
|---|---|---|
| **v1** | Local Drop — buyer, operator, admin | WP-1 … WP-14 |
| **Phase 2** | Maker Drop — curation, payments, orders, RMA, native client | WP-15 … WP-21 |
| **Phase 3** | DigiDrop — delivery, licensing, streaming | WP-22 … WP-25 |

**v1 ships Local Drop only.** No purchases. No shipping. No file delivery. No streaming. No approval queue.

---

# PHASE 1 — v1

## WP-1 — Foundation

**Goal:** Repository, environments, and the architectural boundary that everything else depends on.

**Dependencies:** none

**Scope:**
- Next.js (App Router) + TypeScript, strict mode
- Supabase project: local, staging, production
- Redis provisioned in all three
- Vercel deployment pipeline
- Route handlers under `/app/api/v1/*` — **route handlers only, no server actions for mutations**
- Shared error envelope and the canonical error-code enum (API-CONTRACT §1.4)
- Zod request/response validation on every route
- OpenAPI 3.1 generation from route definitions, committed as `openapi.json`
- CI: typecheck, lint, test, OpenAPI drift check

**Acceptance gate:**
- CI fails when `openapi.json` drifts from route definitions
- A lint rule fails the build on any Supabase client import inside `/app/(ui)/**`
- A lint rule fails the build on any `'use server'` mutation
- Health endpoint returns 200 in all three environments

**Note:** The two lint rules are the architectural boundary. They are the mechanism that keeps native viable. Do not disable them.

**Decisions recorded 2026-09-12 (during WP-1 execution):**

- **Health is two routes, not one.** `GET /v1/health` is static liveness; `GET /v1/ready` is deep readiness (Supabase + Redis, 503 `NOT_READY` on failure). Both exempt from `X-Client` headers. Specified in API-CONTRACT §1.7. Two server-side codes were added to §1.4 to make the envelope complete: `INTERNAL_ERROR` (500) and `NOT_READY` (503).
- **Redis is Upstash Redis via `@upstash/redis` (REST).** On Vercel's serverless runtime a TCP client (ioredis) opens a connection per invocation; at drop-open that is a connection storm in exactly the moment the product cannot fail. The REST client is stateless with no pool to exhaust. Two hard requirements WP-7 depends on: (1) `DECR` is one atomic round trip, never read-then-write, never a Lua wrapper, never client-side optimistic locking; (2) idempotency keys are claimed with a single `SET key value NX EX 86400`, never `SETNX` followed by `EXPIRE`. All Redis access goes through `lib/redis.ts`; no route handler imports the Upstash client. Both requirements are pinned by unit tests.
- **Environment is validated at boot.** One Zod schema in `lib/env.ts`, parsed in `instrumentation.ts`. A missing key fails with `NAME is required`. `process.env` is not read anywhere else. `.env.example` is the provisioning checklist.
- **Base path.** Handlers live under `app/api/v1/*`; a Next rewrite makes the contract path `/v1/*` canonical.
- **Lint rule scope.** `no-supabase-in-ui` covers `app/(ui)/**` and `components/**`, and bans `@supabase/*`, `lib/supabase/*`, and `lib/redis`. `no-server-actions` bans every `'use server'` directive: a static linter cannot tell a read from a mutation, and a read-only server action is exactly as unreachable from a native client as a mutating one. The ban is total by design. Both rules are `error` and fail CI.
- **CI.** typecheck, lint, test, openapi-drift, and build are separate named jobs so a failure names its gate.


---

## WP-2 — Schema and invariants

**Goal:** Full database, all three lanes, invariants enforced in the database.

**Dependencies:** WP-1

**Scope:**
- Every table in DATA-MODEL, **including Phase 2 and 3 tables**
- All enums, constraints, indexes
- Triggers: handle lock, user-number immutability, live-drop immutability, counter-monotonic, state-transition guard, local-skips-approval, Fanatic cap
- `user_number_seq` starting at 1; seed account `1` = Tad Timothy, Founder
- RLS policies on every table
- `clout_events` and `admin_audit_log` append-only at the policy level — no update or delete policy for any role including admin
- Seed data: cities (SLC), tags taxonomy, badges

**Acceptance gate — each of these MUST fail at the database layer:**
- UPDATE a live drop's `quantity_total`, `price_cents`, `terms`, `title`, `description`, or redemption window
- UPDATE `quantity_remaining` upward on a live drop
- INSERT a second catch for the same `original_user_id` on the same drop
- INSERT a duplicate `position_number` on the same drop
- UPDATE a `user_number`
- UPDATE a handle twice
- INSERT an 11th Fanatic follow in one lane
- UPDATE or DELETE any row in `clout_events` as any role including admin
- UPDATE or DELETE any row in `admin_audit_log` as any role including admin
- INSERT an `rmas` row with `refunded_at` set and `received_at` null
- INSERT a `drops` row with `lane='local'` and `status='submitted'`

**This gate is the most important in the build.** Every invariant that is enforced here cannot be broken later by application code, by a future agent, or by a well-meaning feature.

**Decisions recorded 2026-09-12 (during WP-2 execution):**

- **`users.id` is the Supabase Auth uid.** `id uuid primary key references auth.users(id) on delete restrict`, no default. RLS self policies are `auth.uid() = id`. The auth uid is internal plumbing: never displayed, never in a URL. `user_number` and `handle` remain the public identity. Deleting an `auth.users` row cannot remove a `users` row (FK restrict, verified by the gate); account deletion is `users.deleted_at`, and a trigger forbids DELETE on `users` outright.
- **Append-only is enforced three ways** on `clout_events` and `admin_audit_log`: triggers reject UPDATE and DELETE for every role including the table owner; UPDATE and DELETE privileges are revoked from `service_role`; and no RLS policy grants a write. The gate exercises all three as `postgres`, as an authenticated admin JWT, and as `service_role`. `catches`, `redemptions`, and `users` also forbid DELETE by trigger, and a catch's drop, original catcher, position number, and `caught_at` are immutable by trigger.
- **No client write privileges anywhere.** INSERT, UPDATE, and DELETE are revoked from `anon` and `authenticated` on every public table (and by default privilege for future tables). Every RLS policy is SELECT-only. All mutations go through `/v1` (CLAUDE.md invariants #7, #15). Public read exists only on taxonomy, cities, badges, organizations, locations, live and Gone drops, ranking pressure, merchant scores, and a `public_profiles` view exposing handle and user_number only.
- **Every drop is created as `draft`.** The transition guard rejects an INSERT at any other status so the state machine cannot be entered mid-way. Local drops are rejected from `submitted` and `approved` on insert and on update.
- **`user_roles` primary key is a unique index.** Postgres rejects a `coalesce()` expression in a PRIMARY KEY; the unique index carries identical semantics.
- **`orders` gains `tracking_required_before_shipped`**, the check the DATA-MODEL states in prose.
- **`tags_search` index uses an IMMUTABLE wrapper.** `array_to_string(text[], text)` is only STABLE and Postgres refuses it in an index expression (SQLSTATE 42P17, hit on first apply). `tag_search_document(label, synonyms)` is the indexed function; `GET /v1/tags/search` must query through it or the index is bypassed.
- **Seeds.** Salt Lake City and Provo seeded inactive and unlaunched; WP-14's admin city-launch action flips a market live. Founder seeded as user_number 1 with `tad` reserved (reason `system`), email and phone unverified, location permission not granted, admin role granted. Badges table seeded empty: the badge list is an open product decision. `base.sql` is idempotent, guarded on email and user_number, and the gate proves `user_number_seq` does not advance across a re-run.
- **The gate is `npm run db:gate`** (`lib/db/gate.ts`), also run as `tests/db/invariants.test.ts` and as the `db-invariants` CI job against a Supabase stack started on the runner. Every operation runs in a rolled-back savepoint against real Postgres and the report carries the actual SQLSTATE, constraint, and message. Fixtures never consume `user_number_seq`, so the gate is repeatable without a reset.

---

## WP-3 — Auth and registration

**Goal:** The full signup funnel, including the intent round-trip.

**Dependencies:** WP-2

**Scope:**
- Supabase Auth, OAuth (Google, Apple)
- `POST /v1/auth/oauth/callback` with `return_to` intent preservation
- `POST /v1/auth/register/complete` — name, handle, phone, address; assigns `user_number`
- SMS verification send/confirm
- `POST /v1/users/me/location-permission` — the hard gate
- `GET|PATCH /v1/users/me`
- Reserved handle list (brands, profanity)
- Triggered post-registration email prompting full profile configuration
- First-session tooltip walkthrough

**Acceptance gate:**
- A user landing on `/drops/{id}` from a shared link, registering, and completing SMS + location returns to that exact drop, unlocked, catch-ready
- `POST /v1/catches` returns `LOCATION_PERMISSION_REQUIRED` when `location_perm_granted_at` is null
- Handle change succeeds once, fails the second time with `HANDLE_LOCKED`
- `user_number` is sequential, zero-padded to 14 on display, stored as `bigint`

**Decisions recorded 2026-09-13 (during WP-3 execution):**

- **Sessions are Bearer everywhere, no cookie path.** Added `POST /v1/auth/oauth/start` (server-side PKCE; verifier + validated return_to in Redis keyed by single-use, 10-min state) and `POST /v1/auth/refresh` (delegated to GoTrue, which has rotation + reuse detection enabled). Security posture recorded in API-CONTRACT §2: access token in memory only, refresh rotation with reuse detection, no `dangerouslySetInnerHTML` (new lint rule at error), authored text rendered as text and sanitized on write, strict nonce CSP (no unsafe-inline/eval), state single-use + return_to internal-path allowlist.
- **`users.id` is the auth uid** (from WP-2); WP-3 adds bearer auth to `defineRoute` with three modes: `none`, `session` (valid JWT, users row optional — the completion routes), `user` (JWT + completed, non-suspended row). A JWT without a users row is treated as UNAUTHENTICATED.
- **The catch pre-flight is live; the atomic catch is WP-7.** `POST /v1/catches` runs UNAUTHENTICATED → ACCOUNT_SUSPENDED → LOCATION_PERMISSION_REQUIRED → Idempotency-Key → NOT_FOUND → DROP_NOT_LIVE, then returns `NOT_IMPLEMENTED` (501, added to §1.4) naming WP-7. Never INTERNAL_ERROR, so a real 500 in WP-4–6 is distinguishable. The WP-7 gate and the v1 release gate both assert no NOT_IMPLEMENTED survives.
- **Handles**: 3–20 chars, lowercase `a–z`/digit/underscore, no edge/double underscore, ≥1 letter; uniqueness on a confusable-normalized form (`_` stripped; 0→o 1→l 5→s rn→m vv→w) matched byte-for-byte by SQL `normalize_handle` and TS `normalizeHandle`. Reserved list (51 system, 11 brand, 381 profanity from naughty-words/LDNOOBW) returns HANDLE_TAKEN, never revealing which names are special. Generated by `scripts/gen-reserved-handles.ts`.
- **SMS and email are provider interfaces with dev senders** (log instead of send); Twilio/Resend swap in by credential presence, no code change. Phone code in Redis with TTL, send rate-limited 5/hr per phone.
- **Walkthrough** is one nullable timestamp `walkthrough_completed_at`, set by either `.../walkthrough/complete` or `.../walkthrough/skip`.
- **Local dev talks to the local stack via `.env.development.local`** (gitignored, higher precedence than the cloud `.env.local` in dev). The cloud dev project still has no schema.
- **The gate is `npm run wp3:gate`** (`scripts/wp3-gate.ts`) against a running dev server: full OAuth→register→SMS→location→return-to-intent round trip, the location gate, handle lock, user_number formatting, reserved/confusable rejection, refresh rotation, open-redirect defense, and the CSP header, each with real HTTP output.

---

## WP-4 — Addresses

**Goal:** Multi-address with explicit active-address switching.

**Dependencies:** WP-3

**Scope:**
- Address CRUD, server-side geocoding (client never supplies lat/lng)
- `PUT /v1/users/me/active-address`
- Per-address `radius_miles`
- Home protection: undeletable, fallback on active-address deletion
- Persistent active-address indicator in the header
- `GET /v1/users/me/location-drift` — advisory switch suggestion

**Acceptance gate:**
- Switching the active address changes the Local board market
- Active address is never consulted by any redemption code path — verified by test
- Drift suggestion never mutates the active address automatically

**Decisions recorded 2026-09-13 (during WP-4 execution):**

- **Geocoder is Google Geocoding API** behind `lib/geo/geocoder.ts` (one interface, one file, no route calls Google directly), chosen for US residential/apartment/new-construction accuracy since volume is trivial (~2–3 lookups per buyer lifetime). Env var `GOOGLE_GEOCODING_API_KEY`; absent → a deterministic dev geocoder (no network) so the flow is fully testable now. Coordinates are cached permanently: geocoding runs only on create or on an edit that changes a line of the address (label/radius edits do not). Zero-result, ambiguous, and partial matches are rejected with VALIDATION_ERROR carrying the provider's response — never stored as a wrong coordinate. GCP key creation + restriction steps are in README.
- **Client never supplies lat/lng.** The create and patch bodies are strict; `lat`/`lng` (or any unknown key) are rejected with VALIDATION_ERROR. A client coordinate is a spoofed market (invariant #10).
- **Home is created and geocoded at registration.** WP-3's registration deferred geocoding; WP-4 makes `register/complete` geocode the Home address so the active market resolves immediately.
- **Active address governs discovery only.** The Local board is built on `app_discover_local_drops` (live local drops within the active address's radius, earthdistance) and `resolveActiveMarket`; both read the active address. Grep-verified that no redemption/geofence code path reads it, and the `redemptions` table carries its own GPS columns with no address linkage. The full board/ranking is WP-11; WP-4 ships the discovery seam.
- **Drift is advisory.** `GET /v1/users/me/location-drift` takes the current GPS position and suggests a closer saved address; it never mutates the active address. Switching is always the explicit `PUT /v1/users/me/active-address`.
- **Home protection + fallback.** Home is undeletable; deleting the active address falls back to Home so a user is never left without a market.
- **The gate is `npm run wp4:gate`** (`scripts/wp4-gate.ts`) against a running dev server; Google failure handling is unit-tested in `tests/geocoder.test.ts`.

---

## WP-5 — Merchant org and locations

**Goal:** Organization, locations, staff, and the tier limit model.

**Dependencies:** WP-3

**Scope:**
- Org creation, tier assignment, per-account stored limits
- Location CRUD with geofence radius
- Staff seats scoped to a single location
- Role-based access: owner sees all, staff sees Today's Code + feed only
- `drop_allowance_usage` cycle rows on a 30-day anniversary
- `POST /v1/orgs/{id}/locations` returns 402 with the upgrade payload at cap

**Acceptance gate:**
- `merchant_staff` receives 403 on drop creation, billing, and stats
- Limits are read from the org row, **never computed from the `tier` enum** — verified by setting an Enterprise org to arbitrary values and confirming behavior
- Pooled vs. per-location allowance both count correctly

**Decisions recorded 2026-09-13 (during WP-5 execution):**

- **Limits are stored, read, never derived.** `app_create_org` writes max_locations, drops_per_cycle, and drops_pooled_org_level onto the org row: seeded from the tier catalog (`lib/billing/tiers.ts`) for self-serve tiers, set to arbitrary values by an admin for Enterprise. Enforcement (location cap, drop allowance) reads the org row only. The catalog is presentation/seed data used in just two places — seeding at creation and building upgrade_options in a 402 — never for enforcement. Proven: an Enterprise org set to 3 locations / 37 drops caps at exactly those numbers.
- **The pooled fork lives in one function.** `scopeLocation(pooled, locationId)` returns the org-level scope (null location) when pooled, else the location. Both preview and consume use it. `app_consume_drop_allowance` is an atomic, monotonic, race-safe upsert (increment only if under the limit; never decrement — a cancelled drop still consumed allowance). Proven both ways on one org by switching the flag.
- **Role gate.** `lib/auth/org-access.ts`: owner/admin reach org, billing, locations, staff, drop creation, and stats; merchant_staff is 403 on all of them (their only surface is Today's Code, WP-8). Drop creation (WP-6) and per-drop stats (WP-13) ship here as role-gated shells returning NOT_IMPLEMENTED for authorized callers; the WP-6/WP-13 and release gates assert none survives. WP-8 inherits a carried-forward grep that no redemption path reads the active address.
- **Locations are geocoded server-side** through the same `lib/geo/geocoder.ts`; the strict body rejects client lat/lng. Delete is a soft deactivate (drops reference the row). The Add Location control is always shown; the cap is a 402 with the upgrade payload, never a hidden control.
- **Org creation is self-serve** (creator becomes owner); Enterprise/custom limits require an admin caller.
- **Founder auth-seed fix.** The hand-seeded founder `auth.users` row left GoTrue's token columns NULL, which broke any GoTrue op on that email ("Database error checking email"). base.sql now sets them to '' so the founder can actually sign in — a latent WP-3 seed bug surfaced by using the founder (admin) in this gate.
- **The gate is `npm run wp5:gate`** (`scripts/wp5-gate.ts`) against a running dev server; catalog and cycle math are unit-tested in `tests/billing.test.ts`.

---

## WP-6 — Drop lifecycle

**Goal:** Create, schedule, publish, close, duplicate, encore.

**Dependencies:** WP-5

**Scope:**
- `POST|PATCH /v1/drops` — Local goes `draft → scheduled` directly
- Creation flow entered from the business profile/location, never a bare form
- Scheduler jobs: go-live (15s), close (15s)
- `POST /v1/drops/{id}/duplicate`
- `POST /v1/drops/{id}/encore` — available only from `gone`
- Allowance consumption on schedule; **never decremented on cancel**
- 402 soft block with one-click prorated upgrade

**Acceptance gate:**
- `PATCH` on a live drop returns `DROP_IMMUTABLE`
- A Local drop can never enter `submitted` or `approved`
- Create-then-cancel does not restore allowance
- Upgrade at cap unblocks creation inside the same request cycle
- No restock path exists anywhere in the codebase

**Decisions recorded 2026-09-13 (during WP-6 execution):**

- **Lifecycle.** `POST /v1/drops` creates a Local draft from a location (owner/admin; staff 403); a draft consumes no allowance. `publish:true` (or `PATCH {status:"scheduled"}`) schedules it, which consumes allowance and can 402. Scheduling consumes FIRST (authoritative), so a capped org never gets a scheduled drop. Cancel is `PATCH {status:"draft"}` and never restores allowance. Once live, `PATCH` on a frozen field is DROP_IMMUTABLE (the DB trigger is the enforcer; the API maps P0001 → DROP_IMMUTABLE). The WP-5 `NOT_IMPLEMENTED` shell is gone from `POST /v1/drops`.
- **Scheduler.** `runGoLive`/`runClose` in `lib/drops.ts`; go-live seeds Redis inventory (SET NX; WP-7 consumes it), close sets gone (sold out) or expired (window passed). Exposed via `POST /v1/admin/scheduler/tick` (admin) for testing/manual runs. **Production trigger is decided below (deployment prerequisite), not Vercel cron.** The job logic is concurrency-safe (see the release-gate line).
- **Encore is the only add-supply path.** Available only from `gone`; sets the parent `encore_pending` and creates a new draft with `parent_drop_id` set. The parent's quantity is never touched (verified). No restock path exists (grep-verified). Duplicate clones any drop to a new draft (`duplicated_from_id`), consuming no allowance until scheduled.
- **Prorated upgrade behind a Stripe interface.** `SubscriptionGateway` (`lib/billing/subscription.ts`) with a dev gateway; `STRIPE_SECRET_KEY` absent → dev. Two-layer production guard like the geocoder: env superRefine at boot + a runtime refusal in the factory. The upgrade is real, not a stub: it recomputes the org's stored limit columns from the TARGET tier's catalog, sets tier + subscription id, and unblocks scheduling in the same request. Idempotent via the catch contract's Idempotency-Key pattern (Redis claim + stored result) — a replay returns the same result and does not double-apply. Enterprise's arbitrary stored limits are untouched by the catalog (verified). **Downgrade is intentionally NOT built in WP-6** — a mid-cycle upgrade-then-downgrade is a real support case with no path yet; do not assume one exists.
- **The gate is `npm run wp6:gate`** (`scripts/wp6-gate.ts`) against a running dev server.

**Scheduler cadence — DECISION (deployment prerequisite for WP-13 / launch).**

A drop scheduled for 12:00:00 must go live within a second or two, not up to ~47s late. Vercel cron's 1-minute floor is therefore unacceptable for go-live. Decision:

- **Primary trigger: Upstash QStash per-drop scheduled messages.** At schedule time, enqueue one QStash message with an absolute `Upstash-Not-Before` = `live_at` that calls the go-live path, and one at `live_until` for close. QStash delivers at the target time to second-level accuracy — far better than any polling interval — and we already run Upstash, so no new vendor. QStash is at-least-once with retries, which is safe because the endpoint is idempotent (below).
- **Reconciliation sweep: the existing `POST /v1/admin/scheduler/tick`** on a 1-minute Vercel cron (or Supabase `pg_cron` + `pg_net`) as a catch-all that transitions any drop QStash missed (delivery failure, backlog, a drop scheduled during an outage). It is a safety net, not the primary path; its 1-minute lateness only matters if QStash failed.
- **Rejected:** Vercel cron alone (1-min floor breaks the promise); a dedicated always-on worker (a ~$5–7/mo process against the serverless model, and still polling); GitHub Actions cron (5-min floor).
- **Cost:** QStash free tier is ~500 messages/day; each drop uses 2 messages (go-live + close), so launch volume (a handful of drops/day in SLC) is $0. Beyond the free tier it is ~$1 per 100K messages — trivial at any realistic v1 volume.

Wire this in WP-13 (operator surfaces) or the deployment step; the job functions and the idempotent endpoint are already built in WP-6.

---

## WP-7 — The catch contract

**Goal:** Atomic catch under burst load. **The highest-risk package in the build.**

**Dependencies:** WP-6

**Scope:**
- Redis inventory seeding at go-live
- `POST /v1/catches` — `DECR`, position derivation, code minting, async Postgres write
- Idempotency via `Idempotency-Key` + Redis `SETNX`, 24h TTL
- Reconciliation job (60s) — logs drift, writes `quantity_remaining` **downward only**
- 4-character code, 24-symbol alphabet: `A C D E F G H J K M N P Q R T U V W X Y 3 4 5 6 7 9`

**Acceptance gate — load test required, not optional:**
- 5,000 concurrent catch requests against 100 units → exactly 100 catches, zero oversell
- Position numbers 1…100 with no duplicates
- A forced Postgres write failure burns the position number; the gap persists; no reuse
- Identical `Idempotency-Key` replayed 50 times consumes exactly one unit and returns the same position number
- `DROP_GONE` returns without a database round trip
- Catch → transfer away → catch again on the same drop returns `ALREADY_CAUGHT`
- No `NOT_IMPLEMENTED` response remains in `POST /v1/catches` — the WP-3 pre-flight placeholder is fully replaced

**This gate does not pass on unit tests.** Run the load test against staging with real Redis and real Postgres.

**Decisions recorded 2026-09-14 (during WP-7 execution):**

- **Hot path is Redis-only through the Gone decision.** Go-live seeds `drop:{id}:inventory` (SET NX) and `drop:{id}:meta` (quantity_total, live-window close, redeem window, title). A catch reads meta, checks the window, claims the Idempotency-Key (SET NX EX 24h) BEFORE the DECR, then `DECR inventory`. A value < 0 is DROP_GONE — returned with **zero Postgres round trips** (proven mechanically by counting PostgREST calls during a Gone against an exhausted drop: 0; a successful catch: exactly 1). Postgres is touched only to distinguish NOT_FOUND from DROP_NOT_LIVE when a drop is not seeded at all.
- **Position = quantity_total − post-decrement value** (first catch → 1). The Postgres write follows the committed Redis decision; a failed write BURNS the position (the gap is correct and never reused, because DECR only decreases). ALREADY_CAUGHT is the `one_catch_per_buyer_per_drop` unique violation on `original_user_id`, so catch → transfer → catch is refused at the database.
- **Idempotency** claims the key before the DECR; a replay returns the stored result (success or the Gone/error outcome) and consumes no second unit. Proven: 50 replays → one unit, one row, same position.
- **Reconciliation** (60s) writes `quantity_remaining` DOWNWARD only, to the Redis value, and never writes back to Redis; drift (burned positions) is logged, not corrected.
- **The Postgres write is awaited in the request** (so the response carries the real `catch_id` and the gate can count rows). Production may move it to a queue for lower latency with identical burn semantics; reconciliation is the safety net.
- **Load test harness (per the 2026-09-14 decision).** The 5,000-concurrent test drives `lib/catches.ts` directly against real Redis and real Postgres, because the HTTP auth layer loads the user row on every request (a DB round trip that would make the no-round-trip claim untestable at the HTTP layer) and would bottleneck on GoTrue rather than the catch contract. The HTTP endpoint is proven separately end-to-end. The report states achieved concurrency (max in-flight + DECR timestamp spread), not the requested count, and runs the test five times.
- **Redis for the load test is a local Redis behind SRH** (serverless-redis-http), which speaks the exact Upstash REST protocol. Chosen because one 5,000-request run (~20k commands) would blow the Upstash free-tier daily cap and a mid-run rate limit would masquerade as a concurrency bug. SRH↔Upstash-cloud DECR parity is checked (300 concurrent DECRs, identical final state) so the substitution is trusted. **The load test ran against SRH, not the production Upstash provider.**

- **CI regression guard.** The load test is a CI job (`load-test`) that runs on merge to master and nightly (not on every PR — it is slow), against a Supabase stack plus local Redis behind SRH. Every later package touches code near the catch paths, so this is what keeps oversell impossible without someone remembering to re-run it. **CI scale is a reduced 1,000 × 3** (`LOADTEST_USERS`/`LOADTEST_RUNS`), not the full 5,000 × 5: 1,000 concurrent is still an order of magnitude above the 100-unit contention point, so a reintroduced non-atomic check oversells and fails here, while the smaller scale keeps the job fast and reliable enough that it will not be disabled for flakiness. The full 5,000 × 5 remains the local/manual `npm run wp7:gate` default.
- **Load-harness environment finding (2026-09-14).** Firing 5,000 simultaneous localhost connections at the SRH proxy can saturate its (cold) accept queue: a fraction of requests fail with a client-side `fetch failed` before ever reaching the contract. This is a LOCAL-INFRA limit, NOT a contract limit — when it happened, no oversell occurred (exactly 100 catches, positions 1..100), the failures were undelivered requests, and warm runs sustained the full 5,000 cleanly. The harness therefore (a) warms the connection pool with a throwaway run before measuring, and (b) retries transient network errors with the **same Idempotency-Key**. The retry is safe precisely because the key makes a catch idempotent: a request that never reached the server executes fresh, and one that did returns its stored result — never a second unit. A future session seeing sporadic `fetch failed` at high fan-out should read it as connection saturation to fix in the harness, not a scarcity bug.

**PRE-LAUNCH (deployment prerequisite):** re-validate the burst path against the real Upstash cloud database before production traffic, at whatever scale the paid tier allows. SRH is a faithful local stand-in, not proof the production provider behaves identically under burst.

---

## WP-8 — Redemption

**Goal:** Code entry, geofence verification, and the two-path GPS failure model.

**Dependencies:** WP-7

**Scope:**
- `POST /v1/redemptions` with `gps_status` enum
- `fix_acquired` → distance and accuracy checks
- `permission_denied` → **blocked**, no redemption path
- `no_fix_timeout` → auto-redeem, flagged `unverified_timeout`, rate-limited 5 per 30 days
- Buyer keypad entry screen, 7-second client timeout
- Merchant Today's Code screen: codes, phonetic guidance, live feed with unverified marks
- Printable code sheet PDF: code, offer, date, expiration
- Velocity check flagging

**Acceptance gate:**
- `permission_denied` returns `LOCATION_PERMISSION_REQUIRED`, never redeems — **this is the bypass test, run it explicitly**
- `no_fix_timeout` redeems and records `unverified_timeout`
- Sixth `no_fix_timeout` in 30 days returns `RATE_LIMITED`
- Outside geofence with a good fix returns `OUTSIDE_GEOFENCE`
- No merchant-side redemption endpoint exists in the codebase
- Unverified flag never appears in any buyer-facing response

**Decisions recorded 2026-09-14 (during WP-8 execution):**

- **WP-7 correction: one code per drop (PRD §7.3), not per catch.** WP-7 minted a random per-catch code; the redemption mechanic (one printed sheet, staff reads it aloud) requires a per-drop code. Precedence (PRD > DATA-MODEL) makes per-drop authoritative. The code is now a `drops.code` column, **generated at go-live** (the moment Redis is seeded, never at create — a code must not sit on a scheduled drop), stored in Redis meta, and inherited by each catch (`catches.code` is a denormalized copy). Uniqueness across concurrently-live drops at a location is a partial unique index (`drops_live_code_per_location`); go-live regenerates on the astronomically-rare collision. DATA-MODEL §7.1/§8.1 and PRD §7.3 were amended to agree. **The full WP-7 load test was re-run (5×5,000, zero oversell) to confirm no regression** on the highest-risk path.
- **The two GPS failures stay different.** `permission_denied` → LOCATION_PERMISSION_REQUIRED, never redeems (the bypass test — browsers return denial instantly, so routing it to the timeout path would be a one-tap redeem-from-anywhere bypass). `no_fix_timeout` → auto-redeem flagged `unverified_timeout`. `fix_acquired` checks accuracy (floor 100m → GPS_ACCURACY_INSUFFICIENT) then distance to the LOCATION (→ OUTSIDE_GEOFENCE). GPS governs redemption; the buyer's saved/active address is never read (grep-verified, WP-4 item carried forward and now testable).
- **The rate limit is the control for the client-declared gps_status.** A malicious client can claim `no_fix_timeout` from home; the defense is a server-side count of the user's `unverified_timeout` redemptions in a **rolling 30-day window** (`redeemed_at > now() - 30 days`), not a calendar month. It is authoritative DB state the client cannot reset — a fresh Idempotency-Key does not bypass it (proven). The 6th in 30 days → RATE_LIMITED.
- **The unverified flag is never buyer-facing.** The redemption response carries no `method` field at all (present-for-verified / absent-for-unverified would itself leak). The flag lives only in the merchant feed (`GET /v1/locations/{id}/today`, which marks it) and admin review. API-CONTRACT §6 was amended to drop `method` from the response.
- **Redemption writes the clout source event** (WP-8 owns the row; WP-10 owns every derived value). Points are a named constant (`CLOUT_POINTS.redemption`), one place to tune. City is the MERCHANT location's city, never the buyer's address (clout is capped per city; the buyer's city would let a thin market be farmed from anywhere). Idempotent with the redemption (one redemption → one clout row). **Unverified auto-redeems still earn clout — a deliberate choice**: the rate limit is the fraud control, and denying clout would punish a buyer for a basement with no signal.
- **No merchant-side redemption or mark-in endpoint exists** (grep-verified); the only redemption route is the buyer's `POST /v1/redemptions`, which requires the caller's own catch. Velocity flagging (impossible-travel between a user's consecutive redemptions, using the merchant location coords) sets an advisory `velocity_flagged` for admin review, never blocks.
- **Merchant surfaces:** `GET /v1/locations/{id}/today` (codes with NATO-phonetic guidance + the live feed with unverified marks) and the printable `code-sheet.pdf` (pdf-lib, one page per live drop). Owner / admin / staff-of-location; staff's only reachable merchant surface. The buyer keypad's 7-second client timeout is a client behavior (WP-13 UI) that fires `no_fix_timeout`.
- **The gate is `npm run wp8:gate`** (`scripts/wp8-gate.ts`) against a running dev server.
- Re-run the active-address grep against the now-existing redemption and geofence code paths; no redemption path reads the active address (WP-4 gate item #2 becomes testable only once redemption exists) — **grep-verified**

---

## WP-9 — Transfers

**Goal:** One-hop wallet transfer with a live clock.

**Dependencies:** WP-8

**Scope:**
- `POST /v1/transfers`, accept, decline
- Handle autocomplete, rate-limited
- 5-minute `accept_by`; 30-minute pre-close send cutoff
- Server sweeper every 30s: expire past `accept_by`, void past `redeem_until`
- SMS on send, accept, and decline — regardless of follow tier or SMS preference
- Wallet Send tab UI

**Acceptance gate:**
- Second hop returns `TRANSFER_LIMIT_REACHED`
- Send inside 30 minutes of close returns `TRANSFER_CUTOFF_PASSED`
- Unaccepted transfer returns to sender at 5:00 with no client involvement — verified with the client fully offline
- Redemption window closing mid-transfer voids the transfer; the catch expires; **no orphan**
- Position number travels; clout does not
- Decline returns to the original holder, never to inventory

**Decisions recorded 2026-09-14 (during WP-9 execution):**

- **`handle-search` path conflict resolved (touches committed WP-3).** The
  contract named `GET /v1/users/me/handle-search` twice — WP-3 built it as
  registration availability (`?handle=` → `{available, reason}`); §7 defines it
  as the transfer autocomplete (`?q=` → handle+display_name). The contract
  canonically names the path autocomplete, so **availability moved** to the new
  unauthenticated `GET /v1/auth/handle-available`, and `handle-search` became the
  authenticated autocomplete. Availability now returns **`{available}` only** (no
  reason — taken, reserved, confusable, and malformed all look identical, keeping
  WP-3's rule that reserved handles never reveal themselves), judged on the same
  confusable-normalized form, and is **hard rate-limited by IP** (20/min) because
  it is unauthenticated. Contract §2 and §7 were amended to agree. The WP-3 gate
  exercises availability through registration (not the endpoint), so it is
  unaffected; re-run green.
- **Enumeration control on the autocomplete is the rate limit, not obscurity.**
  `handle-search` is authenticated, requires a 2-char minimum, returns only
  handle + display name (never user number, city, phone, email), excludes the
  caller, and is capped at 30/min per user server-side (a fresh request cannot
  reset it). Bulk namespace sweeping trips the limit — the same "the rate limit
  IS the fraud control" philosophy as the unverified-redemption cap.
- **transfer_count increments on ACCEPT, not on send.** A declined/expired/voided
  transfer never completed a hop, so it leaves the catch at `transfer_count = 0`
  and the sender free to try again. One accepted hop sets it to 1, and a second
  send is `TRANSFER_LIMIT_REACHED`. The one-hop limit is thus the *completed* hop.
- **Mutual exclusion is a conditional status flip on the catch, both directions
  (surgical WP-8 fix).** Send flips `held → transfer_pending` and redeem flips
  `held → redeemed`, each `WHERE status='held'`, so the DB serializes them and
  exactly one wins a given catch. Redeem previously updated the catch status
  unconditionally *after* inserting the redemption; that left a race where a send
  could interleave. Redeem now acquires the catch with the conditional flip
  *before* writing the redemption (rolling back to `held` on a write failure).
  The WP-8 gate was re-run green after the change.
- **Sweeper: void before expire, both concurrency-safe.** Pass 1 voids pendings
  whose catch window has closed (`catches.expires_at <= now`) → catch `expired`
  (dies with the window, no orphan); pass 2 expires pendings past `accept_by`
  with the window still open → catch back to `held` (to the sender). Void runs
  first so a transfer past the window is never handed back as a live catch. Each
  transition is a conditional `WHERE status='pending'` update, so two concurrent
  sweeps resolve any transfer exactly once (proven: two parallel sweeps, one
  winner). Under the 30-min send cutoff + 5-min accept window a pending never
  legitimately outlives its redemption window, so the void pass is a safety net;
  the gate constructs the guarded state directly to exercise it.
- **No SMS on expire/void.** The contract lists transfer SMS on send, accept, and
  decline only; an automatic expiry/void sends none. (Dev SMS is mirrored to a
  short-lived Redis list `dev:sms:<phone>` so an out-of-process gate can prove a
  send happened; the Twilio sender never writes it.)
- **`GET /v1/catches` (the §5 wallet) built here.** Left unbuilt it would hand the
  UI package an API gap — the Send tab needs held catches to send from. Scoped to
  the CURRENT holder (`user_id`), so an accepted transfer appears in the
  recipient's wallet and leaves the sender's; includes the drop's code (owner-only)
  since it is also the buyer's redemption surface. `GET /v1/catches/{id}` (detail)
  remains for a later WP. Proven in `wp9:gate` (held listing follows an accept).
- **WP-3 gate repaired to 17/17 (stale-gate hygiene).** Two failures unrelated to
  WP-3's logic: (1) its Redis client read `.env.local` (cloud) while the server
  writes local SRH — fixed to prefer `.env.development.local`; (2) it asserted the
  catch returns `NOT_IMPLEMENTED`, obsolete since WP-7 made catch Redis-authoritative
  — now it seeds Redis like go-live and asserts the real `201` catch. A gate that
  sits at 15/17 stops being read; fixed at the moment it was noticed rather than
  deferred.

---

## WP-10 — Clout, badges, whispers

**Goal:** The earned-status system.

**Dependencies:** WP-8

**Scope:**
- `clout_events` written server-side from exactly three sources
- Hourly recompute: decay, per-city percentile, five tiers, top-1% cap on tier 5
- Badges, separate from clout, no decay, no cap
- `POST /v1/whispers` — four dimensions anchored on would-return-at-full-price
- `GET /v1/orgs/{id}/whispers` — owner and admin only
- Share links, click attribution, clout on verified return click
- Merchant score recompute (daily), new merchants seeded at cohort median

**Acceptance gate:**
- No clout write path exists that is reachable from any client
- No admin clout grant endpoint exists
- Whisper is unreachable by any party other than author, owning org, and admin — verified by RLS test
- Tier 5 population never exceeds 1% of a city's active users
- Share without a verified return click earns zero

**Decisions recorded 2026-09-14 (during WP-10 execution):**

- **Scores are DERIVED from the append-only ledger; the recompute never mints
  clout.** `clout_events` has three writers, all in `lib/clout.ts`
  (`recordRedemptionClout` / `recordWhisperClout` / `recordShareClout`); none
  takes an amount or reason from a caller. `recomputeAllClout` reads the ledger
  and rewrites the materialized `clout_scores` — it is not a write path, and
  there is no admin grant endpoint. Points: redemption 10, whisper 5, verified
  share 15 (tunable constants in one place).
- **Decay = exponential, 30-day half-life, referenced to the top of the current
  hour.** Because a score is a pure function of (ledger, reference hour), running
  the hourly recompute twice in the same hour yields identical scores and never
  compounds (requirement 3). The recompute upserts on the `(user_id, city_id)` PK.
- **Tier 5 is a hard-capped leaderboard, not a percentile band.** It is the top
  `floor(activeUsers × 0.01)` users in the city (ties broken by user_id for a
  stable total order); tiers 1–4 are percentile bands (percentile = rank/N;
  ceilings 0.10 / 0.30 / 0.60). So tier-5 population can never exceed 1% (gate),
  and **below 100 active users the floor is 0 → tier 5 is UNREACHABLE** rather
  than rounded up to a lone permanent holder (requirement 2). "Active users" in a
  city = the distinct users with a clout event there (the ranked population).
  Clout events with a null city_id belong to no leaderboard and are skipped.
- **Share attribution (the flagged fraud surface).** Clout is granted ONLY by
  `POST /v1/shares/{token}/verify` — an authenticated returner confirming the
  return. A raw click at `/s/{token}` (served under `/v1/shares/{token}/click`
  via a next.config rewrite, so the handler stays under `/v1` per invariant #15)
  records analytics only and grants nothing, so **an unreturned share earns zero**
  (gate). Two rules: the returner must not be the sharer (no self-attribution),
  and the grant is claimed once with a conditional `verified_at IS NULL` update,
  so **repeat clicks — any source — never compound** (requirement 1). Platform-API
  content verification stays deferred; the tracked-link return is the v1 signal.
  Residual accepted in v1: a sharer could mint many links and have real distinct
  returners verify each — that is genuine reach, one grant per real return.
- **Badges are a separate, uncapped, non-decaying system** (`lib/badges.ts`,
  idempotent `awardBadge`). The clout recompute never touches `user_badges`. The
  badge CATALOG stays deliberately empty (an open product decision), so there are
  no slugs to award yet — this WP ships the award + read mechanism the catalog
  plugs into.
- **Merchant score (daily):** `redemption_rate = redemptions/catches` over a
  trailing 90 days (anchored to the top of the day → deterministic); `whisper_score`
  is a 0..1 composite over the window's whispers. New/insufficient merchants (no
  catches in the window) are seeded at the **cohort median** redemption_rate of
  orgs that do have data — never a punishing 0 or a gameable 1. Not a ranking input.
- **`GET /s/{token}` lives under `/v1`.** The architecture guard requires every
  route handler under `app/api/v1`; the short public URL is preserved by a
  next.config rewrite to `/v1/shares/{token}/click` rather than a root route.

**Decisions recorded 2026-09-15 (post-approval fix — a city-less location silently drops clout):**

- **`locations.city_id` is now NOT NULL, resolved at create from the geocoded
  coordinates** (`lib/cities.ts` `resolveCityId`: nearest city within 60 miles,
  matched regardless of the city's `active` flag). A location that maps to no
  supported city is a **create-time `VALIDATION_ERROR`** the merchant sees, never
  a silent downstream failure. Migration `20260915000100` backfills any legacy
  null-city location to its nearest city (dev-data hygiene; production is fresh)
  then sets the constraint. Root cause: `createLocation` geocoded lat/lng but
  never set `city_id`, so every clout event there joined no leaderboard silently.
- **The recompute counts events that join no city** (`skipped_no_city`, surfaced
  on `POST /v1/admin/clout/recompute`) and logs a warning. Expected value 0 —
  above 0 is a bug report that finds itself. Never a silent drop.
- **A null-city event retroactively joins on the next recompute** once its
  location has a city. The recompute derives each null-city event's city from its
  **live source record** (redemption/whisper → location → city, share → drop →
  city), not a frozen value, so nothing is permanently orphaned. Events written
  with a city keep it as an authoritative snapshot. (`clout_events` is
  append-only, so this resolve-at-read is also the only correct mechanism —
  the stored city can never be rewritten.)
- **Stale-gate hygiene (WP-9 standing directive, "WP-5's will be next"):** the
  WP-5 gate asserted `POST /v1/drops` → `501`, obsolete since WP-6 made drop
  creation real. Fixed to post a valid body and assert the real `201` (draft),
  keeping the per-drop-stats `501` (still a WP-13 placeholder). Re-run 17/17.

---

## WP-11 — Board and ranking

**Goal:** The landing surface.

**Dependencies:** WP-7, WP-10

**Scope:**
- `GET /v1/board` — On Fire + New per lane
- Ranking on `pct_remaining` ascending
- `drop_pressure` recompute (60s)
- Cold-start fallback: proximity for Local, fill-screen for Maker/Digital; 30 days or minimum events per city
- Nav tabs: Maker Drop, Local Drop, DigiDrop, Upcoming, Ending Soon — Maker/Digital tabs present but empty in v1
- Public `GET /v1/drops/{id}` — the shared-link surface
- Realtime channel: `inventory_changed`, `drop_gone`
- Drop card: absolute remaining **and** percentage; merchant redemption rate displayed
- **Category filter and type-ahead**
  - `GET /v1/tags/search?q=` — matches label and synonyms, minimum 2 chars, 150ms debounce
  - `GET /v1/board?tag_id=` — ranking runs **within the filtered set**, not globally
  - Secondary sorts: distance, ending soon
  - Filter state survives navigation — backing out of a drop returns to the filtered board
  - Group chips expand to include all child leaves

**Acceptance gate:**
- A 10-unit and a 200-unit drop at equal sell-through rank equally — percentage, not count
- Merchant redemption rate does not affect ordering
- Cold-start fallback engages for a new city and disengages on threshold
- Unauthenticated `GET /v1/drops/{id}` returns 200 with `can_catch: false` and a reason
- Realtime is display-only; catch success is decided solely by `POST /v1/catches`
- Type-ahead resolves a synonym to its leaf — "car wash" returns Auto Detail
- Type-ahead query uses `tag_search_document`; verified by EXPLAIN showing an index scan on `tags_search`, not a sequential scan. An index that exists but is not used is invisible until the table is large, and by then it is in production.
- No endpoint anywhere performs free-text search over drop titles or descriptions — **grep-verified**
- Filtering to a category, opening a drop, and navigating back preserves the filter

**Decisions recorded 2026-09-15 (during WP-11 execution):**

- **On Fire tie-break at equal `pct_remaining` = RECENCY (`live_at` DESC).** At the
  top of an hour every live drop is `pct_remaining` 1.0, so without a deliberate
  tie-break On Fire is whatever order the database returned. Recency is
  size-neutral (freshest-live surfaces first when nothing has heat yet). Catch
  velocity / absolute count were REJECTED: they favour the larger drop and would
  reintroduce the exact count bias the percentage metric exists to remove — the
  gate proves a smaller, newer, lower-rate drop still ranks above a bigger, older,
  higher-rate one at equal pct. Proximity belongs to the Local cold-start axis,
  not a global tie-break. Secondary sort in `lib/board.ts`: `pct asc, then live_at desc`.
- **`pct_remaining` from `drop_pressure`, recomputed every 60s in the scheduler
  tick** (after reconcile, so it reads the reconciled quantity). The board
  falls back to `quantity_remaining / quantity_total` for a drop that went live
  since the last recompute, so a just-live drop still appears (at the cold end).
- **Cold-start "events" = catches on drops in the city.** Fallback engages while
  a city is inside its window and disengages when `coldstart_days` elapse OR
  `coldstart_min_events` catches are recorded, whichever comes first (an
  unlaunched city, `launched_at` null, counts as in-window). `meta.ranking` is
  `proximity_fallback` when cold (Local → proximity, Maker/Digital → fill-screen),
  else `pressure`. Telemetry, not display.
- **Realtime is on the `drops` table** (added to `supabase_realtime`); a client
  subscribes and renders `quantity_remaining` / `status`, but the value is
  DISPLAY ONLY — the catch is decided solely by `POST /v1/catches` (Redis). Proven
  both directions: a false "gone" Postgres value still lets a catch succeed, and a
  false "available" value still returns `DROP_GONE`.
- **Type-ahead runs through the `search_tags` SQL function** so the query matches
  the `tags_search` GIN index expression exactly and the planner uses the index
  (EXPLAIN shows a Bitmap scan with `Recheck Cond: tag_search_document(...) @@ …`,
  not a Seq Scan). PostgREST cannot express a filter over a function-expression
  index, which is why the query lives in a function. The contract's "drop volume
  in the active city" final tiebreak is deferred (documented); ranking is
  exact-prefix, then label-over-synonym, then sort_order.
- **`/v1/drops/{id}` GET is `auth: none` with an OPTIONAL bearer**: an absent or
  invalid token yields `can_catch: false, reason UNAUTHENTICATED`; a valid one
  refines the reason (LOCATION_PERMISSION_REQUIRED / ALREADY_CAUGHT / …). `can_catch`
  is a display hint — a `true` never promises the catch; Redis remains authoritative.
- **Seed vs gate wording:** the gate item names `"car wash" → Auto Detail`, but the
  seeded taxonomy has **Car Wash as its own leaf** and **Auto Detailing** separate,
  so "car wash" resolves to the Car Wash leaf. The property (a synonym-only term
  resolves to its owning leaf) is proven with `"car detail"` → Auto Detailing
  (`matched_on = synonym`), the real synonym for that leaf. The product taxonomy
  was left unchanged.
- **Stale-gate hygiene:** the WP-6 concurrency gate read Redis with a hand-rolled
  REST GET against the cloud `.env.local` URL — wrong Redis and a response shape
  SRH does not match. Switched it to the `@upstash/redis` client with
  `.env.development.local` precedence (as WP-3's gate was fixed). The invariant it
  tests was always correct (`went_live=1`, seeded once); only the read-back was broken.

---

## WP-12 — Notifications

**Goal:** The demand engine.

**Dependencies:** WP-11

**Scope:**
- Follow/Fanatic with a 10-per-lane cap, independent pools
- Routing matrix (PRD §9.2)
- Web Push; SMS via provider; email via Resend
- Daily combined digest — Local on active address, Maker/Digital on tags
- Redemption-window-closing push, default 2h
- Nearly-gone push at ~85% claimed to viewers who did not catch
- Transfer SMS regardless of tier or preference
- **No quiet hours**

**Acceptance gate:**
- 11th Fanatic in a lane returns `FANATIC_LIMIT_REACHED` with current Fanatics for a swap
- Fanatic in one lane does not consume a slot in another
- No merchant-initiated path to set a user's tier exists
- Category/radius matches receive email only — never push, never SMS
- Digest respects `digest_hour_local`

**Decisions recorded 2026-09-15 (during WP-12 execution):**

- **Fan-out is a QUEUE, not a synchronous send.** Enqueue writes `notifications`
  rows (DB only — no provider call) and is what the triggering event does:
  `runGoLive` calls `enqueueDropLive`, the scheduler tick runs the window-closing
  / nearly-gone scans. Dispatch (`POST /v1/admin/notifications/dispatch`, its own
  cron cadence) drains the queue through the providers. So a drop going live to
  500 Fanatics writes 500 rows fast and a slow/failing provider can NEVER delay
  or block the go-live transition — go-live calls no provider. Enqueue in go-live
  is best-effort (try/catch): a failure to enqueue never un-lives a live drop.
- **Delivery idempotency is enforced two ways.** Enqueue writes one row per
  `(user, event, channel)` via `ON CONFLICT (user_id, dedup_key) DO NOTHING`
  (`dedup_key = '<kind>:<ref>:<channel>'`), so a retried fan-out never duplicates
  — "one per user per event" means one per channel (a Fanatic legitimately gets
  both an SMS and a push row for a drop-live). Dispatch CLAIMS each row with a
  conditional `sent_at IS NULL → now()` update before sending, so a retried or
  concurrent dispatcher never sends the same alert twice (proven: two dispatch
  runs → one SMS, one email).
- **Providers behind interfaces, dev impls, and a hard production guard.** Push
  joins SMS/email as a provider interface (`lib/push.ts`; DevPushSender logs +
  mirrors to Redis, WebPushSender uses `web-push` lazily). The dev SMS/email/push
  senders now REFUSE to run when `APP_ENV=production` (factory guard), and
  `TWILIO_*`, `RESEND_*`, `VAPID_*` were added to the boot-time `PRODUCTION_REQUIRED`
  set — a dev sender cannot reach production two ways over (env test asserts it).
- **Routing matrix (§9.2) by tier.** Drop-live: Fanatic → SMS + push, Follower →
  push + in-app, category/radius match (not following) → email only. Channels are
  gated by the user's notification prefs (`push/email/sms_enabled`); in-app is
  never gated; transfer SMS bypasses prefs entirely (WP-9). No quiet hours.
- **"Nearly gone / viewed" ≈ Fanatics + Followers who did not catch (KNOWN
  BEHAVIOR, not a gap).** v1 has no per-user view tracking, and the matrix scopes
  nearly-gone to those tiers, so "viewed" is taken as "was notified of the drop."
  Consequence: a Fanatic/Follower who never opened the drop still gets the
  nearly-gone push — mildly noisy, never wrong (it only reaches people who asked
  to hear about the org). Precise per-user view tracking is a deliberate later
  addition, not a defect.
- **Digest hour is resolved against the user's IANA TIMEZONE, DST-correct — never
  UTC.** `digest_hour_local` is a local hour, so comparing it to a UTC hour would
  page a Salt Lake buyer at 1–2am. Users carry a `timezone` (IANA name), defaulted
  at registration from their Home city (`cities.timezone`; launch market = Utah =
  `America/Denver`); the hourly digest computes each user's local hour with
  `Intl.DateTimeFormat` (handles DST). Resolution order: the user's timezone, else
  the active address's city timezone, else the launch-market default — never UTC.
  One combined email per user per LOCAL day. Local drops match the active
  address's city, Maker/Digital on preference tags.
- **Test-infra:** the openapi test now builds the spec ONCE in `beforeAll` and
  asserts synchronously — regenerating it per-test (×6) imported the whole route
  set six times and starved the file under the parallel suite, producing flaky
  timeouts as the route count grew. The env/health tests were updated for the new
  production-required providers.

---

## WP-13 — Buyer and operator UI

**Goal:** The shipped surfaces.

**Dependencies:** WP-12

**Scope — buyer:** Board, Drop Detail, Called It (wallet + Send), Gone/Encore graveyard, Local keypad, You.
Departure-board aesthetic: split-flap tiles, transit typography, amber/rust. **Discrete inventory pips, never a percentage progress bar.**

**Scope — operator:** Today dashboard, Drops list with duplicate, New/Edit Drop entered from location, per-drop Stats, Whispers read-only, Account/billing, persistent top-right scoreboard.

**Acceptance gate:**
- Scoreboard is visible on every operator screen
- Add Location is visible at every tier; paywall fires rather than hiding the control
- Gone drops remain browsable
- Copy contains no urgency language, no explanatory scaffolding, no raised voice
- Responsive: usable on mobile and desktop

---

## WP-14 — Admin portal

**Goal:** Platform operations.

**Dependencies:** WP-13

**Scope:**
- Org and buyer management, suspend, delist, clout freeze
- City configuration: radius, cold-start window, event threshold, IANA timezone (WP-12)
- Fraud review: unverified redemptions, velocity flags, transfer patterns
- **Buyer risk profile** — internal, admin-only (added 2026-09-16; PRD §11.4.1). Tracks cost imposed, not virtue: redemption rate, abandoned catches, transfer patterns, whisper rate (low-weight positive). Return rate / chargebacks / disputes extend it in Phase 2 (WP-16); the table carries the columns now. Thresholds flag for human review, never auto-suspend; minimum event counts before a rate can flag.
- Taxonomy management
- Upcoming picks (stub — tab exists, lanes do not)
- Platform metrics including the saved-address demand map
- **Audit log on every admin action, no exceptions**

**Acceptance gate:**
- Every admin mutation writes actor, before, after, and IP
- Audit log is not updatable or deletable by any role
- Transfer pattern view surfaces one account receiving from many senders
- The buyer risk profile is unreachable by any non-admin role — RLS-verified across roles (anon, non-admin, admin), not asserted from code

---

## v1 RELEASE GATE

All of the following, before launch:

- [ ] WP-2 invariant suite passes in full
- [ ] WP-7 load test: 5,000 concurrent, zero oversell, no duplicate positions
- [ ] WP-8 bypass test: `permission_denied` cannot redeem
- [ ] WP-9 offline test: transfer expires server-side with the client disconnected
- [ ] No endpoint from API-CONTRACT §14 exists in the codebase — **grep-verified**
- [ ] No `NOT_IMPLEMENTED` (501) response remains anywhere in the codebase — **grep-verified**
- [ ] `openapi.json` matches implementation
- [ ] Lint boundary rules active and unsuppressed
- [ ] Precise scheduler trigger wired (QStash per-drop go-live/close), not Vercel cron; the `/v1/admin/scheduler/tick` sweep is the reconciliation net only
- [ ] Scheduler jobs are safe under concurrent execution — two tickers firing at once transition a drop exactly once and seed Redis inventory exactly once. Guaranteed by: the transition UPDATE is conditional on the current status and RETURNs the row, so exactly one ticker wins and only the winner proceeds; Redis seeding is SET NX (a duplicate seed is a no-op); allowance is consumed at *schedule*, never at go-live, so go-live cannot double-consume. Proven in `wp6:gate` with two concurrent ticks
- [ ] One real merchant runs one real drop end to end in production

---

# PHASE 2 — MAKER DROP

## WP-15 — Curation workflow
Admin approval queue. `submitted → approved | rejected` with reasons. Scheduling after approval. **Local remains auto-publish and must not be routed through this queue.**

## WP-16 — Payments
Stripe Connect, maker onboarding and KYC, payouts, marketplace tax nexus, 1099-K. **Plan as its own project — this is the largest hidden scope item in the roadmap.**
**No platform percentage of any transaction.** Revenue remains the flat subscription.

**Subscription upgrade (from WP-6):** the WP-6 dev `SubscriptionGateway` must be replaced by a real Stripe implementation here. Proration MUST use `proration_behavior=always_invoice`, and the Stripe **webhook** is what confirms the charge — never the synchronous API response. The interface (`lib/billing/subscription.ts`) is unchanged; only the gateway impl and a webhook handler are added. Also add a downgrade path (deferred in WP-6): a merchant who upgrades mid-cycle currently has **no path back down** — a real support case (buyer's-remorse upgrade, seasonal downshift) that WP-6 cannot handle. Surface it here rather than discover it in support.

## WP-17 — Orders and invoicing
Order table with date/product-ID sort and per-row action buttons. Auto-generated invoice, PDF export. **Tracking capture mandatory before `shipped`.**

## WP-18 — RMA and returns
Two paths: vendor error 100% including original shipping; buyer error 80% with a 20% restocking fee **retained by the maker, never the platform**.
**Refund blocked in code until `received_at` is non-null. No override endpoint. No admin bypass.**
Fee disclosure on the drop page pre-catch, on the invoice, and in the RMA flow.

**Acceptance gate:** refund before receipt fails at the database layer; vendor-error RMA with a non-zero fee fails at the database layer.

## WP-19 — Maker portal
Product management, order table, RMA queue, payout view.

## WP-20 — IP and takedown
Versioned maker agreement with timestamp, IP, user agent. Public takedown intake, counter-notice handling, logged repeat-infringer strikes.
**Registered DMCA agent and a published procedure are launch blockers, not features.**

## WP-21 — Native clients
iOS and Android against the existing `/v1` API. **Zero new backend work if WP-1 held the boundary.** Delivers reliable background push and background geolocation.

---

# PHASE 3 — DIGIDROP

## WP-22 — Digital delivery
File hosting, license issuance, download entitlement, watermarking.

## WP-23 — Practitioner sessions
Scheduling, session delivery, no-show policy.

## WP-24 — Live streaming
Single camera, no cuts, no pause, no production. 20-minute pre-drop story window. Stream terminates on sellout with a Gone card showing elapsed time. Vendor undecided.

## WP-25 — Phase 3 legal
IP counsel review of the recorded-session / watermark / statutory damages clause ($250K ceiling). **Launch blocker.**

---

## SEQUENCING NOTES

**Critical path:** WP-1 → WP-2 → WP-3 → WP-5 → WP-6 → WP-7 → WP-8 → WP-11 → WP-13

**Parallelizable:** WP-4 alongside WP-5. WP-10 alongside WP-9. WP-14 alongside WP-13.

**Do not compress WP-7.** The catch contract is the only package where a subtle bug is invisible in testing and catastrophic in production. An oversold drop breaks the single promise the entire product rests on. Budget real time for the load test.

**Do not start WP-16 inside Phase 2 without separate planning.** Payments reopens tax, compliance, and money-movement scope that is larger than several v1 packages combined.

---

*End of BUILD-PLAN v1.0*
