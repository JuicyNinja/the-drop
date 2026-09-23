# THE DROP — Product Requirements Document

**Version:** 1.0
**Date:** September 2026
**Owner:** Tad Timothy, Founder
**Status:** Approved for build

---

## 0. HOW TO READ THIS DOCUMENT

This is the authoritative product specification for The Drop. It is written for engineering consumption — specifically for an AI coding agent building the system, and for human engineers reviewing that work.

Three companion documents complete the set:
- **DATA-MODEL.md** — schema definition
- **API-CONTRACT.md** — endpoint specification
- **BUILD-PLAN.md** — phased work packages
- **CLAUDE.md** — standing invariants that must never be violated

Where this document says **MUST**, the requirement is load-bearing and enforced at the database or server layer. Where it says **SHOULD**, implementation discretion is permitted. Where a rule is marked **DOCTRINE**, it is a product-philosophy constraint that may not be relaxed for technical convenience, performance, or user-experience smoothing. Doctrine violations have killed every comparable platform in this category.

---

## 1. PRODUCT SUMMARY

The Drop is a scarcity-based commerce platform connecting independent makers, local merchants, and buyers through tightly curated, time-limited drops.

**Launch market:** Salt Lake City metro. University towns and major metros follow.

**Revenue model:** Flat-rate monthly subscriptions paid by merchants and makers. The platform takes no percentage of any transaction, ever. Revenue is fully decoupled from gross merchandise volume.

**Why this matters architecturally:** Every predecessor in this category (Groupon, Gilt, Woot) died the same death — revenue was a percentage of sales, so growth pressure forced the removal of the scarcity constraints that made the product work in the first place. Flat subscription means restricting inventory does not reduce revenue. This is the single most important structural decision in the business and the system must never introduce a mechanism that couples platform revenue to transaction volume.

### 1.1 Lanes

| Lane | Content | Transaction | Phase |
|---|---|---|---|
| **Local Drop** | Geo-fenced, in-person merchant offers | Redemption in person; no money through platform | **v1** |
| **Maker Drop** | Shippable physical goods from vetted independent makers | Purchase | Phase 2 |
| **DigiDrop** | Intangibles — music, software, practitioner-led sessions | Purchase | Phase 3 |

**v1 ships Local Drop only.** Maker and DigiDrop tables, enums, and API surfaces are defined in the schema from day one so that later phases are additive, not migratory. They are not built, not exposed, and not tested in v1.

### 1.2 Lexicon

This vocabulary is product-facing and MUST be used consistently in all UI copy, API naming, and database naming.

| Term | Meaning |
|---|---|
| **Drop** | A time-limited offer. Makers and merchants *drop*. |
| **Catch** | A buyer claiming a unit of a drop. Buyers *catch*. |
| **Gone** | Sold-out state. Never "sold out," never "unavailable." |
| **Encore** | A successor drop following a Gone drop. Never a "restock." |
| **Whisper** | Private post-redemption feedback from buyer to merchant. |
| **Clout** | Earned buyer status. Never purchasable. |
| **Meet at The Drop** | Platform ritual phrase. |

### 1.3 Voice

States facts and lets scarcity do the work. No raised voice, no urgency language, no explanatory scaffolding, no hand-holding. Users are treated as capable of drawing their own conclusions. Copy that explains why something is exciting is copy that has already failed.

---

## 2. PLATFORM AND ARCHITECTURE

### 2.1 Target

