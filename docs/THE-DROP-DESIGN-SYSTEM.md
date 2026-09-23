# THE DROP — DESIGN SYSTEM

**Version:** 1.0
**Companion to:** THE-DROP-PRD.md, CLAUDE.md
**Consumer:** Claude Code / autonomous coding agent

---

## 0. THE IDEA

The product is a departure board. Not a metaphor applied to a commerce app — the actual object.

A split-flap board is a **physical machine in a bright hall.** The board is dark graphite. The hall around it is daylight. Information arrives by mechanical flip, not by fade. Nothing on a departure board is trying to persuade you; it states a fact and the fact is either still there or it isn't.

**That inversion is the whole design.** Most apps in this category are dark-mode-with-an-accent. This one is a **light room containing a dark object.** Cards are flap tiles mounted on a rail. The page is the terminal hall.

This is why there is less black than the reference: black is the board, not the background.

**Spend the boldness in one place — the flip.** Everything else stays quiet.

---

## 1. COLOR

### 1.1 Core palette — six values

```css
--hall:      #FAFAF8;  /* Page ground. Near-white, barely warm. The terminal hall. */
--board:     #23242A;  /* The split-flap housing. Dark graphite, cool cast. Not black. */
--ink:       #16171B;  /* Primary text on light. */
--signal:    #F25C05;  /* Live. Primary action. Hot saturated orange. */
--flap:      #F5B428;  /* Ending soon. Warning. Flap-yellow. */
--oxide:     #C0271A;  /* Gone. Used sparingly — never as decoration. */
```

### 1.2 Supporting neutrals

```css
--hall-sunk:   #F2F1ED;  /* Recessed panels, form field rest state */
--board-lift:  #2E3037;  /* Raised flap face on the board */
--board-deep:  #191A1F;  /* Board recess, tile gap */
--grey:        #6E7078;  /* Secondary text, metadata */
--grey-mute:   #9B9DA4;  /* Tertiary, disabled */
--hairline:    #E3E1DC;  /* Structural rules only */
--on-board:    #F0EEE8;  /* Text on the dark board */
```

### 1.3 Usage law

| Color | Where it is allowed |
|---|---|
| `--signal` | The Catch button. Live-state indicator. Filled inventory pips. Nothing else. |
| `--flap` | Ending-soon state. Low-inventory pips. Allowance-cap warnings. |
| `--oxide` | The Gone stamp. Destructive confirmations. **Never a border, never a background wash, never decoration.** |
| `--board` | Tile faces, the board rail, the code keypad. |

**Orange is the product's only loud voice.** If it appears in three places on one screen, two of them are wrong.

**No gradients anywhere.** A split-flap has no gradients. Solid fills, hard edges, real shadows.

### 1.4 State colors

```css
--state-live:       var(--signal);
--state-ending:     var(--flap);
--state-gone:       var(--oxide);
--state-unverified: var(--grey);   /* merchant feed only — never buyer-facing */
```

### 1.5 Dark mode

**Not in v1.** The design already contains its own dark surface. A global dark mode would collapse the hall-and-board relationship the whole system rests on.

---

## 2. TYPOGRAPHY

Three faces. Each has a job that the others cannot do. All free for commercial use, all self-hosted as WOFF2 — no Google Fonts CDN, no FOUT.

### 2.1 The faces

**Bricolage Grotesque** — display
Variable (`opsz`, `wght`, `wdth`). Squarish, slightly mechanical, real character at large sizes. A designer's face rather than a systems face — it reads as chosen, not defaulted. Google Fonts, OFL.
*Used for:* drop titles, the coupon-print offer line, page headings, the Gone stamp.

**Satoshi** — interface
Neutral, geometric, excellent at small sizes. Carries body copy, labels, form fields, and every operator-portal surface without competing with the display face. Fontshare (ITF), free commercial.
*Used for:* body, UI chrome, buttons, forms, tables.

**Departure Mono** — data
A free pixel-terminal face built after real departure-board displays. It is the only face permitted for numerals that represent **identity or scarcity.** By Helena Zhang, free commercial.
*Used for:* redemption codes, position numbers, user numbers, the split-flap numerals, countdown timers, inventory counts.

