# THE DROP — API CONTRACT

**Version:** 1.0
**Companion to:** THE-DROP-PRD.md, THE-DROP-DATA-MODEL.md
**Base path:** `/v1`

---

## 0. THE MANDATE

The web application is a **client**, not the product.

Every capability in this document MUST be reachable by an identical HTTP call from a native iOS or Android client. If the web client can do something the API cannot express, the architecture has been violated.

**Hard rules:**

1. **No business logic in React components.** No direct database access from the UI layer. No Supabase client queries from the browser for anything beyond realtime board subscriptions.
2. **No Next.js server actions for mutations.** Server actions are not callable from a native client. Every mutation is an HTTP endpoint.
3. **All state decisions are server-side.** Inventory, position numbers, clout, code validation, geofence verification, subscription limits. The client is never trusted with any of them.
4. **An OpenAPI 3.1 specification MUST be generated from the route definitions and committed.** That file is the native contract. Drift between it and the implementation is a build failure, not a documentation issue.
5. **Versioned path prefix.** `/v1` today. A native client in the field must not break when web ships.

---

## 1. CONVENTIONS

### 1.1 Auth

Supabase Auth JWT in the header. Same token for web and native.

```
Authorization: Bearer <jwt>
```

### 1.2 Request headers

| Header | Required | Purpose |
|---|---|---|
| `Authorization` | On authed routes | JWT |
| `Idempotency-Key` | On `POST /catches`, `POST /redemptions`, all payment routes | Client-generated UUIDv4 |
| `X-Client` | Yes | `web` \| `ios` \| `android` — telemetry and capability gating |
| `X-Client-Version` | Yes | Semver |

### 1.3 Response envelope

Success:
```json
{ "data": { ... }, "meta": { ... } }
```

Error:
```json
{
  "error": {
    "code": "DROP_GONE",
    "message": "This drop is Gone.",
    "details": { }
  }
}
```

**Error codes are stable contract.** Native clients branch on `code`, never on `message`. Messages may be reworded; codes may not.

### 1.4 Canonical error codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Authenticated, not permitted |
| `LOCATION_PERMISSION_REQUIRED` | 403 | User has not granted location permission |
| `ACCOUNT_SUSPENDED` | 403 | |
| `NOT_FOUND` | 404 | |
| `DROP_GONE` | 409 | Inventory exhausted |
| `DROP_NOT_LIVE` | 409 | Not yet live, or expired |
| `ALREADY_CAUGHT` | 409 | One catch per buyer per drop |
| `ALREADY_REDEEMED` | 409 | One redemption per catch |
| `OUTSIDE_GEOFENCE` | 409 | Good GPS fix, out of radius |
| `GPS_ACCURACY_INSUFFICIENT` | 422 | Accuracy worse than floor; retry |
| `INVALID_CODE` | 422 | |
| `REDEMPTION_WINDOW_CLOSED` | 409 | |
| `TRANSFER_CUTOFF_PASSED` | 409 | Inside 30 minutes of window close |
| `TRANSFER_LIMIT_REACHED` | 409 | One hop only |
| `TRANSFER_EXPIRED` | 409 | Past the 5-minute accept window |
| `FANATIC_LIMIT_REACHED` | 409 | 10 per lane |
| `ALLOWANCE_EXHAUSTED` | 402 | Soft block — response carries upgrade payload |
| `DROP_IMMUTABLE` | 409 | Edit attempted on a live drop |
| `HANDLE_LOCKED` | 409 | Already changed once |
| `HANDLE_TAKEN` | 409 | |
| `RATE_LIMITED` | 429 | |
| `VALIDATION_ERROR` | 422 | |
| `INTERNAL_ERROR` | 500 | Unexpected server failure. `details` is always `{}`; internals are never exposed |
| `NOT_IMPLEMENTED` | 501 | A route exists but a step it depends on is not built yet. Names the pending work package in `details`. Never used for a genuine failure |
| `NOT_READY` | 503 | `GET /v1/ready` only. A dependency did not respond; `details.checks` names each |

### 1.5 Pagination

Cursor-based. Offset pagination is forbidden — the board mutates continuously and offsets produce duplicates and gaps.

```
GET /v1/drops?cursor=<opaque>&limit=20
→ { "data": [...], "meta": { "next_cursor": "...", "has_more": true } }
```

### 1.6 Idempotency

`POST /catches` and `POST /redemptions` MUST be idempotent. The key is held in Redis with a 24-hour TTL. A repeat with the same key returns the original response, including the original position number. It does not consume a second unit.

This is not optional. Mobile networks retry, and without it a dropped response consumes inventory the buyer never received.

### 1.7 Liveness and readiness

