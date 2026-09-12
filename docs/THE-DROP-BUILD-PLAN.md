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

**This gate does not pass on unit tests.** Run the load test against staging with real Redis and real Postgres.

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

**Acceptance gate:**
- A 10-unit and a 200-unit drop at equal sell-through rank equally — percentage, not count
- Merchant redemption rate does not affect ordering
- Cold-start fallback engages for a new city and disengages on threshold
- Unauthenticated `GET /v1/drops/{id}` returns 200 with `can_catch: false` and a reason
- Realtime is display-only; catch success is decided solely by `POST /v1/catches`

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
- City configuration: radius, cold-start window, event threshold
- Fraud review: unverified redemptions, velocity flags, transfer patterns
- Taxonomy management
- Upcoming picks (stub — tab exists, lanes do not)
- Platform metrics including the saved-address demand map
- **Audit log on every admin action, no exceptions**

**Acceptance gate:**
- Every admin mutation writes actor, before, after, and IP
- Audit log is not updatable or deletable by any role
- Transfer pattern view surfaces one account receiving from many senders

---

## v1 RELEASE GATE

All of the following, before launch:

- [ ] WP-2 invariant suite passes in full
- [ ] WP-7 load test: 5,000 concurrent, zero oversell, no duplicate positions
- [ ] WP-8 bypass test: `permission_denied` cannot redeem
- [ ] WP-9 offline test: transfer expires server-side with the client disconnected
- [ ] No endpoint from API-CONTRACT §14 exists in the codebase — **grep-verified**
- [ ] `openapi.json` matches implementation
- [ ] Lint boundary rules active and unsuppressed
- [ ] One real merchant runs one real drop end to end in production

---

# PHASE 2 — MAKER DROP

## WP-15 — Curation workflow
Admin approval queue. `submitted → approved | rejected` with reasons. Scheduling after approval. **Local remains auto-publish and must not be routed through this queue.**

## WP-16 — Payments
Stripe Connect, maker onboarding and KYC, payouts, marketplace tax nexus, 1099-K. **Plan as its own project — this is the largest hidden scope item in the roadmap.**
**No platform percentage of any transaction.** Revenue remains the flat subscription.

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