**Why three:** Departure Mono is not a third voice — it is a data instrument. It appears only where a number *is* the content. Restricting it to that role is what keeps it meaningful.

### 2.2 Scale

Base 16px. Ratio 1.25 with a display jump.

```css
--t-xs:    0.75rem;   /* 12 — metadata, timestamps */
--t-sm:    0.875rem;  /* 14 — labels, secondary */
--t-base:  1rem;      /* 16 — body */
--t-md:    1.125rem;  /* 18 — lead body */
--t-lg:    1.5rem;    /* 24 — card title */
--t-xl:    2rem;      /* 32 — page heading */
--t-2xl:   3rem;      /* 48 — coupon print */
--t-3xl:   4.5rem;    /* 72 — position number, hero */
```

### 2.3 Treatments

```css
.display    { font-family: Bricolage; font-variation-settings: 'wght' 600, 'wdth' 100, 'opsz' 40;
              line-height: 1.05; letter-spacing: -0.02em; }
.coupon     { font-family: Bricolage; font-variation-settings: 'wght' 800, 'wdth' 85;
              font-size: var(--t-2xl); line-height: 0.95; letter-spacing: -0.03em; }
.body       { font-family: Satoshi; font-weight: 400; line-height: 1.55; max-width: 68ch; }
.data       { font-family: 'Departure Mono'; font-weight: 400; letter-spacing: 0.04em;
              font-variant-numeric: tabular-nums; }
```

`tabular-nums` is mandatory anywhere a number changes in place. Counters that shift width while decrementing read as broken.

### 2.4 Typographic prohibitions

- **No tracked-out all-caps eyebrows.** Ever.
- **No single accented word** in a headline.
- **No `→` appended to buttons or links.**
- **No meta strings joined by middle dots.**
- Sentence case throughout. The only uppercase in the product is the redemption code and the Gone stamp.

---

## 3. SPACE, RADIUS, SHADOW

```css
--s-1: 4px;   --s-2: 8px;   --s-3: 12px;  --s-4: 16px;
--s-5: 24px;  --s-6: 32px;  --s-7: 48px;  --s-8: 64px;  --s-9: 96px;

--r-tile:  10px;   /* flap tile */
--r-field: 8px;    /* inputs */
--r-pill:  999px;  /* logo bubble, status chips */
--r-btn:   8px;
```

**Shadows are mechanical, not soft.** A flap tile is a physical object with a hard edge.

```css
--sh-logo:  -2px -2px 0 rgba(0,0,0,0.18);          /* logo bubble — wrong-direction pinned-badge shadow */
--sh-tile:  0 2px 0 var(--board-deep), 0 8px 16px -6px rgba(22,23,27,0.28);
--sh-lift:  0 4px 0 var(--board-deep), 0 16px 32px -8px rgba(22,23,27,0.34);
--sh-gone:  0 1px 0 rgba(0,0,0,0.10);              /* the single flat shadow */
```

**The generic `rgba(0,0,0,0.1)` card shadow does not appear anywhere in this system.** Tiles carry a hard bottom edge plus a cast shadow — that is what makes them read as physical.

---

## 4. THE DROP CARD

The signature component. Every other surface is subordinate to it.

### 4.1 Anatomy

```
┌──────────────────────────────────────┐
│                            [ LIVE ]  │   status chip, top-right
│ ┌──────────────────────────────────┐ │
│ │ ▓▓▓▓▓▓          FREE COFFEE       │ │   the drop tile fills the card (§15).
│ │ ▓ subj ▓        WITH ANY         │ │   Subject weighted to the LEFT third;
│ │ ▓▓▓▓▓▓          APPETIZER        │ │   coupon print OVERLAYS the clean RIGHT
│ └──────────────────────────────────┘ │   negative space — Bricolage 800/85.
│ ●●●●●●●○○○○○○○○○○○○○    12 left  24% │   pips + Departure Mono
│ ◉ Maxwell's                          │   ◉ = logo bubble (40px), left of the name
│ ▓▓▓▓▓▓▓▓░░ 87% redeemed              │   merchant score
└──────────────────────────────────────┘
```