Two operational routes. Both are unauthenticated, both are exempt from the `X-Client` / `X-Client-Version` requirement in §1.2, and both appear in `openapi.json`.

**`GET /v1/health` — liveness.** Answers "is the app running." No dependency pings.

```json
{ "data": { "status": "ok", "env": "local" | "staging" | "production", "version": "<semver>" }, "meta": {} }
```

This is what uptime monitors and Vercel hit. It must never depend on Supabase or Redis: a dependency hiccup must not mark the platform down, or trigger a restart, while every catch is still succeeding.

**`GET /v1/ready` — readiness.** Answers "is the app wired." Pings Supabase and Redis with a short timeout.

```json
200 → { "data": { "status": "ready", "checks": { "supabase": "ok", "redis": "ok" } }, "meta": {} }
503 → { "error": { "code": "NOT_READY", "message": "A dependency did not respond.", "details": { "checks": { "supabase": "ok", "redis": "failed: <reason>" } } } }
```

An unconfigured environment is also `503 NOT_READY`, with `details.env` listing each missing variable. Not for monitors. Used by engineers and CI to confirm an environment is actually wired.

---

## 2. AUTH AND REGISTRATION

### Session model and security posture — DOCTRINE

The session is a Supabase Auth JWT, the same token for web and native. The web
client is a plain Bearer client: it stores the tokens itself and sends
`Authorization: Bearer <jwt>`. There is no cookie path. Because the refresh
token therefore lives in browser-accessible storage, the following constraints
close the XSS surface and MUST NOT be relaxed:

- **Access token in memory only.** Never localStorage, never sessionStorage. It
  is lost on reload and re-obtained via the refresh token. Access token TTL is
  15 minutes.
- **Refresh token rotation with reuse detection.** Every refresh returns a new
  token; a replayed token invalidates the whole family and forces re-auth. This
  is delegated to GoTrue (rotation and reuse detection enabled), which is the
  authority on sessions.
- **No `dangerouslySetInnerHTML` anywhere.** Enforced by lint at error level.
- **All authored text is rendered as text, never HTML**, and sanitized on write
  — drop titles, descriptions, terms, whisper notes, handles, org names.
- **Strict CSP** on every response: no `unsafe-inline`, no `unsafe-eval`, a
  per-request script nonce, explicit `connect-src`.
- **`state` is single-use and expires in 10 minutes**, and `return_to` is
  validated against internal paths only before any redirect. An open redirect in
  the callback is the other way this gets exploited.

### `POST /v1/auth/oauth/start`
Begins the flow. Server-side PKCE: the code verifier and the validated
`return_to` are held in Redis keyed by a single-use `state`.

```json
{ "provider": "google" | "apple", "return_to": "/drops/abc123" }
```
```json
{ "data": { "authorize_url": "https://…", "state": "…" } }
```

The client opens `authorize_url`. The provider returns to the callback with the
same `state`.

### `POST /v1/auth/oauth/callback`
Exchanges an OAuth code for a session. Consumes the `state` (single-use),
exchanges the code for an identity, mints the session, and reports registration
status and the preserved intent.

```json
{
  "data": {
    "session": { "access_token": "…", "refresh_token": "…", "expires_in": 900, "expires_at": 0, "token_type": "bearer" },
    "registration_complete": false,
    "missing_fields": ["handle", "phone", "address"],
    "return_to": "/drops/abc123"
  }
}
```

`return_to` carries the pre-auth intent through the round trip. **The client
MUST honor it.** A user arriving from a shared drop link returns to that exact
drop, unlocked.

Errors: `UNAUTHENTICATED` (invalid/expired state), `VALIDATION_ERROR`.

### `POST /v1/auth/refresh`
Rotates a refresh token. Returns a new session; a stale or replayed token is
`UNAUTHENTICATED`.

```json
{ "refresh_token": "…" }  →  { "data": { "session": { … } } }
```

### `POST /v1/auth/register/complete`
Collects the fields OAuth does not supply. Requires a valid session.

```json
{
  "full_name": "string",
  "handle": "string",
  "phone": "+1...",
  "address": { "label": "Home", "line1": "...", "city": "...", "region": "...", "postal_code": "...", "country": "US" }
}
```
Assigns `user_number` from the sequence, sets the address as Home and active,
sends the SMS code, and sends the profile-completion email. Full profile
configuration (preference tags, extra addresses, Fanatics) is deferred to that
email, not a signup blocker.

**Handle format** (validated identically client and server; rejected with
`VALIDATION_ERROR` naming the specific rule):
- 3–20 characters, lowercase `a–z`, digits, and underscore; input is lowercased.
- No leading/trailing underscore, no consecutive underscores.
- Must contain at least one letter.
- Uniqueness is enforced on a **normalized form** (underscores stripped; `0→o`,
  `1→l`, `5→s`, `rn→m`, `vv→w`), so confusable handles cannot coexist.
