# CLAUDE.md — THE DROP

**Read this file at the start of every session before writing any code.**

This is not documentation. These are constraints. Violating one is not a bug to fix later — it is a broken product.

---

## WHAT THIS PRODUCT IS

The Drop is a scarcity-based commerce platform. Makers and merchants *drop*; buyers *catch*; sold out is *Gone*; more supply is an *Encore*, never a restock.

Platform revenue is a **flat monthly subscription paid by merchants**. The platform takes **zero percent of any transaction, ever.**

**Why that matters to you as the engineer:** every comparable platform — Groupon, Gilt, Woot — died the same death. Their revenue was a percentage of sales, so growth pressure forced them to remove the scarcity constraints that made the product work. Flat subscription means restricting inventory does not reduce revenue.

Most of the rules below will, at some point, look like friction you could remove to make something smoother. Removing them is how this product dies. The constraints *are* the product.

---

## THE SIXTEEN INVARIANTS

1. **Platform revenue is never a percentage of anything.** No rake, no commission, no transaction fee, no overage.
2. **Counters never go up.** No restocks. No released catches. No inventory returning to a pool. Ever.
3. **A live drop is immutable.** Quantity, price, terms, title, description, and redemption window are frozen at go-live. Enforced by database trigger.
4. **Position numbers are permanent and never reused.** Gaps are correct. Collisions are impossible.
5. **One catch per buyer per drop** — keyed on the *original* catcher, so catch-transfer-catch is blocked.
6. **Clout is never purchasable.** Earned only from completed redemptions, whispers, and attributed shares. No grant path exists for anyone, including admin.
7. **All state decisions are server-authoritative.** The client is never trusted with inventory, position, clout, code validation, geofence, or limits.
8. **The operator never enters a redemption code.** The buyer types it into their own device. No merchant-side redemption or mark-in exists.
9. **Location permission denied is a blocking state**, never an alternate redemption path.
10. **Address governs discovery. GPS governs redemption.** Never conflate them.
11. **Gone is browsable and permanent.** A Gone drop is never deleted and never hidden. It stays on the board for 5 minutes carrying the Gone stamp — seeing a drop die is the scarcity mechanic working — then leaves the board and remains **permanently reachable** under the business profile and the user's Past Drops. Leaving the board is not deletion.
12. **Transfers are one hop**, 5-minute accept window, 30-minute pre-close send cutoff.
13. **No preference tags are free-text.** The taxonomy is platform-controlled.
14. **All admin actions are logged and attributable.** `admin_audit_log` is append-only for every role.
15. **The API is the product.** Every capability must be reachable by an identical call from a native client.
16. **(Phase 2) No refund before the product is received.** `received_at` gates `refunded_at` at the database layer. No override, no admin bypass.

---

## THINGS YOU WILL BE TEMPTED TO BUILD. DO NOT.

Each of these is a reasonable-looking feature that breaks the product. If a task seems to require one, **stop and ask** — the task is wrong, not the rule.

| Do not build | Breaks |
|---|---|
| `DELETE /v1/catches/{id}` or any release-catch path | #2 |
| Any code path that increases `quantity_remaining` | #2 |
| Restock on an existing drop | #2 — Encore is the only mechanism |
| Edit to a live drop's quantity, price, or terms | #3 |
| Position number reuse to fill a gap | #4 |
| Second catch for a buyer who transferred theirs away | #5 |
| Clout grant, purchase, promo award, or admin adjustment | #6 |
| Client-side inventory or position assignment | #7 |
| Merchant-side redemption, mark-in, or override | #8 |
| Redemption path for `permission_denied` | #9 — universal geofence bypass |
| Using the active address to verify redemption proximity | #10 |
| Deleting a Gone drop, or making it unreachable from the business profile or Past Drops | #11 |
| Second transfer hop | #12 |
| Free-text tag entry | #13 |
| Update or delete on `clout_events` or `admin_audit_log` | #6, #14 |
| Next.js server actions for mutations | #15 |
| Supabase client queries from UI components | #15 |
| Overage purchase past an allowance cap | #1 — rebuilds volume-based revenue |
| Refund before `received_at` | #16 |
| Quiet hours on notifications | Product decision — deliberate |
| Recurrence engine for drops | v1 scope — duplicate only |