The coupon print is **overlaid on the drop tile's negative space** (§15.4), not stacked above a separate photo. **The subject weighting and the type block flip left/right together, by drop ID (§15.5):** a right-weighted tile mirrors this — subject in the right third, coupon print on the left. The print sits only on the calm, empty side; it is **ink or white per ground for contrast, never over a scrim** (§15.4 legibility). If a tile does not leave its opposite side clean, the fix is regeneration, not a dark overlay — a scrim turns every card into the same muddy poster.

**Card dimensions are identical on mobile and desktop.** Desktop renders it larger and with motion; the composition never changes. One card design, two sizes.

### 4.2 The logo bubble

Circular, carrying `--sh-logo` — a hard 2px offset shadow, the wrong direction for a light source, so it reads as a **badge pinned onto the card** rather than a floating element. That wrongness is intentional and is the card's fingerprint.

The bubble sits **immediately left of the merchant name**, not in the card corner: **40px on the card front** (beside the merchant line) and **56px on the flip side** (beside the merchant name at the top of the honest face). It holds the merchant's mark. **There is no empty state:** when a merchant has no logo, the bubble shows a **monogram of the merchant's initials on its group ground color** (§15.3) — white on the dark grounds, ink on the light ones, exactly as the coupon print resolves. The identity is always present; only its form (mark vs. monogram) changes.

