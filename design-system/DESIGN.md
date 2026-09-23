---
version: "the-drop-2026-09-23"
name: "The Drop"
description: "Hyper-deal coupon app for web and mobile. Local deals drop in short windows with limited claims; users flip a teaser card to reveal and claim. Modern, tight, fast, fun."
colors:
  primary: "#FF6600"
  primary-hover: "#E55A00"
  primary-press: "#BF4B00"
  primary-soft: "#FFF3EB"
  secondary: "#005599"
  secondary-hover: "#004A85"
  secondary-press: "#003D6E"
  secondary-soft: "#EBF3FA"
  accent: "#FF6600"
  ink: "#121212"
  background: "#FDFDFD"
  background-subtle: "#F6F7F9"
  surface: "#FFFFFF"
  surface-muted: "#E5E7EB"
  surface-inverse: "#121212"
  text-primary: "#111827"
  text-secondary: "#4B5563"
  text-tertiary: "#6B7280"
  text-disabled: "#9CA3AF"
  text-on-color: "#FFFFFF"
  border: "#E5E7EB"
  border-strong: "#D1D5DB"
  focus: "#2979BD"
  success: "#14A44D"
  success-soft: "#E8F7EE"
  warning: "#FFC21A"
  warning-soft: "#FFF8E1"
  danger: "#E5243B"
  danger-soft: "#FDECEE"
  orange-scale: ["#FFF3EB","#FFE2CC","#FFC499","#FFA366","#FF8533","#FF6600","#E55A00","#BF4B00","#8F3800","#5C2400"]
  blue-scale: ["#EBF3FA","#CCE0F2","#99C2E5","#5C9ED4","#2979BD","#005599","#004A85","#003D6E","#002D52","#001C33"]
  neutral-scale: {"0":"#FDFDFD","50":"#F6F7F9","100":"#F0F1F4","200":"#E5E7EB","300":"#D1D5DB","400":"#9CA3AF","500":"#6B7280","600":"#4B5563","700":"#374151","800":"#1F2937","900":"#111827"}
typography:
  font-display: "Inter"
  font-ui: "Inter"
  font-body: "Newsreader"
  font-mono: "JetBrains Mono"
  display-xl: { family: "Inter", size: "72px", weight: 900, line-height: 0.95, tracking: "-0.045em" }
  display-lg: { family: "Inter", size: "48px", weight: 900, line-height: 1, tracking: "-0.04em" }
  display-md: { family: "Inter", size: "32px", weight: 800, line-height: 1.05, tracking: "-0.03em" }
  heading-lg: { family: "Inter", size: "24px", weight: 700, line-height: 1.15, tracking: "-0.02em" }
  heading-md: { family: "Inter", size: "18px", weight: 600, line-height: 1.25, tracking: "-0.01em" }
  body-lg: { family: "Newsreader", size: "19px", weight: 400, line-height: 1.5 }
  body-md: { family: "Newsreader", size: "16px", weight: 400, line-height: 1.5 }
  body-sm: { family: "Newsreader", size: "14px", weight: 400, line-height: 1.45 }
  ui-md: { family: "Inter", size: "15px", weight: 500, line-height: 1.3 }
  ui-sm: { family: "Inter", size: "13px", weight: 500, line-height: 1.3 }
  label-md: { family: "JetBrains Mono", size: "12px", weight: 700, line-height: 1.2, tracking: "0.08em", transform: "uppercase" }
  label-sm: { family: "JetBrains Mono", size: "10px", weight: 700, line-height: 1.2, tracking: "0.1em", transform: "uppercase" }
  timer: { family: "JetBrains Mono", size: "28px", weight: 800, tracking: "-0.02em", numeric: "tabular-nums" }
spacing:
  base: "8px"
  scale: ["0","4px","8px","12px","16px","20px","24px","32px","40px","48px","64px","80px"]
  gap: "16px"
  card-padding: "24px"
  section-padding: "80px"
  screen-gutter: "16px"
  control-height: { sm: "32px", md: "44px", lg: "56px" }
  content-max: "1200px"
rounded:
  xs: "4px"
  control: "8px"
  md: "12px"
  card: "16px"
  sheet: "24px"
  pill: "9999px"
elevation:
  xs: "0 1px 2px rgba(17,24,39,.06)"
  sm: "0 1px 3px rgba(17,24,39,.08), 0 1px 2px rgba(17,24,39,.04)"
  md: "0 6px 16px -4px rgba(17,24,39,.12), 0 2px 4px rgba(17,24,39,.05)"
  lg: "0 18px 40px -12px rgba(17,24,39,.22), 0 4px 8px rgba(17,24,39,.06)"
  hot: "0 10px 24px -8px rgba(255,102,0,.55)"
  brand: "0 10px 24px -8px rgba(0,85,153,.5)"
  sticker: "0 0 0 3px #FFFFFF, 0 0 0 6px #FF6600"
  focus-ring: "0 0 0 3px rgba(41,121,189,.35)"