- Reserved handles (system, profanity, brand) return `HANDLE_TAKEN` — the
  namespace never reveals which names are special.

Errors: `HANDLE_TAKEN`, `VALIDATION_ERROR`.

### `GET /v1/auth/handle-available?handle=`
Availability check for the registration UI. **Unauthenticated** — it runs before
a session exists — so it is an open enumeration surface and is **rate limited
hard by client IP** (20/min). It returns **only** `{ available }`: taken,
reserved, confusable, and malformed handles are all reported `available: false`
with no reason, so the namespace never reveals which names are special.
Availability is judged on the confusable-normalized form, so a handle reported
available here is not then rejected at submit for colliding with an existing one.
```json
{ "data": { "available": false } }
```
Errors: `RATE_LIMITED`.

> The authenticated handle **autocomplete** for the transfer send flow is a
> different endpoint — `GET /v1/users/me/handle-search?q=` (§7).

### `POST /v1/auth/phone/verify/send`
### `POST /v1/auth/phone/verify/confirm`
`{ "code": "123456" }` — sets `phone_verified_at`. Send is rate limited 5/hour
per phone; a code expires in 10 minutes and burns after a few wrong attempts.
The SMS goes through a provider interface; a dev sender logs the code when
Twilio is not configured.

### `POST /v1/users/me/location-permission`
```json
{ "granted": true }
```
Sets `location_perm_granted_at`. **Hard gate.** Until non-null, `POST /catches`
and `POST /redemptions` both return `LOCATION_PERMISSION_REQUIRED`. Denial is a
blocking state, never an alternate path.

### `GET /v1/users/me`
Full self profile: `user_number` (raw and zero-padded to 14 for display),
handle, identity, roles, clout tier, badges, addresses, active address, follows,
preference tags, notification prefs, and walkthrough state. The auth uid is
never included.

### `PATCH /v1/users/me`
Mutable: `full_name`, `handle` (once), `email`, notification prefs.
Immutable — rejected with `VALIDATION_ERROR`: `user_number`, `phone` (separate
verified flow), and any unknown field. `handle` after the first change is
`HANDLE_LOCKED`.

Errors: `HANDLE_LOCKED`, `HANDLE_TAKEN`, `VALIDATION_ERROR`.

### `POST /v1/users/me/walkthrough/complete`
### `POST /v1/users/me/walkthrough/skip`
First-session tooltip walkthrough. Both set `walkthrough_completed_at` (a
nullable timestamp, per account so a second device does not replay it). Skip
exists so a dismissed walkthrough does not replay forever.

---

## 3. ADDRESSES

### `GET /v1/addresses`
### `POST /v1/addresses`
```json
{ "label": "Marriott Manhattan", "line1": "...", "city": "New York", "region": "NY", "postal_code": "10036", "radius_miles": 5 }
```
Geocoded server-side. Client never supplies lat/lng.

### `PATCH /v1/addresses/{id}`
### `DELETE /v1/addresses/{id}`
Home cannot be deleted. Deleting the active address falls back to Home.

### `PUT /v1/users/me/active-address`
```json
{ "address_id": "uuid" }
```
Drives the Local board, the Local digest, and radius matching.

**Governs discovery only.** Never consulted at redemption.

### `GET /v1/users/me/location-drift`
Returns a switch suggestion when GPS reads persistently distant from the active address. **Advisory only.** The server never switches the active address on its own.

---

## 4. BOARD AND DROPS

### `GET /v1/board`

The landing board. Returns On Fire and New per lane.

```
?lane=local|maker|digital     (optional, omit for all)
?address_id=uuid              (defaults to active address)
```

```json
{
  "data": {
    "local":   { "on_fire": [DropCard], "new": [DropCard] },
    "maker":   { "on_fire": [DropCard], "new": [DropCard] },
    "digital": { "on_fire": [DropCard], "new": [DropCard] }
  },
  "meta": { "city_id": "uuid", "cold_start": true, "ranking": "proximity_fallback" }
}
```

**Ranking is `pct_remaining` ascending.** Lower remaining = hotter. Server-computed from `drop_pressure`.

**Cold start:** when the city is inside its window, ordering falls back to proximity (local) and fill-screen (maker/digital). `meta.ranking` tells the client which mode is active — for telemetry, not for display.

### `GET /v1/board/upcoming`
Admin hand-picked previews. Maker and Digital only.

### `GET /v1/board/ending-soon`
Ordered by `redeem_until` ascending.

### `GET /v1/drops/{id}`

**Public — no auth required.** This is the shared-link surface.