The mark is set by the operator in Account (uploaded, resized client-side to a small square webp, and stored inline as the org's `logo_url`) and travels on every DTO that renders a card — board, drop detail, wallet, and the business profile.

### 4.3 Coupon print

The offer line is the loudest type in the product. Condensed, heavy, tight-leaded. It is a printed coupon, not a headline — physical, slightly overbearing, two or three lines maximum.

It **overlays the drop tile's negative space** — the empty side opposite the subject — and flips left/right with the subject by drop ID (§15.5). Its color is **ink or white, chosen per ground for contrast** (§15.3): white over the dark grounds (orange, oxide, steel, teal, moss), ink over the light ones (amber, blush, mint, bone). No scrim, ever — the tile is generated to leave that side clean (§15.4); a tile that doesn't is regenerated.

Truncate at 3 lines. Never shrink to fit; a longer offer wraps to detail instead.

### 4.4 Motion-enhanced photo

Short cinemagraph loop. Not a video player — no controls, no sound, no scrubbing.

| Spec | Value |
|---|---|
| Format | WebM (VP9) + MP4 (H.264) fallback |
| Duration | 2–4s, seamless loop |
| Size ceiling | **400KB.** Hard limit. |
| Poster | Static WebP, always present, always loads first |
| Desktop | Plays on hover |
| Mobile | **Poster only by default.** Plays when the card is the focused in-view card. |
| `prefers-reduced-motion` | Poster only, always |

**Mobile must be fast and light.** Autoplaying loops on every card in a scrolling feed is the fastest way to break that. One card plays at a time.

### 4.5 Inventory pips

Discrete units, never a progress bar.

- ≤ 30 units: one pip per unit
- 31–100: pips represent 5 units each, remainder partial
- \> 100: pips represent 10 units each

Filled = `--signal`. Below 25% remaining, filled pips turn `--flap`. Empty = `--hairline` on light, `--board-deep` on board.

Card shows **absolute remaining and percentage.** Percentage is what ranks; absolute is what a human reads.

Pips animate on decrement with a 120ms hard step — no fade, no ease. A pip going out is a mechanical event.

### 4.6 Hover flip

Rolling over a card flips it to the clean face: **no image, no motion.** Deal type, terms, timing, merchant, distance — set in Satoshi, generously spaced, fully legible.

This is the card's honest side. The front sells; the back informs.

| Spec | Value |
|---|---|
| Trigger | Hover (desktop) / long-press (mobile) |
| Transform | `rotateY` 180°, `transform-style: preserve-3d` |
| Duration | 420ms |
| Easing | `cubic-bezier(0.2, 0.8, 0.2, 1)` — mechanical settle, slight overshoot |
| Reduced motion | Cross-fade, 160ms |

### 4.7 Card → page

Click expands card to full page. Shared-element transition: the card grows into the page, logo bubble and coupon print holding position.

The page carries everything: full terms, all stats, the position board, merchant profile, map, and **two buttons only — Catch and Share.**

No third action. No save-for-later, no wishlist, no follow button competing at the decision point.

### 4.8 Live stats

Real-time, moving, on both card and page. Feeds the decision.

| Stat | Source | Updates |
|---|---|---|
| Remaining + % | Realtime channel | Live |
| Catch rate | `drop_pressure` | 60s |
| Merchant redemption rate | `merchant_scores` | Daily |
| Time to close | Client countdown, server-anchored | 1s |
| Position you would get | Derived from remaining | Live |

**"You'd be #48"** shown next to the Catch button is the highest-value number on the page. It makes the position system legible before the user has ever caught anything.

### 4.9 Gone state

1. Drop sells out or the window closes
2. Card takes the **Gone stamp** — Bricolage 800, `--oxide`, rotated -4°, 70% opacity, overlaid
3. Card desaturates to greyscale, drops to `--sh-gone` — the single flat shadow
4. Becomes unclickable — `pointer-events: none`, hover flip disabled
5. **Remains on the board for 5 minutes**, then leaves
6. **Permanently browsable** under the business profile and under the user's Past Drops

The 5-minute persistence matters: seeing a drop die in front of you is the scarcity mechanic doing its work. Removing it instantly hides the evidence.

---

## 5. POSITION NUMBERS

The status artifact. Design it so a 18-year-old reads it once and immediately wants a lower one.

### 5.1 Treatment

Departure Mono, `--t-3xl`, `--signal` on `--board`. No label. No "Position:" prefix. No `#` on the hero treatment.

```
┌─────────────┐
│             │
│     047     │   Departure Mono, 72px, --signal
│             │
│  of 200     │   Satoshi 14px, --grey-mute
└─────────────┘
```

Zero-padded to the drop's digit width — 047 of 200, not 47. Padding is what makes it read as a ticket rather than a count.

### 5.2 Where it lives

| Surface | Treatment |
|---|---|
| Catch confirmation | Full-screen, split-flap animated arrival |
| Wallet card | 32px inline, left-aligned |
| Public position board | Ranked list, handle + number |
| Profile | Best positions held, as a collection |
| Pre-catch on drop page | "You'd be 048" — the hook |

### 5.3 Why it works for a young user

Low number = early = status, with zero explanation required. The split-flap arrival animation on catch makes the number feel **issued** rather than calculated. It is screenshot-shaped on purpose — vertical, high-contrast, self-explanatory out of context.

### 5.4 User number

The permanent 14-digit account number, Departure Mono, `--grey`, small, on the profile. Full padding: `00000000000047`.

Never hero-sized. It is a quiet flex — the people who care will find it.

---

## 6. THE SPLIT-FLAP

The one place with real motion. It appears in exactly three moments and nowhere else.

### 6.1 Where

1. **Board arrival** — a new drop going live flips into the rail
2. **Catch confirmation** — the position number flipping into place
3. **Gone** — the state flipping over

**Not on load. Not on scroll. Not on hover.** A board that flips constantly is noise; a board that flips when something actually changed is information.

### 6.2 Mechanics

| Spec | Value |
|---|---|
| Flip unit | One character |
| Per-character duration | 180ms |
| Stagger | 40ms left to right |
| Intermediate frames | 3–5 random characters from the code alphabet before settling |
| Easing | `cubic-bezier(0.45, 0.05, 0.15, 1)` |
| Split line | 1px `--board-deep` across the tile center, always visible at rest |
| Sound | None |
| Reduced motion | Instant set, no intermediates |

The horizontal split line at rest is what identifies the tile as a flap before it ever moves.

---

## 7. FORMS AND THE CODE KEYPAD

### 7.1 Fields

Easy to find, easy to open, easy to type into.

```css
input {
  background: var(--hall-sunk);
  border: 1px solid var(--hairline);
  border-radius: var(--r-field);
  padding: 14px 16px;
  font: 400 var(--t-base) Satoshi;
  min-height: 48px;
}
input:focus {
  background: #FFF;
  border-color: var(--signal);
  box-shadow: 0 0 0 3px rgba(242,92,5,0.14);
  outline: none;
}
```

Labels sit **above** the field, `--t-sm`, `--grey`, always visible. No floating labels — they hide the label exactly when someone is typing.

Errors sit below in `--oxide`, stating what to fix rather than what went wrong.

### 7.2 The redemption keypad

Tapping **Redeem** opens a field sheet from the bottom.

```
┌──────────────────────────────┐
│  Enter the code              │
│                              │
│   ┌───┐ ┌───┐ ┌───┐ ┌───┐    │
│   │ K │ │ 7 │ │ M │ │   │    │   Departure Mono 40px
│   └───┘ └───┘ └───┘ └───┘    │   --board tiles, --on-board text
│                              │
│  Maxwell's · Main St         │
│                              │
│         [  Redeem  ]         │
└──────────────────────────────┘
```

- Four separate character tiles, Departure Mono, `--board` background
- Auto-advance on entry, auto-submit on the fourth character
- Uppercase-only input; lowercase silently transformed
- Characters outside the 24-symbol alphabet are rejected at the keystroke — they never appear
- `inputmode="text"`, `autocomplete="off"`, `autocapitalize="characters"`
- Filled tile does a single flap-flip as it takes the character

Sheet height sits above the mobile keyboard. The field is never obscured.

---

## 8. BUTTONS

```css
.btn-catch {            /* THE button. One per screen, maximum. */
  background: var(--signal); color: #FFF;
  font: 600 var(--t-md) Satoshi;
  padding: 16px 32px; border-radius: var(--r-btn);
  min-height: 52px;
  box-shadow: 0 2px 0 #C94A04;   /* hard bottom edge — a physical key */
}
.btn-catch:active { transform: translateY(2px); box-shadow: none; }

.btn-secondary {        /* Share, Cancel, Back */
  background: transparent; color: var(--ink);
  border: 1px solid var(--ink);
}

.btn-board {            /* on dark surfaces */
  background: var(--board-lift); color: var(--on-board);
}
```

Buttons say exactly what happens. **Catch**, **Redeem**, **Send**, **Share**. Never Submit, never Continue, never Learn More. Never an arrow glyph.

---

## 9. OPERATOR PORTAL

Same tokens. Different density. Operators are working, not browsing.

- Desktop-first, data-dense, tables over cards
- **Scoreboard fixed top-right on every screen** — `--board` panel, Departure Mono numerals, `--signal` on the number that matters most this cycle
- Today's Code screen renders the code at `--t-3xl` Departure Mono on `--board`, readable across a counter
- Phonetic guidance beneath in Satoshi `--t-md`
- Live redemption feed, newest first, unverified entries marked with a `--grey` dot and the word *unverified*
- Add Location is always visible at every tier; the paywall fires on click and never hides the control

---

## 10. RESPONSIVE

```css
--bp-sm:  480px;
--bp-md:  768px;
--bp-lg:  1024px;
--bp-xl:  1440px;
```

| Surface | Mobile | Desktop |
|---|---|---|
| Board | 1 column | 2–3 columns |
| Card | Identical composition, smaller | Identical composition, larger |
| Motion photo | Focused card only | Hover |
| Flip | Long-press | Hover |
| Operator | Functional, cramped | Primary target |

**The card composition is identical at every size.** Logo bubble, coupon print, photo, pips, stats — same order, same proportions, same hierarchy. Only scale and motion budget change.

---

## 11. PERFORMANCE BUDGET

Mobile is the product. These are limits, not goals.

| Metric | Budget |
|---|---|
| LCP (board, 4G) | < 2.0s |
| Initial JS | < 180KB gzipped |
| Fonts | 3 WOFF2, subset latin, `font-display: swap`, ~138KB total (WP-13 actual: Bricolage variable 76KB + Satoshi variable 42KB + Departure Mono 22KB). Bricolage's 76KB earns its place — it is the display face and its variable weight/width axes are used. |
| Cinemagraph | 400KB each, lazy, one playing at a time |
| Board query | < 200ms p95 |
| CLS | < 0.05 |

Cards reserve their full dimensions before content loads. A board that reflows while inventory is falling is unusable.

---

## 12. ACCESSIBILITY

- Contrast: `--ink` on `--hall` = 15.8:1. `--on-board` on `--board` = 12.1:1. **`--signal` on white fails at body size — it is permitted only at ≥18px bold or as a fill behind white text.**
- Every interactive element has a visible focus ring: 3px `rgba(242,92,5,0.4)`
- `prefers-reduced-motion` disables every flip; state changes still register instantly
- Touch targets ≥ 44px
- Live inventory changes announced via `aria-live="polite"`, throttled to 5s
- Position number carries an `aria-label`: "Position 47 of 200"
- Color never carries meaning alone — Gone has a stamp, not just a hue

---

## 13. WHAT THIS SYSTEM IS NOT

Rejected deliberately. Do not reintroduce.

| Not | Why |
|---|---|
| Dark mode app with an accent | The board is the dark object; the page is the hall |
| Cream background + serif display + terracotta | Generic, and terracotta is one hue off `--signal` |
| Percentage progress bars | Scarcity is discrete. Pips, always. |
| Soft `rgba(0,0,0,0.1)` card shadows | Tiles are physical. Hard edge plus cast. |
| Gradients | A split-flap has none. |
| Fade-and-slide-up section entrances | The generic AI tell. Motion only on real state change. |
| All-caps tracked eyebrow labels | See §2.4 |
| Arrows on buttons | See §8 |
| Urgency copy | Scarcity does the work. See CLAUDE.md. |

---

## 14. TOKEN FILE

Ship as `app/styles/tokens.css`, imported once at root. **No component may hardcode a hex value.** A hardcoded color in a PR is a review rejection.

---

---

## 15. TILE GRAMMAR

Merchants do not supply photography and do not write prompts. The system generates tile imagery from the drop record and a category template. This section is what keeps 600 merchants' worth of content looking like one product.

Treat this with the same standing as the color tokens. A prompt tuned for one category in isolation is how the board stops matching itself.

### 15.1 Two tile types

| Type | Purpose | Composition |
|---|---|---|
| **Drop tile** | The merchant's actual offer, on the drop card | **One subject.** Weighted to one third, negative space held opposite for the coupon print. |
| **Category tile** | Browse furniture — group chips and leaf filters | **Dense flat-lay.** Six to eight items in a loose grid, filling the frame edge to edge. |

A category tile shows range. A drop tile shows one thing. Never blend them.

### 15.2 Fixed grammar — every tile, both types

- 16:9
- **Shot straight down from directly above** (flat-lay style) or **straight on** (result style). Never a dramatic angle. This removes the question of what the room behind the product looks like — a taqueria's actual kitchen never appears.
- **Flat solid color ground**, edge to edge — a single uniform color fill with **no texture, no gradient, no shading, no vignette, no wall or surface detail**. The ground is a **deep, saturated, full-strength rendering of the group's color (§15.3)** — the true rich shade, never pale, washed-out, greyed, or tinted lighter. In the prompt the ground word and this saturation instruction travel together, never split apart. The rendered ground **is** the color the buyer actually sees; the CSS token only appears as label backing (§15.2.2). If the photo ground drifts lighter than its token, the wayfinding is coded to a color that is not on screen — blur a pale steel-blue against a pale moss and they read as neighbours; blur `#2E5A78` against `#5E7444` and they do not.
- Bright even studio light. Soft contact shadow only — **no dramatic or raking light**
- **The lower third is a reserved quiet zone.** Composition stays calm there; the label sits on it.
- No text, no logos, no faces, no hands
- No props, no styling, no clutter. Ground visible between items.
- Cheerful, punchy, contemporary

The flat ground does the work. It makes unrelated subjects read as siblings, it survives being shrunk to 200px because there is no fine detail to lose, and it is the one variable the platform fully controls.

> **Known limit of the saturation anchor (measured, 2026-09-18, Ideogram 4.0, 24-tile pass).** The "deep, saturated" wording fixes the failure it was written for — the muted tokens that washed out to grey — but it **overshoots bright and warm tokens**, which do not want more saturation. Measured mean-vs-target deltas (max RGB channel):
> - **Fixed, the reason this exists:** steel `#2E5A78` went from Δ82 (pale grey-blue) to **Δ21/25**; teal `#1E7A6F` landed at **Δ15/18**. These were the muddy blur-test neighbours; they now read true.
> - **Overshoots:** orange `#F25C05` renders dark/burnt (**Δ60–75**, the worst); moss `#5E7444` is uneven (Pets Δ12 but Activities/Outdoor **Δ45–51**); two of five bone `#EDE6D8` tiles warm toward tan (**Δ57–63**).
> - **Net:** 15 of 24 within Δ30, and no two adjacent grounds collide (burnt-vs-hot orange is one shade between two oranges, and nothing else is near either — wayfinding holds).
>
> A words-only saturation push is the wrong tool for an already-saturated or light token. If this is revisited, start from these numbers, not a fresh pass. A per-token hex anchor was considered and deferred: these models read hex loosely, and on a rank-3 element (§15.2.1) it risks trading one overshoot for another. The real acceptance test is **tiles in the board at mobile size with labels on them**, not the measurement — fix against that surface if orange still reads wrong there.

### 15.2.1 Navigation hierarchy — DOCTRINE

A category tile is **navigation furniture**, not a photograph. Three jobs, in strict priority:

| Rank | Element | Job |
|---|---|---|
| 1 | **Ground color** | Recognition. Orange means food before anything is read. |
| 2 | **CSS label** | Navigation. Says exactly where this goes. |
| 3 | **Photography** | Appeal only. Carries **zero** navigational load. |

**Photography must never make it harder to tell where to tap.** If a tile is visually rich and navigationally ambiguous, it has failed regardless of how good it looks.

**The blur test:** blur a tile until the items are unreadable. If you can still tell food from auto from retail, it passes. If you cannot, the ground color is wrong — not the photograph.

At mobile a category chip is roughly 160×90. Nothing inside the image is legible at that size and nothing is expected to be. Density is safe as long as the ground stays visible between items and the quiet zone holds.

**The label strip carries the exact ground token; the photo ground may drift — and that is fine.** Rank-1 is the ground *color*, and the surface the eye actually locks onto is the CSS label strip (§15.2.2), filled with the group's exact `--g-*` token and pixel-identical on every chip. The generated photo ground behind it only approximates that token; by measured variance it can drift a shade (the saturation anchor overshoots bright and warm tokens — §15.2). **That drift never reaches wayfinding.** The token-accurate strip is always on screen carrying the label, so no two groups collide on the color the navigation is coded to, however the photo grounds render. This is why the color question is settled at the token, not the pixel: a photo ground that is merely close is good enough, because the strip — not the photo — is the wayfinding surface. Chase pixel-accuracy in the generated ground only if a tile fails the blur test on this surface, never against a measurement.

### 15.2.2 Labels are CSS, never generated

The category name is a **real DOM element overlaid on the tile.** It is never generated into the image.

Generated text at 200px tall is illegible and misspells; a renamed category would mean regenerating a $0.06 asset; and generated type cannot be translated, selected, or read by a screen reader. A CSS label is crisp at every size, free to change, and accessible.

The tile is the ground. The label sits on it.

### 15.2.3 Four tile styles

Set per leaf as `tile_style` on the taxonomy row. Assigned deliberately, never inferred from the group.

| Style | Use | Composition |
|---|---|---|
| `flatlay` | Products — food, retail, goods | Six to eight items, loose grid, edge to edge |
| `result` | Services — the finished state, not the tools | The outcome, shot straight on. Spotless glass, pressed shirts, a cut lawn. **Never the equipment.** |
| `transformation` | Services where the change is the product | Before and after in one frame, hard edge between. Pressure washing, detailing, carpet, tile and grout. |
| `result-from-behind` | Personal services — the result lives on a person, and §15.2 forbids faces | The finished result shot from directly behind or cropped so no face appears: a fresh fade from the back, a hand with finished nails. **No eyes, never a face.** |

Roughly 200 of the 454 leaves are services. Nobody wants to look at squeegees — they want the gleaming window. `result` and `transformation` exist because a flat-lay of tools says nothing about what the customer is buying, and `result-from-behind` exists because the best proof for a haircut or a manicure is the person wearing it — which the no-faces rule (§15.2) otherwise rules out. Behind, or cropped to the hands, keeps both.

### 15.3 Ground colors — 24 groups, 9 grounds

Colors belong to the **group**. Every leaf inherits its parent's ground unchanged. Per-leaf tints are forbidden — 454 shades reads as overdone and destroys color as wayfinding.

```css
--g-orange: #F25C05;   --g-amber:  #F5B428;   --g-oxide: #C0271A;
--g-steel:  #2E5A78;   --g-teal:   #1E7A6F;   --g-moss:  #5E7444;
--g-blush:  #E4826E;   --g-mint:   #58B89C;   --g-bone:  #EDE6D8;
```

| Ground | Groups |
|---|---|
| `--g-orange` | Food & Drink · Grocery & Specialty Food |
| `--g-amber` | Coffee & Bakery · Kids & Family |
| `--g-oxide` | Bars & Nightlife · Entertainment |
| `--g-steel` | Auto · Professional Services |
| `--g-teal` | Home Services · Home Improvement |
| `--g-moss` | Outdoor & Yard · Activities & Outdoors · Pets |
| `--g-blush` | Personal Care · Retail — Apparel · Events & Celebrations |
| `--g-mint` | Health & Wellness · Fitness · Travel & Stays |
| `--g-bone` | Jewelry & Accessories · Retail — Home & Lifestyle · Retail — Gear & Hobby · Education & Lessons · Digital & Creative |

Ground color is stored on the `tags` group row, not hardcoded in a prompt template.

### 15.4 Prompt assembly

Assembled server-side from three parts. The merchant contributes only the subject, and contributes it by describing their offer in plain words — never by writing a prompt.

```
[type clause]  →  drop tile: one subject, left third, empty right
                  category tile: dense grid, six to eight items, edge to edge

[subject]      →  from the drop record, or the leaf's item list for a category tile

[ground]       →  the group's ground color

[fixed grammar] → §15.2, appended verbatim, never edited per request
```

The fixed grammar block is a constant. Any change to it changes every tile in the product and is a design decision, not a tuning pass.

**Coupon legibility — the negative space is a contract.** The drop tile's empty two-thirds carry the coupon print overlaid on the card (§4.3), so that side must generate as clean flat ground: no subject bleed, no stray object, no cast shadow reaching into it. The print is ink or white chosen per ground for contrast (§15.3) and **never sits on a scrim** — a dark overlay to force contrast collapses every card into the same muddy poster, which is the exact failure the flat-ground grammar exists to avoid. A tile whose calm side is not clean **fails and is regenerated**; the fix is a better generation, never a treatment layered on a bad one. Generation checks the opposite third for uniformity against the ground and re-rolls the ones that bled.

### 15.5 Subject weighting

Drop tiles alternate left- and right-weighted by drop ID, with the type block flipping to match. Uniform left-weighting is consistency bought at the cost of rhythm — the board needs variation inside the grammar, not outside it.

### 15.6 Model and cost

**Ideogram 4.0** (`ideogram:4@0`), ~$0.06 per tile at 2560×1440.

| Asset | Volume | Cost |
|---|---|---|
| Category tiles — 24 groups + 454 leaves | 478, **one time** | ~$29 |
| Drop tiles | Recurring, per drop | $0.06 each |

Category tiles are generated once and stored. Only drop tiles recur, so that is the only place generation volume becomes a business decision — **cap generations per drop** rather than letting a merchant regenerate without limit.

Photo-realistic models (Juggernaut Z, FLUX.1 + Photo LoRA) cost ~20× less and are viable for drop tiles where no graphic treatment is needed. Evaluate per category; do not mix models within a category.

### 15.7 Explicitly rejected

| Rejected | Why |
|---|---|
| Dramatic raking light, deep shadow, cinematic falloff | Fights the near-white hall. Tiles sit on light, not on dark. |
| Generated type of any kind inside a tile | Illegible at 200px, misspells, cannot be renamed, translated, selected, or read aloud. Labels are CSS. |
| Per-leaf color tints | 454 shades reads as overdone and destroys color as wayfinding. |
| Merchant-written prompts | The grammar is the product. Merchant-authored prompts are how the board becomes a classifieds page. |
| Photographs of service equipment | A squeegee is not what the customer is buying. Show the clean window. |
| Photography that competes with navigation | A tile that is visually rich and navigationally ambiguous has failed. See §15.2.1. |
| Generated imagery on Maker Drop (Phase 2) | A generated image of a physical object bought sight unseen is a returns and chargeback magnet. Local only. |

---

*The board is the object. The page is the hall. The flip is the only loud thing.*
