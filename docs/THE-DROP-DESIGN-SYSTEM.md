# THE DROP — DESIGN SYSTEM

**Version:** 2.0 — ported to the Claude Design system
**Companion to:** THE-DROP-PRD.md, CLAUDE.md, design-system/DESIGN.md
**Consumer:** Claude Code / autonomous coding agent

---

## 0. THE IDEA

The product is a scarcity board. Makers and merchants *drop*; buyers *catch*; sold out is *Gone*; more supply is an *Encore*. Nothing on the board is trying to persuade you — it states a fact, and the fact is either still there or it isn't.

**The board is a dark object in a light room.** Cards are dark ink tiles on a near-white hall. Colour arrives in bold blocks — one orange action per view — not as tints everywhere. Scarcity is shown with discrete inventory pips and permanent position numbers, never a percentage bar. **Spend the boldness in one place; everything else stays quiet.**

**This version is ported to the Claude Design system** (`design-system/DESIGN.md`). Claude Design is the source of truth for colour, type, space, radius, elevation, motion and the primitive components. It won on everything it covers. Three things it did **not** override, because they are the product, not the styling:

1. **Scarcity stays discrete** — pips are N units, never a continuous bar (§4.5, §15).
2. **The lexicon** — Drop / Catch / Gone / Encore / Whisper / Clout. Governed by CLAUDE.md, not by any design source. Components live under `components/drops/`, never `deals/`; there is no `DealCard`, no "Claim".
3. **The three boundary lint rules** — `no-supabase-in-ui`, `no-server-actions`, `no-dangerous-html` — survive as `error`. They are what keeps the web app a client of the `/v1` API and not a backend rewrite (invariant #15).

What the port kept from the original board doctrine, because Claude Design does not cover it: the **Drop Card** composition (§4), **position numbers** (§5), the **split-flap** mechanic (§6), and the **tile grammar** (§15). Those sections are doctrine and carry the same standing as the tokens.

---

## 1. COLOR

The Claude palette is the source of truth. The app's original component tokens (`--hall`, `--board`, `--signal`, …) are re-pointed to it as aliases, so the two names resolve to one value.

### 1.1 Core palette

```css
--primary:   #FF6600;  /* Drop Orange. Live. The Catch action. Filled pips. */
--secondary: #005599;  /* Drop Blue. Focus, links, secondary accents. */
--c-ink:     #121212;  /* The card tile front. A legitimate dark surface. */
--background: #FDFDFD;  /* Page ground — the hall. Near-white. */
--surface:   #FFFFFF;  /* Cards, sheets, fields. */
--warning:   #FFC21A;  /* Ending / allowance-cap warnings. */
--danger:    #E5243B;  /* Gone, critical scarcity, destructive. Never decoration. */
```

Legacy aliases (unchanged call sites resolve through these): `--hall → --background`, `--board → --c-ink`, `--signal → --primary`, `--flap → --warning`, `--oxide → --danger`, `--on-board → --text-on-color`, `--hairline → --c-border`.

### 1.2 Supporting neutrals

A single neutral ramp (`--n-0 … --n-900`, near-white to `#111827`) plus orange and blue ramps (`--o-*`, `--b-*`) for component states. Text: `--text-primary #111827`, `--text-secondary #4b5563`, `--text-tertiary #6b7280`, `--text-disabled #9ca3af`, `--text-on-color #fff`. Borders: `--c-border #e5e7eb`, `--border-strong #d1d5db`.

### 1.3 Usage law

| Colour | Where it is allowed |
|---|---|
| `--primary` (orange) | The Catch button. Live indicator + status dot. Filled inventory pips. **One primary action per view.** |
| `--secondary` (blue) | Focus ring, links, quiet secondary accents. |
| `--warning` | Ending-soon, low-inventory pips, allowance-cap warnings. |
| `--danger` | The Gone stamp, critical scarcity (≤15% pips), destructive confirmations. **Never a border, background wash, or decoration.** |
| `--c-ink` | Card tile faces, the code keypad, dark panels. |

**Orange is the product's only loud voice.** If it appears in three places on one screen, two of them are wrong. **No aggressive gradients** — at most a single soft radial highlight on a colour block.

### 1.4 State colors

```css
--state-live: var(--primary);  --state-ending: var(--warning);
--state-gone: var(--danger);   --state-unverified: var(--text-tertiary);  /* merchant feed only */
```

### 1.5 Dark mode

**Not in v1.** The system is light-first and already contains its own dark surface (the ink card). A global dark mode would collapse the hall-and-board relationship.

---

## 2. TYPOGRAPHY

Three faces, each with a job the others cannot do. Loaded via `next/font/google`, self-hosted from `/_next/static` — so the strict CSP (`font-src 'self'`) is satisfied with no Google Fonts origin and no FOUT.

### 2.1 The faces

**Inter** — display + interface (`--font-display`, `--font-ui`)
Carries drop titles, the coupon-print offer line, headings, buttons, and all UI chrome. Display weight 900 with tight negative tracking; UI weight 400–700.

**Newsreader** — prose (`--font-body`)
A serif, for genuine prose someone **reads**: the drop description and card-back descriptive copy. Nothing else.

**JetBrains Mono** — data (`--font-data`)
The only face for numerals that represent **identity or scarcity**, and for labels and status. Redemption codes, position numbers, user numbers, split-flap numerals, inventory counts, and every mono-uppercase field label (`REMAINING`, `WHERE`, `LIVE`).

### 2.2 The serif rule — carries prose, never data

**Newsreader appears only where there is something to read.** The drop description and card-back descriptive copy are serif. Structured values — Where, Window, Redeemed, address, percentages, counts — are Inter or JetBrains Mono. Every field label is mono-uppercase, so the card back and the detail page agree.

The reasoning, because a future session will be tempted to widen it: *a serif carries prose someone reads; it does not carry data someone scans.* Scoping it is also what makes it meaningful — appearing only where there is prose signals "this is prose" every time, instead of the serif becoming the default body face. Never set `--font-body` on a container that also holds fact values; target the prose element itself.

### 2.3 Scale & treatments

Base 16px, display ladder 72/48/32/24/18/16/14/12 (`--t-3xl … --t-xs`).

```css
.display { font-family: var(--font-display); font-weight: 900; line-height: 0.95; letter-spacing: -0.045em; }
.coupon  { font-family: var(--font-display); font-weight: 900; font-size: var(--t-2xl);
           line-height: 0.95; letter-spacing: -0.04em; }        /* the coupon print / offer line */
.body    { font-family: var(--font-body); line-height: 1.6; }    /* prose only — see §2.2 */
.data    { font-family: var(--font-data); font-weight: 500; letter-spacing: 0.02em;
           font-variant-numeric: tabular-nums; }
```

`tabular-nums` is mandatory anywhere a number changes in place — a counter that shifts width while decrementing reads as broken.

### 2.4 Typographic law

- **Uppercase mono is the label/status/code treatment** (JetBrains Mono, tracked) — `LIVE`, `REMAINING`, `WHERE`, redemption codes. It is **not** a decorative eyebrow above a heading; never track out a caps line as ornament.
- **Sentence case** for headings and buttons ("Catch", "Redeem"). Uppercase belongs to labels, status, and codes only.
- **No single accented word** in a headline. **No `→` on buttons or links.** **No meta strings joined by middle dots** as decoration (the "·" separator between metadata is fine).

---

## 3. SPACE, RADIUS, ELEVATION, MOTION

```css
--s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px;
--s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px; --s-9: 96px;
--gap: 16px; --card-padding: 24px; --screen-gutter: 16px;
--control-sm: 32px; --control-md: 44px; --control-lg: 56px;

--r-xs: 4px; --r-field: 8px; --r-btn: 8px; --r-md: 12px;   /* segmented, toasts, coupon box */
--r-tile: 16px;  --r-sheet: 24px;  --r-pill: 9999px;        /* card / sheet-hero / chips-badges */
```

**Elevation is soft and neutral** — a reversal of the original hard-edge "mechanical flap" shadow. Claude Design uses resting neutral shadows and reserves colour for hover glows.

```css
--sh-xs; --sh-sm; --sh-md; --sh-lg;                 /* neutral resting elevation */
--sh-hot:  0 10px 24px -8px rgba(255,102,0,.55);     /* primary button, hover only */
--sh-brand:0 10px 24px -8px rgba(0,85,153,.5);       /* secondary button, hover only */
--sh-sticker: 0 0 0 3px #fff, 0 0 0 6px #ff6600;     /* colour→white→orange keyline; hero badges only */
/* legacy names now resolve to soft elevation: --sh-tile → --sh-md, --sh-lift → --sh-lg, --sh-logo → --sh-sm, --sh-gone → --sh-xs */
```

**Glass** (78% white + 16px blur) is used only on floating chrome — the nav and the mobile tab bar. Scrims are neutral ink at ~55%.

**Motion.** Hover/colour 120–200ms `ease-out`; toggles, sheets, segmented thumbs 360ms `ease-spring` (slight overshoot); the card flip 420–560ms. Buttons lift −2px on hover and press to `scale(.96)`. Live dots pulse. **Board entrances rise 8px + fade with a 40ms stagger** (`drop-in`) — the one blessed entrance, and it is disabled under `prefers-reduced-motion`. There are **no countdown timers** (§13).

---

## 4. THE DROP CARD

The signature component. Every other surface is subordinate to it. `components/drops/DropCard.tsx`.

### 4.1 Anatomy

```
┌──────────────────────────────────────┐
│                            [• LIVE]  │   status Badge, top-right: mono pill + pulse dot
│ ┌──────────────────────────────────┐ │
│ │ ▓▓▓▓▓▓          FREE COFFEE       │ │   the drop tile fills the card (§15).
│ │ ▓ subj ▓        WITH ANY         │ │   Subject weighted to one third;
│ │ ▓▓▓▓▓▓          APPETIZER        │ │   coupon print OVERLAYS the clean
│ └──────────────────────────────────┘ │   opposite side — Inter 900 (.coupon).
│ ▬▬▬▬▬▬▬ ░░░░░░░░░░░░    12 left · 24% │   discrete pips + .data
│ ◉ Maxwell's                          │   ◉ = logo bubble (40px), left of the name
│ ▬▬▬▬▬▬▬▬░░ 87% redeemed              │   merchant score
└──────────────────────────────────────┘
```

The coupon print is **overlaid on the drop tile's negative space** (§15.4), not stacked above a separate photo. **The subject weighting and the type block flip left/right together, by drop ID (§15.5).** The print sits only on the calm, empty side; it is **ink or white per ground for contrast, never over a scrim** (§15.4). If a tile does not leave its opposite side clean, the fix is regeneration, not a dark overlay.

**Card composition is identical on mobile and desktop.** Only scale and motion budget change. Faces carry the soft `--sh-md`; the card radius is `--r-tile` (16).

### 4.2 The logo bubble

Circular, `--sh-sm` (soft), sitting **immediately left of the merchant name** — 40px on the front, 56px on the flip side. It holds the merchant's mark. **There is no empty state:** with no logo the bubble shows a **monogram of the merchant's initials on its group ground colour** (§15.3) — white on the dark grounds, ink on the light ones, exactly as the coupon print resolves.

> Note: the port dropped the original "wrong-direction hard offset" badge shadow in favour of the soft neutral elevation used everywhere else. The bubble still reads as pinned by its ground fill and position, not by a hard shadow.

The mark is set by the operator in Account and travels on every DTO that renders a card — board, drop detail, wallet, business profile.

### 4.3 Coupon print

The offer line is the loudest type in the product — Inter 900, tight-leaded, two or three lines maximum. It is a printed coupon, not a headline. It **overlays the drop tile's negative space** and flips left/right with the subject by drop ID (§15.5). Colour is **ink or white, chosen per ground for contrast** (§15.3). No scrim, ever. Truncate at 3 lines; a longer offer wraps to detail instead.

### 4.4 Motion-enhanced photo

Short cinemagraph loop — no controls, no sound, no scrubbing. WebM (VP9) + MP4 fallback, 2–4s seamless, **400KB hard ceiling**, static WebP poster always present. Desktop plays on hover; mobile plays only the one focused in-view card; `prefers-reduced-motion` is poster-only. Autoplaying every card in a scrolling feed is the fastest way to break mobile — one card plays at a time.

### 4.5 Inventory pips — discrete, never a bar

The scarcity mechanic. **Twelve remaining is twelve things.**

- ≤ 30 units: one pip per unit
- 31–100: 5 units per pip, remainder partial
- \> 100: 10 units per pip

Each pip is a rounded unit (`11×6px`, `--r-pill`). Filled = `--primary`; at ≤15% remaining the fill turns `--danger` (`.pip-low`). Empty = `--surface-muted` on light, translucent white on the ink card. A pip going out is a **120ms hard step** — no fade. The card shows **absolute remaining and percentage**: percentage ranks, absolute is what a human reads.

> The port took the visual polish of Claude Design's ScarcityBar (rounded unit, orange fill, red at critical) but kept the units **discrete** — the continuous ScarcityBar meter is explicitly not ported (§13, non-override #1).

### 4.6 Hover flip

Rolling over a card flips it to the clean face: **no image, no motion.** The **description reads in Newsreader** (§2.2); the structured facts (Remaining, Window) are mono/Inter under mono-uppercase labels. The front sells; the back informs.

| Spec | Value |
|---|---|
| Trigger | Hover (desktop) / long-press (mobile) |
| Transform | `rotateY` 180°, `preserve-3d`, `backface-visibility: hidden` |
| Duration | 420ms, `cubic-bezier(0.2,0.8,0.2,1)` |
| Reduced motion | Cross-fade, 160ms |

### 4.7 Card → page

Click expands the card to full page. The page carries everything — full terms, all stats, the position hint, merchant profile, redemption window — and **two buttons only: Catch and Share.** No third action at the decision point.

### 4.8 Live stats

Real-time on both card and page. Remaining + % (realtime channel, live), catch rate (`drop_pressure`, 60s), merchant redemption rate (`merchant_scores`, daily), position you would get (derived, live). **"You'd be #48"** next to Catch is the highest-value number on the page — it makes the position system legible before the user has caught anything.

### 4.9 Gone state

1. Drop sells out or the window closes.
2. Card takes the **Gone stamp** — Inter 900, `--danger`, rotated −4°, ~70% opacity, overlaid.
3. Card desaturates to greyscale, drops to `--sh-xs` (the flattest shadow).
4. Becomes unclickable — `pointer-events: none`, flip disabled.
5. **Remains on the board for 5 minutes**, then leaves.
6. **Permanently browsable** under the business profile and the user's Past Drops.

Seeing a drop die in front of you is the scarcity mechanic working (invariant #11). Removing it instantly hides the evidence.

---

## 5. POSITION NUMBERS

The status artifact. Design it so an 18-year-old reads it once and immediately wants a lower one.

### 5.1 Treatment

JetBrains Mono, `--t-3xl`, `--primary` on `--c-ink`. No label, no "Position:" prefix, no `#` on the hero. Zero-padded to the drop's digit width — `047 of 200`, not `47`. Padding is what makes it read as a **ticket** rather than a count.

### 5.2 Where it lives

Catch confirmation (full-screen, split-flap arrival) · wallet card (32px inline) · public position board (ranked list) · profile (best positions held) · pre-catch on the drop page ("You'd be 048" — the hook).

### 5.3 Why it works & the user number

Low number = early = status, with zero explanation. The split-flap arrival makes the number feel **issued**, not calculated; it is screenshot-shaped on purpose. The permanent 14-digit **user number** (JetBrains Mono, `--text-secondary`, small, full-padded `00000000000047`) is a quiet flex — never hero-sized.

---

## 6. THE SPLIT-FLAP

App doctrine Claude Design does not cover — kept. The one place with real mechanical motion, in exactly three moments: **board arrival**, **catch confirmation** (the position number), and **Gone**. **Not on load, scroll, or hover.** A board that flips constantly is noise; a board that flips when something changed is information.

| Spec | Value |
|---|---|
| Flip unit | One character, 180ms, 40ms stagger left→right |
| Intermediate | 3–5 random characters before settling; `cubic-bezier(0.45,0.05,0.15,1)` |
| Numerals | JetBrains Mono |
| Reduced motion | Instant set, no intermediates |

Inside the status **Badge**, the flap flattens to mono text within the pill (the Badge look), while still flipping on arrival/Gone.

---

## 7. FORMS AND THE CODE KEYPAD

### 7.1 Fields — Claude Input

```css
input, textarea, select {
  background: var(--surface); border: 1px solid var(--c-border);
  border-radius: var(--r-field); padding: 12px; min-height: var(--control-md); /* 44 */
  font: 400 var(--t-base) var(--font-ui);
}
input:focus { border-color: var(--c-focus); box-shadow: var(--focus-ring); outline: none; }  /* blue ring */
```

Labels sit **above** the field, **mono-uppercase** (`--font-data`, tracked, `--text-secondary`) — no floating labels. Errors sit below in `--danger`, stating what to fix.

### 7.2 The redemption keypad

Tapping **Redeem** opens a bottom sheet. Four separate character tiles, JetBrains Mono `--t-2xl`, on `--c-ink`. Auto-advance on entry, auto-submit on the fourth character; uppercase-only (lowercase transformed); characters outside the 24-symbol alphabet rejected at the keystroke. Each filled tile does a single flap-flip. The sheet sits above the mobile keyboard.

**The operator never enters a code** (invariant #8). The buyer types it into their own device; there is no merchant-side redemption and **no QR scan** (§13).

---

## 8. BUTTONS

Claude Button: 44 tall, radius 8, Inter 700 15px, sentence case. Hover lifts −2px and darkens one step (primary gains the hot glow); press `scale(.96)`.

```css
.btn-catch { background: var(--primary); color: var(--text-on-color); min-height: var(--control-md); }
.btn-catch:hover { background: var(--primary-hover); transform: translateY(-2px); box-shadow: var(--sh-hot); }
.btn-catch:active { transform: scale(0.96); box-shadow: none; }
.btn-secondary { background: var(--surface); color: var(--text-primary); border: 1px solid var(--border-strong); }
.btn-board { background: var(--c-ink); color: var(--text-on-color); }  /* over colour / on the board */
```

Buttons say exactly what happens — **Catch**, **Redeem**, **Send**, **Share**. Never Submit, Continue, Claim, or Learn More. Never an arrow glyph. One primary action per view.

---

## 9. OPERATOR PORTAL

Same tokens, different density — operators are working, not browsing. Desktop-first, data-dense, tables over cards. Scoreboard fixed top-right (`--c-ink` panel, JetBrains Mono numerals, `--primary` on the number that matters this cycle). Today's Code renders at `--t-3xl` JetBrains Mono on `--c-ink`, readable across a counter, with phonetic guidance beneath. Add Location is visible at every tier; the paywall fires on click and never hides the control.

---

## 10. RESPONSIVE

```css
--bp-sm: 480px; --bp-md: 768px; --bp-lg: 1024px; --bp-xl: 1440px;
```

Layout reference: the Claude mobile & web UI kits.

| Surface | Mobile (< 768) | Desktop (≥ 768) |
|---|---|---|
| Chrome | Slim glass top bar (brand + active market) **+ fixed glass bottom tab bar** carrying the five sections | One glass top nav: brand · tabs · active market |
| Board | 1 column | `repeat(auto-fill, minmax(260px, 1fr))`, max-width 1200 |
| Card | Identical composition, smaller | Identical composition, larger |
| Flip / motion photo | Long-press / focused card only | Hover |
| Operator | Functional, cramped | Primary target |

The bottom tab bar moves the five sections (Board · Called It · Redeem · Gone · You) off the top row at phone width; **every destination stays reachable** — the layout moves, no control is dropped. Chrome is the only place glass is used.

---

## 11. PERFORMANCE BUDGET

Mobile is the product. Limits, not goals.

| Metric | Budget |
|---|---|
| LCP (board, 4G) | < 2.0s |
| Initial JS | < 180KB gzipped |
| Fonts | Inter + Newsreader + JetBrains Mono via `next/font`, latin subset, `display: swap`, self-hosted (CSP `font-src 'self'`). **Measured (`npm run build`):** ~142 KB preloaded over the wire — the primary latin slice per family (Inter 47 KB + Newsreader 56 KB + JetBrains Mono 39 KB). On disk the three families total ~402 KB across all subset slices (Inter 213 / Newsreader 103 / JetBrains 84), but `unicode-range` fetches only the slices the text actually renders. |
| Cinemagraph | 400KB each, lazy, one playing at a time |
| Board query | < 200ms p95 · CLS < 0.05 |

Cards reserve their full dimensions before content loads — a board that reflows while inventory falls is unusable.

---

## 12. ACCESSIBILITY

- Contrast: `--text-primary` on `--background` ≈ 16:1; `--text-on-color` on `--c-ink` ≈ 15:1. **`--primary` on white fails at body size** — permitted only at ≥18px bold or as a fill behind white text.
- Visible focus ring on every interactive element: `--focus-ring` (3px blue `rgba(41,121,189,.35)`).
- `prefers-reduced-motion` disables every flip and the board entrance; state still registers instantly.
- Touch targets ≥ 44px (`--control-md`).
- Live inventory announced via `aria-live="polite"`, throttled ~5s. Position number carries `aria-label` "Position 47 of 200". The brand logo carries the accessible name "The Drop".
- Colour never carries meaning alone — Gone has a stamp, not just a hue.

---

## 13. WHAT THIS SYSTEM IS NOT

Rejected deliberately. **Do not reintroduce**, including from a future re-import of the Claude Design source, whose marketing patterns lose to CLAUDE.md.

### 13.1 Standing rejections

| Not | Why |
|---|---|
| Percentage progress bars | Scarcity is discrete. Pips, always. |
| Gradients (beyond one soft radial highlight) | Colour arrives in blocks. |
| Fade-and-slide-up section entrances everywhere | The generic AI tell. Motion only on real state change; the one blessed entrance is the board `drop-in`. |
| All-caps tracked *eyebrow* labels as ornament | Uppercase mono is for labels/status/codes, not decoration (§2.4). |
| Arrows on buttons | §8. |
| Urgency copy | Scarcity does the work. CLAUDE.md voice. |
| Dark mode | The card is the dark object; the page is the hall. |

### 13.2 Not ported from Claude Design — and the invariant each conflicts with

The design source ships these; The Drop leaves them behind. This is the reasoning a future session needs to avoid re-importing them.

| Not ported | Conflicts with | Why |
|---|---|---|
| **`ScarcityBar`** continuous meter | Non-override #1 / discrete-scarcity invariant | Twelve remaining is twelve things. Its *visual polish* was taken; its continuity was not (§4.5). |
| **Drop-Blue selling hero** with next-drop countdown | CLAUDE.md voice ("copy that explains why a drop matters has already failed") | A hero sells; the board states facts. |
| **Countdown / `Countdown` timer**, red-pulse "urgent" | CLAUDE.md voice (no urgency, no "!") + the scarcity model | Scarcity here is units and position, not a clock. Redemption *windows* show as plain natural text, never a ticking timer. |
| **"Live / Upcoming" segmented control** | Scope / the state model | A drop is Live or Gone. "Upcoming" is a browse state the product does not have. |
| **"Claim" verb**, `DealCard` naming | Lexicon (invariant / CLAUDE.md) | Catch, not claim. Drop, not deal. The lexicon is the product. |
| **"!" for success** ("Claimed!") | Voice (no exclamation points) | The board does not raise its voice. |
| **Redeem-sheet QR code / scan** | Invariant #8 + the redemption model | The buyer types the code on their own device; there is no operator scan. |

The port took Claude Design's **layout mechanics** — glass chrome, the grid, spacing, radii, soft elevation, motion, the primitive components (Button, Input, Badge, Chip, Switch, SegmentedControl, FlipCard) — and left its **selling content patterns** behind.

---

## 14. TOKEN FILE

Ship as `app/styles/tokens.css`, imported once at root, with the Claude palette as source of truth and the legacy component names re-pointed as aliases. **No component may hardcode a hex value** — a hardcoded colour in a PR is a review rejection. The nine `--g-*` category grounds (§15.3) live here too; they are not part of the Claude palette and are preserved.

---

---

## 15. TILE GRAMMAR

Merchants do not supply photography and do not write prompts. The system generates tile imagery from the drop record and a category template. This section is what keeps 600 merchants' worth of content looking like one product. Treat it with the same standing as the colour tokens.

### 15.1 Two tile types

| Type | Purpose | Composition |
|---|---|---|
| **Drop tile** | The merchant's actual offer, on the drop card | **One subject.** Weighted to one third, negative space held opposite for the coupon print. |
| **Category tile** | Browse furniture — group chips and leaf filters | **Dense flat-lay.** Six to eight items in a loose grid, filling the frame edge to edge. |

A category tile shows range. A drop tile shows one thing. Never blend them.

### 15.2 Fixed grammar — every tile, both types

- 16:9
- **Shot straight down from directly above** (flat-lay) or **straight on** (result). Never a dramatic angle.
- **Flat solid colour ground**, edge to edge — no texture, gradient, shading, vignette, wall or surface detail. The ground is a **deep, saturated, full-strength rendering of the group's colour (§15.3)**, never pale, washed-out, greyed, or tinted lighter. The rendered ground **is** the colour the buyer sees; the CSS token only appears as label backing (§15.2.2). If the photo ground drifts lighter than its token, the wayfinding is coded to a colour not on screen.
- Bright even studio light, soft contact shadow only — no dramatic or raking light.
- **The lower third is a reserved quiet zone.** The label sits on it.
- No text, logos, faces, or hands. No props, styling, or clutter. Ground visible between items.
- Cheerful, punchy, contemporary.

The flat ground does the work: it makes unrelated subjects read as siblings, survives being shrunk to 200px, and is the one variable the platform fully controls.

> **Known limit of the saturation anchor (measured, 2026-09-18, Ideogram 4.0, 24-tile pass — against the *original* ground hexes).** The "deep, saturated" wording fixes the muted tokens that washed out to grey but **overshoots bright/warm tokens**. Steel `#2E5A78` went Δ82→Δ21/25 and teal `#1E7A6F` to Δ15/18 (the muddy blur-test neighbours — now true). Overshoots: the original orange `#F25C05` rendered dark/burnt (Δ60–75); moss uneven; two of five bone tiles warmed toward tan. Net: 15 of 24 within Δ30, no two adjacent grounds collide. A words-only saturation push is the wrong tool for an already-saturated or light token. The real acceptance test is **tiles in the board at mobile size with labels on them**, not the measurement.
>
> **Port update:** `--g-orange` is now unified to the primary **`#FF6600`** (§15.3); the two orange-ground group tiles (Food & Drink, Grocery & Specialty Food) were regenerated against it. If the orange overshoot is revisited, start from a fresh measurement against `#FF6600`, not the numbers above.

### 15.2.1 Navigation hierarchy — DOCTRINE

A category tile is **navigation furniture**, not a photograph. Three jobs, strict priority:

| Rank | Element | Job |
|---|---|---|
| 1 | **Ground colour** | Recognition. Orange means food before anything is read. |
| 2 | **CSS label** | Navigation. Says exactly where this goes. |
| 3 | **Photography** | Appeal only. Carries **zero** navigational load. |

**Photography must never make it harder to tell where to tap.** **The blur test:** blur a tile until the items are unreadable; if you can still tell food from auto from retail, it passes — if not, the ground colour is wrong, not the photograph. At mobile a chip is ~160×90; nothing inside the image is expected to be legible. **The label strip carries the exact `--g-*` token; the photo ground may drift a shade — and that is fine**, because the token-accurate strip, not the photo, is the wayfinding surface.

### 15.2.2 Labels are CSS, never generated

The category name is a **real DOM element overlaid on the tile**, never generated into the image. Generated text at 200px is illegible and misspells; a renamed category would mean regenerating a $0.06 asset; and generated type cannot be translated, selected, or read by a screen reader. The tile is the ground; the label sits on it.

### 15.2.3 Four tile styles

Set per leaf as `tile_style` on the taxonomy row, assigned deliberately, never inferred.

| Style | Use | Composition |
|---|---|---|
| `flatlay` | Products — food, retail, goods | Six to eight items, loose grid, edge to edge |
| `result` | Services — the finished state, not the tools | The outcome, straight on. **Never the equipment.** |
| `transformation` | Services where the change is the product | Before/after in one frame, hard edge between |
| `result-from-behind` | Personal services — result on a person, faces forbidden | Shot from behind or cropped so no face appears. **No eyes, never a face.** |

Roughly 200 of the 454 leaves are services. A flat-lay of tools says nothing about what the customer is buying; `result` and `transformation` show the gleaming window, and `result-from-behind` shows the fresh fade without breaking the no-faces rule.

### 15.3 Ground colors — 24 groups, 9 grounds

Colours belong to the **group**. Every leaf inherits its parent's ground unchanged. Per-leaf tints are forbidden — 454 shades reads as overdone and destroys colour as wayfinding.

```css
--g-orange: #FF6600;   --g-amber: #F5B428;   --g-oxide: #C0271A;   /* orange unified to the primary */
--g-steel:  #2E5A78;   --g-teal:  #1E7A6F;   --g-moss:  #5E7444;
--g-blush:  #E4826E;   --g-mint:  #58B89C;   --g-bone:  #EDE6D8;
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

Ground colour is stored on the `tags` group row (and mirrored in `taxonomy/group-tiles.json` as `ground_hex`), not hardcoded in a prompt template. Only `--g-orange` changed in the port (`#F25C05 → #FF6600`); the other eight are unchanged.

### 15.4 Prompt assembly

Assembled server-side from three parts — the merchant contributes only the subject, in plain words, never a prompt:

```
[type clause]   → drop tile: one subject, weighted third, empty opposite
                  category tile: dense grid, six to eight items, edge to edge
[subject]       → from the drop record, or the leaf's item list for a category tile
[ground]        → the group's ground colour
[fixed grammar] → §15.2, appended verbatim, never edited per request
```

**Coupon legibility — the negative space is a contract.** The drop tile's empty two-thirds carry the coupon print (§4.3), so that side must generate as clean flat ground: no subject bleed, no stray object, no cast shadow. The print is ink or white per ground and **never sits on a scrim**. A tile whose calm side is not clean **fails and is regenerated**; the fix is a better generation, never a treatment layered on a bad one.

### 15.5 Subject weighting

Drop tiles alternate left- and right-weighted by drop ID, with the type block flipping to match. The board needs variation inside the grammar, not outside it.

### 15.6 Model and cost

**Ideogram 4.0** (`ideogram:4@0`), ~$0.06 per tile at 2560×1440.

| Asset | Volume | Cost |
|---|---|---|
| Category tiles — 24 groups + 454 leaves | 478, **one time** | ~$29 |
| Drop tiles | Recurring, per drop | $0.06 each |

Category tiles are generated once and stored; only drop tiles recur, so **cap generations per drop**. Photo-realistic models cost ~20× less and are viable for drop tiles where no graphic treatment is needed — evaluate per category, never mix models within a category.

### 15.7 Explicitly rejected

| Rejected | Why |
|---|---|
| Dramatic raking light, deep shadow, cinematic falloff | Fights the near-white hall. |
| Generated type of any kind inside a tile | Illegible at 200px, misspells, cannot be renamed/translated/read aloud. Labels are CSS. |
| Per-leaf colour tints | 454 shades destroys colour as wayfinding. |
| Merchant-written prompts | The grammar is the product; merchant prompts turn the board into a classifieds page. |
| Photographs of service equipment | A squeegee is not what the customer is buying. Show the clean window. |
| Photography that competes with navigation | A tile that is rich and navigationally ambiguous has failed (§15.2.1). |
| Generated imagery on Maker Drop (Phase 2) | A generated image of a physical object bought sight unseen is a returns/chargeback magnet. Local only. |

---

*The board is the object. The page is the hall. Scarcity is discrete, the lexicon is fixed, and the serif speaks only where there is something to read.*