```json
{
  "data": {
    "id": "uuid",
    "lane": "local",
    "title": "...",
    "description": "...",
    "terms": "...",
    "image_urls": [],
    "quantity_remaining": 12,
    "pct_remaining": 0.24,
    "price_cents": null,
    "restocking_fee_bps": null,
    "live_until": "...",
    "redeem_from": "...",
    "redeem_until": "...",
    "status": "live",
    "merchant": {
      "org_id": "uuid",
      "name": "...",
      "redemption_rate": 0.87,
      "location": { "name": "...", "city": "...", "lat": 0, "lng": 0 }
    },
    "can_catch": false,
    "catch_blocked_reason": "UNAUTHENTICATED"
  }
}
```

`can_catch` is **server-computed** and accounts for auth, location permission, prior catch, and drop state. The client renders it; it does not decide it.

`merchant.redemption_rate` is displayed on the card. It is **not** a ranking input.

**Phase 2 requirement:** for `lane='maker'`, `restocking_fee_bps` MUST be present in this response. Pre-purchase disclosure is what makes the fee enforceable.

### `GET /v1/drops/{id}/catches`
Public position board — handles and position numbers of catchers. This is the scarcity artifact and it is deliberately visible.

### Realtime

```
Channel: drop:{drop_id}
Events:  inventory_changed { quantity_remaining, pct_remaining }
         drop_gone { gone_at, total_catches }
```

**Realtime carries display state only.** A client MUST NOT decide a catch will succeed based on a realtime value. Only `POST /catches` decides.

---

## 5. THE CATCH

### `POST /v1/catches`

The single most important endpoint in the system.

```
Headers: Authorization, Idempotency-Key
Body:    { "drop_id": "uuid" }
```

**Server sequence:**

1. Verify auth, not suspended, `location_perm_granted_at` non-null
2. Check idempotency key → replay if present
3. Verify drop is `live`
4. `DECR drop:{id}:inventory` in Redis
5. `< 0` → return `DROP_GONE` immediately. **Do not re-increment.**
6. `>= 0` → derive `position_number`, mint 4-char code, write catch row
7. Store idempotency result

```json
{
  "data": {
    "catch_id": "uuid",
    "position_number": 47,
    "code": "K7MX",
    "expires_at": "...",
    "drop": { "id": "uuid", "title": "..." }
  }
}
```

Errors: `DROP_GONE`, `DROP_NOT_LIVE`, `ALREADY_CAUGHT`, `LOCATION_PERMISSION_REQUIRED`, `ACCOUNT_SUSPENDED`

**Invariants at this endpoint:**
- One catch per buyer per drop — enforced on `original_user_id`, so catch-transfer-catch is impossible
- Position numbers permanent, never reused; a failed write burns the number and the gap is correct
- No release path exists. There is no `DELETE /v1/catches/{id}` and none may be added.

### `GET /v1/catches` — the wallet
```
?status=held|transfer_pending|redeemed|expired   (optional)
```
The caller's catches as **current holder** (an accepted transfer appears in the
recipient's wallet and leaves the sender's), newest first. Includes the drop's
code — the buyer owns it and types it at redemption. The Send tab reads
`?status=held`.
```json
{
  "data": [
    {
      "id": "uuid", "status": "held", "position_number": 12, "code": "K7MX",
      "transfer_count": 0, "caught_at": "...", "expires_at": "...",
      "drop": { "id": "uuid", "title": "..." }
    }
  ]
}
```

### `GET /v1/catches/{id}`
Returns the code, position number, expiry, and merchant location.

---

## 6. REDEMPTION

### `POST /v1/redemptions`

```
Headers: Authorization, Idempotency-Key
```
```json
{
  "catch_id": "uuid",
  "code": "K7MX",
  "location": { "lat": 40.7608, "lng": -111.8910, "accuracy_m": 12.4 },
  "gps_status": "fix_acquired"
}
```

**`gps_status`** — one of:

| Value | Server behavior |
|---|---|
| `fix_acquired` | Verify distance against `geofence_radius_m`. Reject `OUTSIDE_GEOFENCE` if out. Reject `GPS_ACCURACY_INSUFFICIENT` if accuracy worse than floor. Records `gps_verified`. |
| `permission_denied` | **Rejected — `LOCATION_PERMISSION_REQUIRED`.** No redemption path exists for this state. |
| `no_fix_timeout` | **Auto-redeem.** Records `unverified_timeout`. Rate-limited per user. |

**Why `permission_denied` must never redeem:** browsers return denial instantly. If denial routed to the timeout path, disabling location would be a one-tap redeem-from-anywhere bypass, distributable in a single forum post.

**Why `no_fix_timeout` must redeem:** the customer is standing at the counter in front of a paying merchant. The product cannot break in that moment. Basements, malls, and concrete are real.