motion:
  ease-out: "cubic-bezier(.2,.8,.2,1)"
  ease-spring: "cubic-bezier(.34,1.56,.64,1)"
  ease-in-out: "cubic-bezier(.65,0,.35,1)"
  duration: { fast: "120ms", base: "200ms", slow: "360ms", flip: "560ms" }
  press-scale: 0.96
  hover-lift: "-2px"
effects:
  glass-bg: "rgba(253,253,253,.78)"
  glass-blur: "16px"
  scrim: "rgba(18,18,18,.5) + blur(4px)"
components:
  button: { height: "44px", padding-x: "18px", radius: "8px", font: "Inter 700 15px", variants: ["primary","secondary","ink","outline","ghost"], sizes: ["sm","md","lg"] }
  icon-button: { size: "44px", radius: "pill", variants: ["primary","secondary","ink","outline","ghost","glass"] }
  badge: { height: "24px", padding-x: "10px", radius: "pill", font: "JetBrains Mono 700 11px uppercase", tones: ["live","brand","ink","neutral","hot","success","danger","glass"] }
  chip: { height: "36px", padding-x: "14px", radius: "pill", selected: "ink fill, white text" }
  input: { height: "44px", padding-x: "12px", radius: "8px", border: "1px #E5E7EB", focus: "border #2979BD + focus-ring", label: "label-md" }
  segmented-control: { padding: "4px", radius: "12px", track: "#F0F1F4", thumb: "white, radius 8px, shadow-sm, spring slide" }
  switch: { width: "44px", height: "26px", on: "#FF6600", off: "#D1D5DB" }
  checkbox: { size: "20px", radius: "6px", on: "#FF6600" }
  toast: { radius: "12px", padding: "12px 14px", background: "#121212", shadow: "lg", enter: "drop-in spring" }
  sheet: { radius: "24px 24px 0 0", padding: "12px 20px 24px", handle: "40x4 #D1D5DB", dialog-max-width: "400px" }
  tooltip: { background: "#121212", radius: "6px", font: "Inter 600 12px" }
  card: { radius: "16px", padding: "24px", background: "#FFFFFF", border: "1px #E5E7EB", shadow: "sm" }
  deal-card: { radius: "16px", padding: "20px", front: "solid blue | orange | ink + radial highlight", back: "white card", value: "Inter 900 88px -0.06em", flip: "rotateY 560ms spring" }
  countdown: { font: "JetBrains Mono 800 tabular", default-color: "#E55A00", urgent: "#E5243B + pulse under 60s", blocks: "ink tiles radius 8px" }
  scarcity-bar: { height: "6px", radius: "pill", fill: "#FF6600", critical: "#E5243B at <=15% left" }
  coupon-code: { radius: "12px", border: "2px dashed #FFA366", background: "#FFF3EB", font: "JetBrains Mono 800 18-26px +0.12em" }
---

# The Drop

## Overview
The Drop is a web and mobile app for hyper deals: local coupons released in short windows (minutes, not weeks) with a fixed number of claims. Scarcity drives urgency and high redemption. The signature interaction is the **flip-card reveal**: a colored teaser card (value, timer, claims left) rotates on hover (web) or tap (mobile) to reveal the full deal and a Claim button.