---

## THE THREE HARDEST THINGS IN THIS CODEBASE

### 1. The catch contract

Drop-open is a thundering herd. Thousands of requests arrive in the same second against finite inventory.

- Inventory lives in **Redis** during the live window. `DECR` is atomic and returns the position number.
- A return value below zero is Gone. Reject immediately, **no database round trip, no re-increment**.
- Postgres write is async. **A failed write burns the position number.** The gap is correct behavior.
- `Idempotency-Key` is mandatory. Mobile networks retry; without it a dropped response consumes inventory the buyer never received.
- The reconciliation job **never increases** `quantity_remaining` and never writes back to Redis.

Do not "simplify" this to a Postgres transaction. It will serialize on row locks and oversell under retry.

### 2. The two GPS failures

They are different and must stay different:

- **`permission_denied`** → blocked. Browsers return this instantly. If it routed anywhere else, turning off location would be a one-tap redeem-from-anywhere bypass.
- **`no_fix_timeout`** (permission granted, 7 seconds, no fix) → **auto-redeem**, flagged `unverified_timeout`, rate-limited 5 per 30 days.

The auto-redeem is non-negotiable product behavior: a customer is standing at a counter in front of a paying merchant. The product cannot break in that moment. Basements, malls, and concrete are real.

The rate limit *is* the fraud detection. No ML, no scoring. A normal user hits it a few times a year; an abuser hits it every visit.

### 3. Per-account limits

Subscription limits are **stored on the organization row**, never computed from the `tier` enum. Enterprise accounts carry arbitrary values. Any code that derives limits from `tier` breaks Enterprise on day one.

`drops_pooled_org_level` is the fork: when true, the allowance counts across all locations; when false, each location counts separately. This is the one place the billing model branches and the most common place to get it wrong.

---

## VOICE AND COPY

States facts and lets scarcity do the work.

**No** urgency language. **No** exclamation points. **No** explaining why something is exciting. **No** hand-holding. **No** raised voice.

Users are treated as capable of drawing their own conclusions. Copy that explains why a drop matters has already failed.

Scarcity is shown with **discrete inventory pips and permanent position numbers** — never a percentage progress bar.

**Lexicon, used consistently in UI, API naming, and database naming:**

| Use | Never |
|---|---|
| Drop | deal, offer, listing |
| Catch | buy, claim, reserve |
| Gone | sold out, unavailable |
| Encore | restock, back in stock |
| Whisper | review, rating, feedback |
| Clout | points, rewards, XP |

---

## ARCHITECTURAL BOUNDARY

The web app is a **client**, not the product. A native iOS and Android client is planned and will build against the same `/v1` API.

- All logic behind versioned HTTP route handlers
- No mutations via server actions — native cannot call them
- No Supabase client queries from UI components, except realtime board subscriptions
- `openapi.json` is generated and committed; drift fails CI
- Two lint rules enforce this boundary. **Do not disable them.** They are what keeps native from becoming a backend rewrite.

---

## SCOPE DISCIPLINE

**v1 is Local Drop only.** No purchases, no shipping, no file delivery, no streaming, no approval queue.

Maker Drop and DigiDrop tables exist in the schema so later phases are additive. **Their endpoints and UI are not built in v1**, regardless of how straightforward they appear or how close the schema already is.

---

## WHEN IN DOUBT

If a requirement seems missing, **stop and ask.** Do not infer a product decision.

Every ambiguity in these documents is an unmade decision, not an invitation to choose.

**Document precedence:** CLAUDE.md > PRD > DATA-MODEL > API-CONTRACT > BUILD-PLAN.

---

*The constraints are the product.*