The client fires `no_fix_timeout` after a **7-second** wait with permission granted and no fix.

The `unverified` flag is invisible to the customer, visible in the merchant live feed and admin fraud review.

**The redemption response carries no `method` field.** Returning it (or omitting it only for unverified) would leak the unverified flag to the buyer. The method lives only in the merchant feed (`GET /v1/locations/{id}/today`) and admin review.

```json
{
  "data": {
    "redemption_id": "uuid",
    "redeemed": true,
    "clout_earned": 10,
    "whisper_prompt": true
  }
}
```

Errors: `INVALID_CODE`, `ALREADY_REDEEMED`, `OUTSIDE_GEOFENCE`, `GPS_ACCURACY_INSUFFICIENT`, `REDEMPTION_WINDOW_CLOSED`, `LOCATION_PERMISSION_REQUIRED`, `RATE_LIMITED`

**The operator never calls this endpoint.** There is no merchant-side redemption or mark-in route, and none may be added.

---

## 7. TRANSFERS

### `POST /v1/transfers`
```json
{ "catch_id": "uuid", "to_handle": "string" }
```

Server checks: catch is `held`, caller is current holder, `transfer_count < 1`, `now() <= redeem_until - 30 minutes`, recipient exists and is not the sender.

Sets `accept_by = now() + 5 minutes`. Sends SMS to the recipient regardless of their follow tier or SMS preference.

Errors: `TRANSFER_LIMIT_REACHED`, `TRANSFER_CUTOFF_PASSED`, `NOT_FOUND`, `VALIDATION_ERROR`

### `GET /v1/transfers/incoming`
### `POST /v1/transfers/{id}/accept`
Moves `catches.user_id`. **Position number travels. Clout does not** — clout writes on redemption, keyed to who actually redeems.

Errors: `TRANSFER_EXPIRED`

### `POST /v1/transfers/{id}/decline`
Returns to the original holder immediately. **Never to the inventory pool.**

### `GET /v1/users/me/handle-search?q=`
Autocomplete for the send flow. **Authenticated.** Returns handle and display
name only — never the user number, city, phone, or email; the caller is excluded.
This is a user-enumeration surface, so three controls together make it useless
for testing whether a handle exists at volume: a **minimum query length of 2**, a
**hard per-user rate limit** (30/min, server-side so a fresh request cannot reset
it), and the handle+display-name-only projection.
```json
{ "data": [ { "handle": "tad", "display_name": "T. Ad" } ] }
```
Errors: `RATE_LIMITED`, `VALIDATION_ERROR`.

**Server-side sweeper**, every 30 seconds: voids `pending` past `redeem_until`
(the catch dies with its window — no orphan), then expires `pending` past
`accept_by` (the catch returns to the sender). **Transfers MUST NOT rely on
client-side timers.** Every transition is a conditional status update, so
concurrent sweeps never double-resolve a transfer.

### `POST /v1/admin/transfers/sweep`
Runs one sweeper pass. Admin only; the production trigger is an Upstash/QStash
schedule (~30s), the same deployment prerequisite as the drop scheduler tick.
```json
{ "data": { "voided": ["uuid"], "expired": ["uuid"] } }
```

---

## 8. FOLLOWS AND PREFERENCES

### `GET /v1/follows`
### `PUT /v1/follows/{org_id}`
```json
{ "tier": "fanatic" }
```
Errors: `FANATIC_LIMIT_REACHED` — 10 per lane, independent pools.

Response on limit includes current Fanatics in that lane so the client can offer a swap.

### `DELETE /v1/follows/{org_id}`

**No endpoint exists for a merchant to promote a user to Fanatic.** Opt-in only.

### `GET /v1/tags`
Platform taxonomy. **Read-only for all non-admin roles.** No free-text.

Returns the two-level tree. Groups (`parent_id: null`) are browsable chips and are never selectable. Leaves are what merchants and buyers choose.

```
?lane=local|maker|digital
?selectable=true            (leaves only — the merchant classification picker)
```

### `GET /v1/tags/search?q=`

Type-ahead over the taxonomy. Matches `label` and `synonyms`, never drop content.

```json
{
  "data": [
    { "id": "uuid", "label": "Oil Change", "group": "Auto", "matched_on": "label" },
    { "id": "uuid", "label": "Car Wash",   "group": "Auto", "matched_on": "synonym" }
  ]
}
```

Minimum 2 characters. Returns leaves only, ranked by exact-prefix first, then synonym match, then drop volume in the user's active city. Debounce 150ms client-side; this endpoint will be hit on every keystroke.

**This searches categories, not drops.** There is no free-text search over drop titles or descriptions anywhere in the API, and none may be added — it would reward keyword stuffing and hand merchants a gaming surface.