Sources: the brand logo (`assets/logo-the-drop.png`, orange outline #FF6600, blue script #005599, white keyline) and the "Sentinel – Better Business Decisions" style notes (neutrals, font roles, spacing, radii, motion cues). No production codebase or Figma file existed; components and screens are original.

## Colors
- **Drop Orange #FF6600** — primary action, live state, urgency. One orange CTA per view.
- **Drop Blue #005599** — brand surfaces (hero, sign-in, card fronts), secondary actions, links, focus.
- **Ink #121212** — third card tone, selected chips, toasts, countdown tiles.
- **Neutrals** — cool grays; app background #FDFDFD, borders #E5E7EB, text #111827 / #4B5563.
- **Red #E5243B** — critical scarcity only (≤15% left, under 60 seconds).
- Light mode only. Color arrives in bold solid blocks, not tints everywhere.

## Typography
- **Inter** 900 with tight negative tracking for display and deal values; 600–800 for UI.
- **Newsreader** for body copy: deal descriptions, fine print, empty states.
- **JetBrains Mono** 700–800, tabular, for timers, coupon codes and UPPERCASE labels.
- Fonts load from Google Fonts (no licensed binaries provided).

## Layout
- 8px base grid. Screen gutter 16, gap 16, card padding 20–24, web section padding 80.
- Mobile: 390pt frame, sticky glass tab bar (Drops / Wallet / Alerts), scrolling content.
- Web: sticky glass top nav, max-width 1200, auto-fill grid with 260px minimum tracks.
- Don't flatten into generic SaaS card grids; the flip card is the focal object.

## Elevation & depth
- Neutral shadows xs–lg for resting elevation.
- Colored glows (`hot`, `brand`) appear on primary/secondary buttons on hover only.
- **Sticker keyline** (color → white → orange ring) echoes the logo; use for hero badges only.
- Glass (78% white + 16px blur) only on floating chrome: nav, tab bar. Scrims are ink 50% + 4px blur.

## Shapes
Control 8, md 12 (segmented, toasts, coupon box), card 16, sheet/hero 24, pill for chips, badges and icon buttons. Buttons, cards and badges share one border language: 1px #E5E7EB or none on solid color. No left-border accent cards.

## Motion
- Hover/color: 120–200ms `ease-out`.
- Toggles, sheets, toasts, segmented thumb: 360ms `ease-spring` (slight overshoot).
- Flip reveal: 560ms spring `rotateY(180deg)`, `backface-visibility: hidden`.
- Hover: buttons lift −2px and darken one step. Press: scale .96 (buttons), .9 (icon buttons).
- Live dots pulse continuously; countdowns pulse red in the last 60 seconds. Entrances rise 8px + fade, 40ms stagger.
- Keyframes: `drop-pulse`, `drop-in`, `drop-spin`, `drop-shake`.

## Components
Namespace in bundle: `window.TheDropDesignSystem_77d79c`.

**core/**
- `Icon` — Lucide glyph via CSS mask, inherits currentColor.
- `Button` — primary / secondary / ink / outline / ghost; sm 32 / md 44 / lg 56; icon, iconRight, loading, disabled, fullWidth.
- `IconButton` — round icon-only; glass variant for use over color; count badge; active state.
- `Badge` — mono uppercase pill; live pulse dot; sticker keyline option.
- `Chip` — category filter pill; selected = ink fill; optional orange count.

**forms/**
- `Input` — mono label, leading icon, hint/error, blue focus ring.
- `Checkbox` — 20px orange box with spring check.
- `Switch` — 44×26 orange toggle, spring thumb.
- `SegmentedControl` — tab control with sliding white thumb (Live / Upcoming).

**feedback/**
- `Toast` — ink pill with icon, title, message, action; springs in.
- `Sheet` — bottom sheet (mobile) or centered dialog; `contained` for phone frames.
- `Tooltip` — ink hover label for icon-only controls.

**deals/**
- `FlipCard` — 3D flip container; trigger hover / click / controlled.
- `DealCard` — the drop coupon. Front: solid tone, LIVE badge, timer, huge value, merchant, scarcity bar, reveal hint. Back: white card, title, Newsreader description, scarcity bar, Claim button.
- `Countdown` — ticking mono timer, inline or block tiles; red + pulse when urgent; "ENDED" at zero.
- `ScarcityBar` — "38 left" meter; red at ≤15% remaining.
- `CouponCode` — dashed tear-off box with tap-to-copy.

## Screens (UI kits)
- **Mobile** (`ui_kits/mobile/`): Sign in (phone + OTP on Drop Blue) → Drops feed (segmented Live/Upcoming, category chips, Next Drop strip, tap-to-flip DealCards) → Claim toast → Wallet (ticket stubs, redeem sheet with QR + code) → Alerts (switches, range, categories).
- **Web** (`ui_kits/web/`): glass top nav → Drop Blue hero with next-drop countdown → Live now grid of hover-to-flip DealCards with chips and sort → toast + wallet dialog.

## Content & voice
- Fast, confident, a little cheeky. Address the user as "you".
- Sentence case for headings and buttons ("Claim drop"). UPPERCASE mono only for labels and status ("LIVE", "38 LEFT").
- Lead with numbers: value ("70% off", "$1 latte"), clock ("08:42"), count ("38 left").
- Vocabulary: drop, claim, wallet, window, reveal. One "!" max, for success ("Claimed!").
- No emoji. "·" separates metadata ("Food · 0.4 mi").

## Iconography
Lucide, 2px stroke, round caps (CDN substitute; no set provided). Sizes 15–16 inline, 18–20 buttons, 22 tab bar, 32–48 empty states. Key glyphs: zap, timer, flame, ticket, wallet, bell, map-pin, rotate-3d, qr-code, copy, check.

## File layout
```
styles.css            @import list only
tokens/               colors, typography, spacing, effects, fonts, base
assets/               logo-the-drop.png (transparent), logo-the-drop-original.png
guidelines/           foundation specimen cards
components/core|forms|feedback|deals/   <Name>.jsx + .d.ts + .prompt.md + card
ui_kits/mobile/, ui_kits/web/           click-through screens
readme.md, SKILL.md, DESIGN.md
```

## Guardrails
- One orange primary action per view.
- Keep the flip card as the focal object; don't reduce drops to flat list rows on the feed.
- Red is for critical scarcity only, never decoration.
- No aggressive gradients: only a single soft radial highlight on color blocks.
- Don't swap to dark mode; the system is light-first.