Responsive web application — mobile and desktop, one codebase. Buyers skew mobile; operators skew desktop (the Today's Code screen sits on a counter-side screen).

### 2.2 Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth (JWT), OAuth providers |
| Realtime | Supabase Realtime (board inventory updates) |
| Burst handling | Redis |
| Hosting | Vercel |
| Billing | Stripe Billing (subscriptions only — no Connect, no payouts) |
| Email | Resend |
| SMS | Twilio or equivalent |
| Push | Web Push API |

### 2.3 API-first mandate — DOCTRINE

The web application is a **client**, not the product.

- All business logic MUST live behind versioned HTTP endpoints (`/v1/...`).
- No business logic in React components. No direct database access from the UI layer.
- Every action the web client performs MUST be performable by an identical call from a native iOS or Android client.
- An OpenAPI specification MUST be generated and versioned as a first-class repository artifact.
- All state decisions — inventory, position numbers, clout, code validation, geofence verification, subscription limits — are **server-authoritative**. The client is never trusted.

**Rationale:** A native application is planned. Built this way, native is an additive client against the same Postgres, same auth, same API. Built otherwise, native is a backend rewrite.

### 2.4 Known deferral

Web push on iOS requires the user to add the site to their home screen. There is no workaround. SMS is the reliable time-critical channel until a native client ships. This constrains notification design (§9).

---

## 3. IDENTITY, ROLES, AND ACCOUNTS

### 3.1 Account model

One account, one identity, roles attached. A single human may simultaneously be a buyer, a merchant owner, and a maker. A context switcher moves between roles. There is no separate "merchant login."

**Rationale:** A merchant who cannot catch other people's drops never learns the product. The Founding 50 influencer acquisition program depends on people who are both.

### 3.2 Roles

| Role | Scope |
|---|---|
| `buyer` | Default. Every account has it. |
| `merchant_owner` | Full access to an Organization: all locations, billing, drop creation, stats. |
| `merchant_staff` | Scoped to one Location. Sees Today's Code and live redemption feed only. No drop creation, no billing, no stats. |
| `maker` | Phase 2. |
| `admin` | Platform administration. |
| `field_rep` | Phase 2. 1099 contractor, limited account provisioning. |

### 3.3 Merchant hierarchy

```
Organization        — billing entity; subscription attaches here
  └── Location      — address, geofence, hours, tier allocation
        └── Staff   — seat, scoped to a single location
```

A franchise group is one Organization with many Locations. Enterprise accounts have per-account configurable limits rather than tier-hardcoded ones.

### 3.4 Buyer registration — required fields

Registration is mandatory before any catch. The board itself requires an account (see §3.6 for the single-drop exception).

| Field | Rule |
|---|---|
| Full name | Required |
| Email | Required, verified before first catch |
| Phone | Required, **SMS-verified at signup** |
| Address | Required — becomes the default "Home" address (see §8) |
| Handle | Required, unique. Changeable **once**, then permanently locked. Reserved list for brands and profanity. |
| User number | **System-assigned, 14-digit, sequential, immutable.** |

**User number:** Assigned in signup order beginning at `00000000000001`. Never reassigned, never reused, never changed — including on account deletion. Displayed on the buyer profile. This is a permanent, unfakeable record of join order and functions as a status artifact in its own right. Account `00000000000001` is Tad Timothy, Founder.

**SMS verification rationale:** Clout is capped at the top 1% per city and cannot be purchased. That makes it a high-value target for burner-account farming. Phone verification is the primary defense.

### 3.5 Registration flow

```
1. OAuth initiate (Google / Apple)
2. Collect: full name, phone, email, address, handle
3. SMS verification
4. Location permission gate (§7.4) — blocking, cannot be skipped
5. Return to intent (the drop they came from, or the board)
6. Triggered email: prompt to complete full profile
7. First full session: tooltip walkthrough of UI/UX
```

OAuth supplies name and email only. Phone, address, and handle are collected in a completion step. **Return-to-intent MUST be preserved through the entire auth round trip** — a user who arrives from a shared drop link returns to that exact drop, unlocked and ready to catch.

Full profile configuration (preference tags, additional addresses, Fanatic selections) is deferred to the post-registration email prompt. It is not a signup blocker.

### 3.6 Shared drop links

A shared link opens a **public, viewable single-drop page**. The catch button is visible but gated. Tapping it fires the registration flow above and returns the user to the unlocked drop.

The board is walled. Individual drop links are not. This is the primary acquisition channel — a maker posting to Instagram must not lose every visitor to a signup form.

---

## 4. THE DROP LIFECYCLE

### 4.1 State machine

```
draft → submitted → approved → scheduled → live → gone
                 ↘ rejected                    ↘ expired

gone → encore_pending → (new linked drop)
```

| State | Meaning |
|---|---|
| `draft` | Merchant editing. No visibility. |
| `submitted` | In admin curation queue. **Maker/DigiDrop only.** |
| `approved` | Cleared, not yet scheduled. **Maker/DigiDrop only.** |
| `rejected` | Declined with reason. **Maker/DigiDrop only.** |
| `scheduled` | Assigned a go-live timestamp. |
| `live` | Visible, catchable, counter falling. |
| `gone` | Inventory exhausted. Permanent, browsable graveyard. |
| `expired` | Window closed with inventory remaining. Browsable. |
| `encore_pending` | Merchant may create a linked successor. |

### 4.2 Curation by lane

| Lane | Curation |
|---|---|
| **Local Drop** | **Auto-publish.** No approval queue. `draft → scheduled → live`. The merchant bears full responsibility for honoring the offer. |
| **Maker Drop** | Approval and scheduling required. |
| **DigiDrop** | Approval and scheduling required. |

Because v1 is Local-only, **v1 contains no approval queue.** The admin portal's curation surface is built in Phase 2.

The platform's controls over Local quality are: subscription cost as a friction floor, the public Whisper-derived merchant score, suspension, and delisting. There is no pre-publication gate. This is deliberate — the market self-corrects.

### 4.3 Immutability — DOCTRINE

**Once a drop enters `live`, quantity, price, and terms are frozen.** No merchant edits. No admin override. No exceptions. This MUST be enforced at the database layer, not by application policy.

A merchant who wants more supply creates an **Encore** — a new, separate drop referencing the parent. Counters never go up.

### 4.4 Drop timing

- Every Local Drop is **timed** — it has a defined live window.
- A drop closes early when fully caught. Closing early does **not** alter the redemption window.
- The **redemption window** is set by the merchant and is independent of the live window. Example: drop goes live Monday, redemption window is Tuesday 3–6pm.
- Redemption windows are frequently tight — hours, not days. This is intentional and is what makes the data valuable to merchants (e.g. driving traffic into a dead 3–6pm Tuesday).

**Window shape.** The redemption window has two parts:

- An **outer date range** — the drop's final close. This is the catch's expiry: a catch is redeemable up to the end of the range and no later.
- An optional **recurring daily window** — specific weekdays and a daily time range (e.g. "Weekdays 10am–3:50pm", "Tue & Thu 3–6pm"). When set, a redemption must fall inside the daily window *and* the outer range. When unset, the window is one continuous span across the outer range.

The daily window is evaluated in the **location's city timezone**, never the buyer's device clock. Every surface that shows a window — card, drop detail, wallet, and the printed code sheet — shows the **full window in natural language** ("Tuesday 10am–3:50pm"), never a bare closing time ("Redeem by Friday 3:50pm").

**Behavior when the window is closed.** A redemption attempted outside the daily window is refused with the next opening time returned, so the buyer knows when to come back. Two behaviors deliberately key on the **final close**, not the daily close, so a catch is never silently stranded:

- **Transfer send cutoff** is 30 minutes before the *final* close. A catch sent at 3:40pm Tuesday is still redeemable Wednesday.
- The **window-closing push** fires once, before the final close only. Per-day reminders would be noise.

The full window (date range, days, and daily time range) is **frozen at go-live** and joins the live-drop immutability set (§ invariant #3).

### 4.5 Duplicate

Merchants may **duplicate** any past drop to a new date, edit any field, and publish. This is the primary operator workflow for recurring offers (e.g. the same Tuesday offer across four Tuesdays).

**Recurrence engines are explicitly out of scope for v1.** Duplicate is a testing tool. If usage data shows merchants building series, recurrence is considered later.

---

## 5. THE CATCH CONTRACT

This is the most technically critical section in the document. Drop-open is a thundering-herd event: every interested buyer arrives in the same second against finite inventory.

### 5.1 Atomicity

A catch performs four operations, **all or none**:

1. Decrement remaining inventory — **never below zero**
2. Assign the next position number — **monotonic, permanent**
3. Mint a redemption code binding buyer to drop
4. Write the catch record

### 5.2 Implementation

Inventory lives in Redis during the live window, pre-seeded at go-live.

- `DECR` on the inventory key is atomic by definition and returns the position number directly.
- A return value below zero means Gone — reject immediately, no database round trip.
- Successful catches write through to Postgres asynchronously.
- Postgres holds the durable record and reconciles.

This is what survives thousands of simultaneous requests without overselling.

### 5.3 Position numbers — DOCTRINE

Position numbers are **permanent**. Position #47 is always #47.

**Gaps are permitted; reuse is not.** If a Redis decrement succeeds but the Postgres write fails, the position number is burned. Two buyers MUST NEVER be able to claim the same position. Permanence is the promise; gaplessness is not.

### 5.4 Catch limits

**One catch per buyer per drop.** Always. Server-enforced. No tier, role, or clout level changes this.

### 5.5 No release — DOCTRINE

A catch can never be released back to inventory. An unredeemed catch is burned. Counters never go up.

This will generate support contacts. Hold the line — the burn is what makes catching consequential.

---

## 6. TRANSFERS

A caught drop sits in the buyer's wallet. It may be redeemed or transferred to another buyer.

### 6.1 Flow

```
Wallet → select catch → "Send" tab → type handle → autocomplete select → send
  ↓
Recipient receives SMS notification with 5-minute accept window
  ↓
Accept → catch and redemption responsibility transfer
Decline or timeout → returns to original holder
```

### 6.2 Rules

| Rule | Value |
|---|---|
| Hops permitted | **One.** A transferred catch cannot be transferred again. |
| Accept window | **5 minutes.** Expires back to sender automatically. |
| Send cutoff | Transfer MUST be initiated **≥30 minutes before the redemption window closes.** |
| Position number | **Travels with the catch.** It is a property of the catch, not the person. |
| Clout | **Does not travel.** Clout accrues only on redemption — whoever shows up earns it. |
| Decline | Returns to original holder immediately, not to the inventory pool. |
| Orphan prevention | If the redemption window closes while a transfer is pending, the transfer voids and the catch dies with the window. No orphaned catches. |

**Rationale for one hop:** Unlimited hops constitute a functioning secondary market and invite scalping and bot activity. One hop covers the legitimate case — "I can't make it, you go."

**Rationale for clout not travelling:** It makes transfer a generous act rather than a farming vector.

### 6.3 Monitoring

Transfer patterns are a fraud signal. One account repeatedly receiving from many senders indicates a resale market forming. Surfaced in the admin fraud review surface (§11).

---

## 7. REDEMPTION

### 7.1 The mechanic — DOCTRINE

The buyer receives the alphanumeric code **verbally from staff** and types it into their own app. **The operator never enters anything.**

This removes the merchant's device from the loop, makes presence unfakeable in the correct direction, and makes the transaction a conversation.

### 7.2 Code specification

**Alphabet — 24 characters:**

```
A C D E F G H J K M N P Q R T U V W X Y 3 4 5 6 7 9
```

Excluded: `0 O 1 I L S 2 Z 8 B` — every character that fails when spoken across a noisy counter or read from a printed card. `5` is retained because `S` is excluded, removing the ambiguity.

**Length:** 4 characters. 24⁴ ≈ 331,000 combinations, scoped per drop.

### 7.3 Code rotation

**One code per drop.** Not per location, not per day.

The code is **generated at go-live**, not at creation, and is **unique across concurrently-live drops at a location**. It is stored on the drop; a catch carries a denormalized copy (`catches.code`) for response convenience. It is NOT a per-catch code — every catcher of a drop shares the one code the staff reads aloud.

Merchants receive a **printable code sheet** containing: the code, the offer description, the date, and the redemption window expiration time. Taped to the register.

Alternative: a manager with admin-level app access acts as sole redemption authority.

A location running multiple concurrent drops has multiple sheets. Merchants will determine what is operationally workable for them.

### 7.4 Geofence

Geofencing exists for **one purpose only**: verifying proximity at the moment of redemption. It is used for nothing else.

| Parameter | Value |
|---|---|
| Default radius | 150m, configurable per location |
| Accuracy floor | Readings worse than ~100m accuracy are rejected with a retry prompt |
| Outside fence, good fix | **Rejected.** No override. |

**Location permission is a hard gate.** An explicit consent modal is presented at registration. Permission MUST be granted for in-app use. A user who denies permission cannot catch and cannot redeem — this is a blocking state, not an alternate path.

**Rationale:** Browsers return permission-denied instantly. If denial routed to any fallback redemption path, disabling location would become a universal one-tap redeem-from-anywhere bypass.

### 7.5 GPS failure handling

There are two distinct failures and they are handled differently:

| Condition | Behavior |
|---|---|
| **Permission denied** | Blocked. Prompt to enable. No redemption path. |
| **Permission granted, no fix acquired** (basement, mall, concrete, poor hardware) | **Auto-redeem after 7-second timeout.** |

The auto-redeem is non-negotiable product behavior: the customer is standing at the counter in front of a paying merchant. The product cannot break in that moment.

Auto-redeems carry three cheap safeguards, none visible to the customer:
- Flagged `unverified` in the redemption record
- **Rate-limited per account** — normal users hit this a few times a year; abusers hit it every time, and the pattern surfaces itself
- Displayed as unverified in the merchant's live redemption feed

### 7.6 Additional fraud controls (v1)

- One redemption per catch, server-enforced
- Velocity check — same account redeeming at locations physically too distant in too little time
- SMS-verified accounts (§3.4)
- Merchant live redemption feed — social verification at zero engineering cost

**Explicitly not built in v1:** device fingerprinting, mock-location detection, merchant manual mark-in. Mock-location detection is an unwinnable browser-side arms race; a native client provides it nearly free later.

### 7.7 No money moves

v1 processes no transaction money. The offer is redeemed in person; the merchant collects in-store as they always have. The platform never touches the transaction.

**Consequence:** redemption is the only conversion signal. Redemption rate is therefore the central metric of the operator portal and the primary renewal argument. Design accordingly.

---

## 8. ADDRESSES AND LOCATION

### 8.1 Multi-address model

Buyers hold multiple saved, labeled addresses (Home, Work, "Marriott Manhattan"). One is **active** at any time.

The active address drives:
- The Local board
- The Local daily digest email
- Category/radius email matching

**Switching is explicit and user-initiated.** The active address indicator MUST be persistent and visible in the header. The failure mode to design against is a user catching a Salt Lake drop while standing in Manhattan.

| Rule | Detail |
|---|---|
| Default | Home. Fallback if an address is deleted. |
| Radius preference | Set **per address.** 10 miles in SLC and 10 miles in Manhattan are different products. |
| Travel | User adds the hotel address, selects it, board resolves to that market. |

### 8.2 Address vs. geofence — MUST NOT be conflated

Address governs **discovery**. GPS governs **redemption**. The two systems never touch.

A user may browse Manhattan drops from Utah. They cannot redeem one.

### 8.3 Location drift prompt

When GPS shows the user persistently distant from their active address, prompt to switch. **Suggestion only, never automatic.**

### 8.4 Expansion data

Saved addresses in unlaunched cities constitute a demand map and are the primary input to city expansion sequencing. Collected at zero marginal cost. Surfaced in admin metrics.

---

## 9. NOTIFICATIONS

Notifications are the demand engine. Everything else is inventory management; this is what makes someone open the app at 11:58.

### 9.1 Follow tiers

Buyers follow merchants and makers at one of two levels:

| Tier | Channels | Cap |
|---|---|---|
| **Follower** | In-app push + email | Uncapped |
| **Fanatic** | **SMS** + push | **10 per lane** |

Fanatic caps are per-lane and independent: 10 makers, 10 digimakers, 10 local businesses. A local-food obsessive does not spend slots they would want for makers. Removing a Fanatic frees the slot immediately.

**Fanatic is opt-in only.** No default upgrades. Merchants cannot promote a user into Fanatic status.

**Rationale:** This solves the SMS cost problem with a product mechanic rather than a policy. SMS reaches only users who explicitly asked for it, and the 10-slot cap creates deliberate attention scarcity — which is on-brand.

### 9.2 Routing matrix

| Event | Fanatic | Follower | Category/radius match (not following) |
|---|---|---|---|
| Drop live | SMS + push | Push + in-app | Email only |
| Local drops (area) | — | — | Daily combined digest email |
| Maker / DigiDrop (tags) | — | — | Daily combined digest email |
| Transfer offer received | **SMS always** | **SMS always** | **SMS always** |
| Transfer accepted / declined | SMS | SMS | SMS |
| Redemption window closing | Push | Push | Push |
| Nearly gone (viewed, uncaught, ~85% claimed) | Push | Push | — |
| Clout tier change | In-app + email | In-app + email | — |
| Whisper prompt (post-redemption) | In-app | In-app | — |
| Merchant notices (cap, billing) | Email | Email | — |

**Transfer notifications are SMS regardless of follow tier** — user-initiated, 5-minute clock, no other channel works.

**Redemption window closing** (default 2 hours out, configurable) is the highest-leverage notification in the system. It directly raises redemption rate, which is the merchant score, which is the renewal argument.

### 9.3 Digest emails

Local digest matched on the buyer's **active address**. Maker/DigiDrop digest matched on **preference tags**. Both delivered as one combined daily email.

### 9.4 Quiet hours

**None.** A bar dropping at 11pm is legitimate, and a user who made that bar a Fanatic asked for the alert. Quiet hours would break the exact use case that proves the product.

### 9.5 Social sharing

Followers share drops externally via tracked links. This is the organic reach path and feeds clout attribution (§10.3).

---

## 10. PREFERENCES, RANKING, AND CLOUT

### 10.1 Preference and category taxonomy

**One taxonomy serves two jobs.** Buyers select interests from it; merchants classify themselves with it. The same node must serve both, or notification matching and browse filtering will disagree.

Two levels. Groups are browsable chips (Food & Drink, Auto, Home Services, Personal Care, Cleaning, Entertainment, Retail). Leaves are selectable and are what type-ahead resolves to (Tacos, Oil Change, Window Washing, Dry Cleaning, Barber).

Every leaf carries **synonyms**. A merchant classified as Auto Detail must be findable by a buyer typing "car wash." This is not a nicety — without it the filter does not work.

**The taxonomy is shared, centrally controlled, and platform-managed.** Free-text tags are forbidden — they destroy matching immediately. Taxonomy editing is an admin surface (§11).

### 10.1.1 Browse and filter

**The board is the front page, not the product.** Most buying happens inside a filter.

A buyer opens the app, scans On Fire, and if nothing lands they filter by category. This is a coupon book with fast filters — food, apparel, and entertainment sit alongside oil changes, window washing, and dry cleaning, and those never compete for the same attention.

- **Type-ahead searches the taxonomy**, never drop titles or descriptions. Free-text search over drop content would reward keyword stuffing and hand merchants a gaming surface.
- Minimum 2 characters, debounced. Hundreds of leaves stay usable because nobody scrolls them.
- **Ranking runs within the filtered set.** Percentage-remaining is the default sort inside a filter, not a global allocation. A dry cleaner ranks against services, not against the hottest restaurant in the city.
- Secondary sorts: distance, ending soon.
- **Filter state survives navigation.** Backing out of a drop returns to the filtered board.

**This removes the need for a board-exposure floor.** No merchant is invisible in their own category; they simply are not on the front page, which was never where a dry cleaner was going to convert.

### 10.2 Board and ranking

**Landing board** presents, per lane: **On Fire** and **New**.

**Navigation tabs:**
- Maker Drop
- Local Drop
- DigiDrop
- **Upcoming** — admin hand-picked previews, Ecom and Digital only
- **Ending Soon**

**Ranking is algorithmic, driven by buyer pressure.** Any earlier fixed lane-mix rule (1 ecom / 1 local / 1 digital) is **superseded and void.**

**Ranking metric: percentage of inventory remaining.** Lower remaining = hotter.

Percentage, not absolute count — a 10-unit drop must not permanently outrank a 200-unit drop at equivalent sell-through.

**Drop card displays:** catches remaining (absolute) **and** percentage left. Absolute is shown for human legibility; percentage is what ranks.

**Merchant redemption rate is NOT a ranking input.** It is a separate **merchant score** surfaced on the drop detail page and the business listing.

**Rationale for the change:** Redemption percentage is only knowable after the redemption window closes — often after the drop is Gone. It cannot rank a live drop. It is, however, exactly the right merchant quality signal.

### 10.3 Cold start

New cities and the launch period have no pressure signal. Fallback ordering:

| Lane | Fallback |
|---|---|
| Local | **Proximity** to active address |
| Maker / DigiDrop | Fill screen |

Fallback applies for **30 days per city or until a minimum event threshold is reached, whichever comes first.** Both values are admin-configurable per city.

### 10.4 Clout

| Property | Value |
|---|---|
| Tiers | Five |
| Decay | Yes |
| Cap | Top 1% per city |
| Purchasable | **Never** |
| Attaches to | Identity, not role. A merchant owner who catches drops accrues buyer clout. |

**Clout is earned from exactly three sources:**

1. **Completed redemption** — the deal MUST be complete. A catch that is never redeemed earns nothing.
2. **Whispers** — submitting post-redemption feedback.
3. **Attributed social sharing of the redemption act** — going live, TikTok reels, Instagram video.

**Attribution:** v1 uses **tracked share links only** — a share link that produces a verified return click. Platform API verification (TikTok, Instagram) is **deferred**. Clout cannot be granted for content the platform cannot verify.

**Permanent achievement badges are a separate system from clout.** Badges do not decay and are not capped.

### 10.5 Whispers

Private post-redemption feedback. Read-only for merchants. **Never public.**

Four-dimension rating anchored on: *would you return at full price* (a yes/no),
plus three 1–5 ratings (decided 2026-09-16, WP-13 gap fixes):

1. **Would you return at full price** — the anchor.
2. **As described** — did the offer match what was delivered.
3. **Quality** — of the product or service.
4. **Welcome** — how the buyer was treated while redeeming a discounted offer.
   This is the main failure mode of discount platforms and the thing worth
   catching early. There is deliberately **no "value for money" dimension** — it
   is meaningless on an already-discounted redemption.

Stored as `dim_2` (As described), `dim_3` (Quality), `dim_4` (Welcome); the anchor
is a boolean. Names are canonical in `lib/whisper-dimensions.ts`.

Whispers feed the merchant score (§10.2) and earn clout (§10.4).

---

## 11. ADMIN PORTAL

Reduced scope in v1 because Local auto-publishes and no approval queue exists.

### 11.1 Accounts and subscriptions
- Merchant account list, search, status
- Manual tier assignment; Enterprise provisioning with **per-account configurable limits**, not tier-hardcoded
- Subscription state, dunning failures, comp and trial flags
- **Suspend and delist** — the only real curation lever in a no-gate system

### 11.2 Buyer accounts
- Lookup by handle, user number, email, phone
- Suspend; clout freeze and reset
- **Transfer history** — where a secondary market first becomes visible

### 11.3 City configuration
- Launch a city
- Default geofence radius
- Cold-start window length and minimum event threshold (§10.3)

### 11.4 Fraud review
- Unverified auto-redeem log and rate-limit hits (§7.5)
- Velocity check flags (§7.6)
- Transfer pattern review (§6.3)

#### 11.4.1 Buyer risk profile — DOCTRINE (decided 2026-09-16, WP-14)

An **internal, admin-only** profile per buyer. Never public, never merchant-facing,
no endpoint exposes it to any role but admin, and RLS denies every other role — it
is a second wall behind the admin gate, not a code assertion. It tracks **cost
imposed, not virtue**:

- **Redemption rate** — caught versus redeemed
- **Abandoned catches** — caught, window closed unredeemed
- **Transfer patterns** — receiving from many unrelated senders
- **Whisper rate** — a low-weight *positive* signal; it never raises a flag

Return rate, chargebacks, and dispute outcomes arrive in Phase 2 with WP-16; the
table already carries the columns so payments extend it with data, not schema.

Two rules, both load-bearing:

1. **Thresholds flag for human review; nothing auto-suspends.** A number that
   suspends automatically will suspend the person whose car broke down twice. No
   code path reads the flag to act — suspension is only ever a manual admin
   decision (§11.2), logged like any other (§11.8).
2. **Minimum event counts before a profile means anything.** Two abandoned
   catches out of three is noise; two out of two hundred is a pattern. Below the
   minimum, a rate is null and cannot flag — the same reasoning as the top-1%
   clout cap being unreachable below 100 active users (§10.4).

### 11.5 Upcoming picks
Hand-curated previews for Maker and DigiDrop. Built as a stub in v1 — the board tab exists, the lanes do not.

### 11.6 Taxonomy management
Editing surface for the shared preference tag list (§10.1). Without a real management surface this rots immediately.

### 11.7 Platform metrics
DAU, catches, redemption rate by city and by merchant, Fanatic counts, board pressure, saved-address demand map (§8.4).

### 11.8 Audit logging
**All admin actions MUST be logged and attributable.** Field reps and 1099 contractors will touch accounts in Phase 2. An unlogged admin panel is a liability, and this is painful to retrofit.

---

## 12. SUBSCRIPTIONS AND BILLING

### 12.1 Model — DOCTRINE

Flat-rate monthly subscription. **Never a percentage of sales, transactions, or volume.**

Tiers gate on **drops per month** — a real platform cost (board inventory and attention) with no relationship to merchant revenue.

**There is no cap on concurrent live drops at any tier.** Merchants self-tune.

### 12.2 Local Drop pricing

| Tier | Allowance | Price |
|---|---|---|
| Local Starter | 2 drops/month **per location** | $99 |
| Local Limited | 8 drops/month **per location** | $149 |
| Local Boss | 12 drops/month **per location** (≈3/week) | $199 |
| Local Superstar | Up to **8 locations**, 64 drops/month **pooled across all locations** | $795 |
| Enterprise | 8+ locations or 64+ drops. Custom limits. | **Call for pricing** |

**Ladder rationale:** Starter matches observed entry behavior (2–4 drops/month), so a new merchant never stares at unused capacity — the most common cause of first-cycle cancellation. Boss is anchored on three drops per week, which is how a merchant actually thinks about dead hours (Tuesday, Wednesday, Thursday afternoons), not on abstract volume.

**Superstar pooling:** the 64-drop allowance is an **Organization-level counter**, not per-location. The UI MUST display the shared balance. This is different plumbing from the lower tiers, which are location-level counters.

### 12.3 Maker Drop / DigiDrop pricing

| Tier | Allowance | Price |
|---|---|---|
| Tier 1 | 1 drop, one time | $99 |
| Tier 2 | 2 drops/month | $149/month |
| Tier 3 | 4 drops/month | $349/month |
| Tier 4 | 8 drops/month | $795/month |

Tier 1 is a try-it on-ramp priced below the recurring entry tier.

### 12.4 Introductory offer

$9 for 3 months on annual contracts. Applies on top of any tier.

### 12.5 Cycle

**30-day anniversary**, not calendar month. Avoids a bulk dump every 1st and is fairer to mid-month signups.

### 12.6 Cap behavior — soft block

When a merchant hits their monthly allowance:

1. Drop creation is blocked
2. A one-click upgrade is presented, **prorated and applied instantly**
3. The merchant is live again in under 60 seconds

**Not a hard wall and not overages.** A hard wall turns off the best merchants mid-momentum. Overages undermine the tier ladder and rebuild a volume-based revenue model by the back door.

### 12.7 Enterprise

Above Local Superstar. No self-serve checkout. Contact form; admin provisions manually with custom per-account limits.

Because of this, **limits MUST be stored as per-account configuration**, not derived from a hardcoded tier enum.

---

## 13. OPERATOR PORTAL (LOCAL)

### 13.1 Drop creation entry point

Drop building **always begins at the business profile and address.** The merchant selects the location, then builds the drop. Location is never an afterthought field on a drop form.

### 13.2 Add Location

An **Add Location** button is present at **all tiers**, always visible.

If the current subscription does not cover another location, the button fires an **upgrade paywall notification**. The feature is visible; the wall is the pitch. Never hide the button.

Maximum 8 locations before Enterprise.

### 13.3 Scoreboard

A persistent scoreboard occupies the **top right** of the operator interface:

- Drops used (this cycle)
- Drops remaining
- Live now
- Total catches
- Total redemptions
- Whispers received

This is the renewal argument rendered as furniture. It MUST be positioned where it cannot be missed.

### 13.4 Today's Code screen

- The active code(s) with **phonetic pronunciation guidance**
- **Live redemption feed**, with unverified auto-redeems marked
- **Printable counter card** (§7.3)

### 13.5 Other surfaces

- Drops management (list, filter by state, duplicate)
- New/Edit Drop
- Per-drop Stats
- Whispers (read-only)
- Account and billing

### 13.6 Staff access

`merchant_staff` sees **only** Today's Code and the live redemption feed, scoped to their location. No drop creation, no billing, no stats.

---

## 14. BUYER APPLICATION

Existing design language: departure-board aesthetic — split-flap tiles, transit typography, amber/rust palette. Scarcity expressed through **discrete inventory pips** and **permanent position numbers**, never a percentage progress bar.

### 14.1 Screens

| Screen | Contents |
|---|---|
| **Board** | On Fire + New per lane; nav tabs (§10.2) |
| **Drop Detail** | Offer, pips, catches remaining + percentage, merchant score, catch action |
| **Called It** | Wallet — active catches, Send tab, redemption entry |
| **Gone / Encore** | Browsable graveyard; Encore links |
| **Local** | Keypad code entry, GPS-gated |
| **You** | Profile, user number, clout, badges, addresses, follows/Fanatics, preferences |

### 14.2 Scarcity presentation — DOCTRINE

- Counters never increase mid-drop
- Sold out triggers an **Encore**, never a restock
- **Gone is browsable and permanent**, never deleted. A Gone drop holds its board position for 5 minutes carrying the Gone stamp, then leaves the board and remains permanently reachable under the business profile and the user's Past Drops. Leaving the board is not deletion — the graveyard is part of the product.
- Scarcity is a felt experience, not a percentage bar

---

## 15. PHASE ROADMAP

| Phase | Scope |
|---|---|
| **v1** | Local Drop. Buyer app, operator portal, admin portal, notifications, clout, transfers, subscriptions. |
| **Phase 2** | Maker Drop. Approval queue and curation workflow. **Payments** — money moves on purchases, reopening Stripe Connect, payouts, refunds, chargebacks, sales tax nexus. Field rep role. Native client. |
| **Phase 3** | DigiDrop. File hosting, license issuance, watermarking, practitioner session scheduling. Live streaming infrastructure. |

### 15.1 Phase 2 — payments, invoicing, and returns

Maker Drop is a **purchase**, not a redemption. Money moves. Stripe Connect, payouts, chargebacks, marketplace tax nexus, and 1099-K reporting are **deferred, not eliminated.** This is the single largest hidden scope item in the roadmap and must be planned as its own project.

The platform still takes **no percentage of sales** (§12.1). Money flows through to the maker; the platform's revenue remains the flat subscription. Restocking fees (§15.1.3) accrue to the **maker**, not the platform.

#### 15.1.1 Mini-invoicing — deliberately simple

Not an accounting system. The minimum that makes an order auditable:

- Invoice generated automatically at purchase
- Line items: product, quantity, unit price, shipping, tax, total
- Order ID, date, product ID, buyer name, maker
- PDF export for both parties
- No partial payments, no payment plans, no credit terms, no multi-currency

#### 15.1.2 Order management — tabular with action buttons

Makers get a single order table. This is the whole UI.

**Columns:** Order date · Order ID · Product ID · Product · Buyer name · Qty · Total · Status

**Sortable and filterable by date and product ID** — this is the primary flow the maker works in.

**Action buttons per row:** Mark Shipped · Add Tracking · Issue RMA · Refund · View Invoice

#### 15.1.3 Returns — two paths, one difference

Every return begins with an **RMA issued by the maker**. Money moves only **after the product is physically received** and the maker confirms receipt. Refund is **one click** at that point.

| Path | Trigger | Refund |
|---|---|---|
| **Vendor error** | Wrong item, damaged, not as described, maker fault | **100%** including original shipping |
| **Buyer error** | Changed mind, ordered wrong, no longer wanted | **80%** — a **20% restocking and handling fee** is retained by the maker. Return shipping is the buyer's. |

**RMA state machine:**
```
rma_requested → rma_issued → in_transit → received → refunded
                          ↘ rma_denied
```

Refund is blocked in code until state is `received`. No exceptions, no override. This protects the maker from the most common marketplace fraud — refund issued, product never returned.

**Disclosure requirement:** the 20% fee MUST be shown on the drop detail page before catch, on the invoice, and in the RMA request flow. Several states regulate restocking fees and all of them turn on clear pre-purchase disclosure. Disclosure is also what makes it enforceable at the card-network level in a chargeback.

#### 15.1.4 Chargebacks

A buyer who charges back rather than using the RMA path bypasses the restocking fee entirely. The maker's defense is the disclosure trail in §15.1.3 plus delivery confirmation. Tracking capture is therefore **mandatory**, not optional, on every shipped order.

### 15.2 Intellectual property posture

**Position: the platform is a conduit, not a publisher.** IP protection exists to insulate The Drop from liability arising from maker conduct. It is not a service provided to the maker.

#### 15.2.1 Maker agreement — required terms

Accepted at maker account creation, versioned, timestamped, and retained:

- **Warranty of ownership.** The maker warrants they own or are licensed for all IP in anything they drop — design, imagery, copy, audio, and likeness.
- **Full indemnification.** The maker indemnifies and holds The Drop harmless from any claim arising from their content, including the platform's legal fees, costs, and technical remediation expense.
- **Recusal of platform liability.** The maker acknowledges the platform exercises no editorial control over their IP and accepts sole responsibility.
- **Fee-shifting on adverse finding.** If the maker is found to have used unauthorized IP, they agree to pay all legal and technical recovery costs. Not The Drop.
- **Immediate takedown and termination rights** held by the platform, at sole discretion, with no cure period.

#### 15.2.2 Internal adjudication

A self-adjudicated process handles claims: notice to the maker, a response window, a platform determination, and enforcement of the fee-shifting clause on an adverse finding.

#### 15.2.3 Statutory safe harbor — build requirement

The indemnity above allocates risk **between the platform and the maker**. It does not bind a third-party rights holder, who can sue The Drop directly regardless of what the maker signed. The protection against that is statutory, and it is conditional on process:

- **Registered DMCA agent** on file with the U.S. Copyright Office
- **Published takedown procedure** and a notice-receipt endpoint
- **Counter-notice handling**
- **Repeat-infringer policy**, applied consistently and logged
- **Expeditious removal** on valid notice

These are engineering and operational requirements, not legal boilerplate. Missing any of them forfeits safe harbor and makes the indemnity the *only* defense — which is worth exactly as much as the maker's ability to pay.

Build the takedown surface into the admin portal in Phase 2.

### 15.3 Phase 3 legal dependency

The recorded-session / watermark / statutory damages clause ($250K ceiling) requires IP counsel review **before** DigiDrop launch.

**Counsel should also review** §15.2 as a package — indemnification enforceability, the self-adjudication clause, and the restocking fee disclosure language. The posture is sound; the wording is what determines whether it holds.

### 15.4 Live streaming (Phase 3)

Single camera, no cuts, no pause, no production. 20-minute pre-drop story window. Stream terminates immediately on sellout with a Gone card showing elapsed time. Framed as entertainment and connection, not a commerce tool. Infrastructure vendor undecided.

---

## 16. NON-NEGOTIABLE INVARIANTS

These are extracted into `CLAUDE.md` and MUST be enforced in code. An implementation that violates any of these is wrong regardless of how well it performs.

1. **Platform revenue is never a percentage of anything.** No rake, ever.
2. **Counters never go up.** No restocks. No released catches. No inventory returning to a pool.
3. **A live drop is immutable.** Quantity, price, and terms frozen. Enforced at the database layer.
4. **Position numbers are permanent and never reused.** Gaps are acceptable; collisions are not.
5. **One catch per buyer per drop.**
6. **Clout is never purchasable** and is earned only from completed redemptions, whispers, and attributed shares.
7. **All state decisions are server-authoritative.** The client is never trusted.
8. **The operator never enters a redemption code.** The buyer types it into their own device.
9. **Location permission denied is a blocking state**, never an alternate redemption path.
10. **Address governs discovery; GPS governs redemption.** Never conflate them.
11. **Gone is browsable.** The graveyard is permanent.
12. **Transfers are one hop**, with a 5-minute accept window and a 30-minute pre-close send cutoff.
13. **No preference tags are free-text.** The taxonomy is platform-controlled.
14. **All admin actions are logged and attributable.**
15. **The API is the product.** Every capability must be reachable by a native client.
16. **(Phase 2) No refund is issued before RMA state is `received`.** Enforced in code, no override.

---

*End of PRD v1.0*