### `GET /v1/board?tag_id=`

The filtered board. Ranking runs **within the filtered set**, not globally.

This is the core browse behavior: a dry cleaner never competes with a taco drop for board position, because a buyer filtering to Dry Cleaning arrives with intent. Percentage-remaining ordering is the default sort inside a filter, not a global scarcity allocation.

```
?tag_id=uuid                (single leaf, or a group to include all its leaves)
?address_id=uuid            (defaults to active address)
?sort=heat|distance|ending  (default: heat = pct_remaining ascending)
?cursor= &limit=
```

Filter state MUST survive navigation — a buyer who filters to Oil Change, opens a drop, and backs out returns to the filtered board, not the front page.

### `PUT /v1/users/me/tags`
```json
{ "tag_ids": ["uuid"] }
```
Leaves only. Selecting a group is rejected with `VALIDATION_ERROR`.

---

## 9. CLOUT AND WHISPERS

### `GET /v1/users/me/clout`
```json
{
  "data": {
    "city_id": "uuid",
    "tier": 3,
    "percentile": 0.14,
    "decayed_score": 412.5,
    "recent_events": [{ "source": "redemption", "points": 10, "occurred_at": "..." }]
  }
}
```

**There is no write endpoint for clout.** Not for admin, not for any role. Clout is written server-side from exactly three sources: completed redemption, whisper submission, attributed share. Any endpoint that grants clout from a payment or promotion is a doctrine violation.

### `GET /v1/users/{handle}` — public profile
Handle, `user_number`, clout tier, badges, position numbers held. Never addresses, email, phone, or catch details.

### `POST /v1/whispers`
```json
{
  "redemption_id": "uuid",
  "would_return_at_full_price": true,
  "dim_2": 4, "dim_3": 5, "dim_4": 4,
  "note": "string"
}
```
Earns clout. One per redemption.

### `GET /v1/orgs/{id}/whispers`
**Merchant owner and admin only. Read-only. Never public.** No endpoint may expose a whisper to any other party.

### `POST /v1/shares`
```json
{ "drop_id": "uuid", "redemption_id": "uuid" }
```
Returns a tracked share link token and its public `/s/{token}` URL. Creating a
share earns **no** clout.

### `GET /s/{token}`
Public redirect to the shared drop. Records the click for analytics **only** —
a raw click grants no clout (a bot, a scraper, or the sharer could produce it).
Implemented under `/v1/shares/{token}/click` and exposed at the short `/s/{token}`
URL by a rewrite, so the handler stays under `/v1` (invariant #15).

### `POST /v1/shares/{token}/verify`
The verified return click: called by the **authenticated** user who returned
through the link. Grants the sharer clout **once**, and only if the returner is
not the sharer (no self-attribution) and the link has not already been attributed
(repeat returns never compound). Idempotent thereafter.
```json
{ "data": { "attributed": true, "clout_earned": 15 } }
```

**Clout is granted only on a verified return click.** Platform-API content
verification (TikTok/Instagram) is deferred — the tracked-link return is the v1
signal; unverifiable content earns nothing.

### `POST /v1/admin/clout/recompute`
Admin. The hourly job: decay (30-day half-life, referenced to the top of the
hour), per-city percentile, five tiers, and the top-1% cap on tier 5. Derives
`clout_scores` from the ledger — **not a clout write path.** Deterministic and
idempotent within the hour. Production trigger is an Upstash/QStash hourly schedule.

### `POST /v1/admin/merchant-scores/recompute`
Admin. The daily merchant-score job (§10). Trailing 90-day redemption rate +
whisper score; new merchants seeded at the cohort median. Production trigger is a
daily schedule.

---

## 10. MERCHANT — OPERATOR PORTAL

### `GET /v1/orgs`
The orgs the caller has a merchant role on — how the operator portal discovers
its org context. A role without a scope is meaningless, so each entry resolves
the role to its org and locations.

```json
{
  "data": [
    {
      "org_id": "uuid",
      "name": "Maxwell's",
      "lane": "local",
      "role": "merchant_owner",
      "tier": "local_superstar",
      "status": "active",
      "locations": [{ "id": "uuid", "name": "Maxwell's on Main", "city": "Salt Lake City" }]
    }
  ]
}
```

**Always an array**, never a single object, even at length one. Multi-org is the
general case (own one shop, work staff shifts at another), so the portal shows an
org switcher when there is more than one entry and skips it silently at length
one — the current org must be visible at all times, because creating a drop
against the wrong org is a real and expensive mistake. `role` is the caller's
role on that org — `merchant_owner` or `merchant_staff`; for staff, `locations`
holds only their scoped location. **An empty array is a valid response** — a
buyer with no merchant role gets `[]`, never a `403`. `GET /v1/users/me.roles`
carries the same `{ role, org_id, location_id }` scope for each role (a bare role
name with no org is meaningless).

### `GET /v1/orgs/{id}`
### `GET /v1/orgs/{id}/scoreboard`
The persistent top-right scoreboard.
```json
{
  "data": {
    "drops_used": 6,
    "drops_remaining": 2,
    "live_now": 1,
    "total_catches": 341,
    "total_redemptions": 297,
    "whispers": 88,
    "cycle_ends_at": "...",
    "drops_pooled_org_level": false
  }
}
```
When `drops_pooled_org_level` is true (Superstar, Enterprise), counts are org-wide, not per-location. **This is the one place the billing model forks.**

### `GET /v1/orgs/{id}/locations`
### `POST /v1/orgs/{id}/locations`

Returns `402 ALLOWANCE_EXHAUSTED` when the tier does not cover another location:

```json
{
  "error": {
    "code": "ALLOWANCE_EXHAUSTED",
    "message": "Your plan covers 1 location.",
    "details": {
      "current_tier": "local_starter",
      "upgrade_options": [
        { "tier": "local_superstar", "max_locations": 8, "price_cents": 79500, "prorated_now_cents": 41200 }
      ],
      "enterprise_contact": false
    }
  }
}
```

The same shape carries the drop-cap case. Options are read from stored per-account limits, **never computed from the tier enum**:

```json
{
  "error": {
    "code": "ALLOWANCE_EXHAUSTED",
    "message": "You've used all 2 drops this cycle.",
    "details": {
      "current_tier": "local_starter",
      "drops_used": 2,
      "drops_per_cycle": 2,
      "cycle_ends_at": "2026-10-08T00:00:00Z",
      "upgrade_options": [
        { "tier": "local_limited", "drops_per_cycle": 8,  "price_cents": 14900, "prorated_now_cents": 3200 },
        { "tier": "local_boss",    "drops_per_cycle": 12, "price_cents": 19900, "prorated_now_cents": 6800 }
      ],
      "enterprise_contact": false
    }
  }
}
```

**The Add Location button is always visible at every tier.** The paywall is the pitch. Never hide the control.

### `POST /v1/drops`
Local drops go `draft → scheduled` directly. **Maker and Digital go to `submitted`.**

Creation begins from a location — `location_id` is required for `lane='local'` and the client flow enters from the business profile, never from a bare drop form.

Returns `402 ALLOWANCE_EXHAUSTED` at the monthly cap, with the same upgrade payload shape. **Soft block:** one-click prorated upgrade, live again in under 60 seconds. Not a hard wall. No overages — overages rebuild volume-based revenue by the back door.

### `PATCH /v1/drops/{id}`
Returns `DROP_IMMUTABLE` for any change to quantity, price, terms, title, description, or redemption window once status is `live`, `gone`, or `expired`.

### `POST /v1/drops/{id}/duplicate`
Clones to a new date. All fields editable before publish. Consumes allowance on schedule.

**No recurrence endpoint exists in v1.** Duplicate is the tool; recurrence is earned later from usage data.

### `POST /v1/drops/{id}/encore`
Creates a linked successor with `parent_drop_id` set. **Available only from `gone`.** This is the only mechanism for adding supply — there is no restock path anywhere in the API.

### `GET /v1/locations/{id}/today`
The Today's Code screen.
```json
{
  "data": {
    "codes": [{ "drop_id": "uuid", "code": "K7MX", "phonetic": "Kilo Seven Mike X-ray", "title": "...", "redeem_until": "..." }],
    "feed": [{ "handle": "...", "position_number": 12, "method": "gps_verified", "at": "..." }]
  }
}
```
`merchant_staff` may call this endpoint for their own location. It is the only merchant surface they may reach.

### `GET /v1/locations/{id}/code-sheet.pdf`
Printable counter card: code, offer description, date, expiration time.

### `GET /v1/drops/{id}/stats`
### `GET /v1/orgs/{id}/billing`
### `POST /v1/orgs/{id}/subscription/upgrade`
Prorated, instant. Unblocks drop creation in the same request cycle.

---

## 11. ADMIN

All admin routes write to `admin_audit_log` with actor, before, after, and IP. **No exceptions.**

```
GET    /v1/admin/orgs
PATCH  /v1/admin/orgs/{id}              — tier, limits, status
POST   /v1/admin/orgs/{id}/suspend
POST   /v1/admin/orgs/{id}/delist
GET    /v1/admin/users
POST   /v1/admin/users/{id}/suspend
POST   /v1/admin/users/{id}/clout/freeze
GET    /v1/admin/cities
POST   /v1/admin/cities
PATCH  /v1/admin/cities/{id}            — radius, cold-start window, event threshold
GET    /v1/admin/fraud/unverified-redemptions
GET    /v1/admin/fraud/velocity-flags
GET    /v1/admin/fraud/transfer-patterns
GET    /v1/admin/fraud/risk                    — buyers flagged for review
POST   /v1/admin/fraud/risk/recompute          — derived recompute (idempotent)
GET    /v1/admin/users/{id}/risk               — one buyer's risk profile
GET    /v1/admin/tags
POST   /v1/admin/tags
PATCH  /v1/admin/tags/{id}
PUT    /v1/admin/board/upcoming
GET    /v1/admin/metrics
GET    /v1/admin/audit-log
```

**Admin limits are stored per-account**, never derived from the tier enum. Enterprise requires arbitrary values; code that computes limits from `tier` breaks Enterprise on day one.

**`POST /v1/admin/users/{id}/clout/grant` does not exist and may not be added.**

The **buyer risk profile** (`/v1/admin/fraud/risk`, `/v1/admin/users/{id}/risk`) is internal and admin-only — never public, never merchant-facing. RLS denies every non-admin role as a second wall behind the admin gate. It flags for human review and never auto-suspends (PRD §11.4.1).

---

## 12. PHASE 2 — ORDERS AND RMA

Defined for contract stability. Not implemented in v1.

```
GET    /v1/orders                              — buyer's orders
GET    /v1/orgs/{id}/orders                    — the maker order table
       ?sort=date|product_id &product_id= &status=
POST   /v1/orders/{id}/ship                    — carrier + tracking REQUIRED
GET    /v1/orders/{id}/invoice.pdf
POST   /v1/orders/{id}/rma                     — { reason: vendor_error|buyer_error }
POST   /v1/rmas/{id}/issue
POST   /v1/rmas/{id}/deny
POST   /v1/rmas/{id}/received                  — THE GATE
POST   /v1/rmas/{id}/refund                    — one click, blocked until received
```

**`POST /v1/rmas/{id}/refund` returns 409 unless `received_at` is non-null.** Database constraint, no application override, no admin bypass route. This is invariant #16.

The documented exception path: admin marks `received_at` manually, logged in `admin_audit_log`. There is no bypass endpoint.

`vendor_error` → 100% including original shipping, zero fee.
`buyer_error` → 80%, 20% restocking retained **by the maker**.

**No endpoint returns a platform fee on any transaction.** None may be added — that couples platform revenue to volume and breaks invariant #1.

Tracking is mandatory before `ship`. It is the maker's only chargeback defense.

```
POST   /v1/legal/takedown                      — public notice intake
GET    /v1/admin/takedowns
POST   /v1/admin/takedowns/{id}/remove
POST   /v1/admin/takedowns/{id}/counter
```
Takedown intake, counter-notice handling, and logged repeat-infringer strikes are **conditions of DMCA safe harbor**, not optional features.

---

## 13. RATE LIMITS

| Endpoint | Limit |
|---|---|
| `POST /v1/catches` | 30/min per user |
| `POST /v1/redemptions` | 10/min per user |
| Redemptions via `no_fix_timeout` | **5 per user per 30 days** — the abuse signal |
| `POST /v1/transfers` | 20/hour per user |
| `GET /v1/users/me/handle-search` | 60/min per user |
| `POST /v1/auth/phone/verify/send` | 5/hour per phone |
| Public `GET /v1/drops/{id}` | 120/min per IP |

The `no_fix_timeout` limit is the fraud control. A normal user hits it a few times a year; an abuser hits it every time, and the pattern surfaces without any detection logic.

---

## 14. WHAT MUST NOT EXIST

Endpoints that would violate doctrine. An agent will be tempted to add these. None may exist:

| Forbidden | Violates |
|---|---|
| `DELETE /v1/catches/{id}` or any release path | Counters never go up |
| Any route increasing `quantity_remaining` | Counters never go up |
| Restock on an existing drop | Encore is the only mechanism |
| Merchant-side redemption or mark-in | Operator never enters anything |
| Redemption path for `permission_denied` | Universal geofence bypass |
| Clout grant, purchase, or admin award | Clout is never purchasable |
| Any platform percentage of a transaction | No rake, ever |
| Whisper exposure to any third party | Whispers are never public |
| Second transfer hop | One hop |
| Overage purchase past an allowance cap | Rebuilds volume-based revenue |
| Edit to a live drop's quantity, price, or terms | Immutability after live |
| Update or delete on `clout_events` or `admin_audit_log` | Append-only |
| Refund before `received_at` | Invariant #16 |

---

*End of API-CONTRACT v1.0*
