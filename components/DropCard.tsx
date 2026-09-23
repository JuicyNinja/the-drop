"use client";

import Link from "next/link";
import { useState } from "react";
import { Pips } from "./Pips";
import { LogoBubble } from "./LogoBubble";
import { GoneStamp } from "./GoneStamp";
import { SplitFlap } from "./SplitFlap";
import { FollowButton } from "@/app/(ui)/(buyer)/_lib/FollowButton";
import { tileWeight, couponSide } from "@/lib/tile-weight";

export interface BoardCard {
  id: string;
  lane: string;
  title: string;
  image_url: string | null;
  quantity_total: number;
  quantity_remaining: number;
  pct_remaining: number;
  price_cents: number | null;
  live_until: string | null;
  redeem_until: string | null;
  redeem_window: string;
  status: string;
  ground_dark: boolean;
  ground_slug: string;
  merchant: { org_id: string; name: string; logo_url: string | null; redemption_rate: number | null };
}

/**
 * The Drop Card (DESIGN-SYSTEM §4). Identical composition at every size. The
 * front sells (coupon print, poster, pips); the back informs (hover flip, clean
 * Satoshi face). Gone drops desaturate, take the stamp, drop to the flat shadow,
 * and become unclickable — but stay on the board for 5 minutes.
 */
export function DropCard({ card, freshArrival = false }: { card: BoardCard; freshArrival?: boolean }) {
  const gone = card.status === "gone" || card.status === "expired";
  const pct = Math.round(card.pct_remaining * 100);
  const [flipped, setFlipped] = useState(false);

  // Split-flap runs in exactly three moments; on the board that is arrival (a
  // genuinely new live drop) and Gone. Never on load/scroll/hover.
  const chipRun = gone ? 2 : freshArrival ? 1 : 0;

  const inner = (
    <article
      className={`card${gone ? " card-gone" : ""}${flipped ? " card-flipped" : ""}`}
      onMouseEnter={() => !gone && setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
    >
      <div className="card-inner">
        {/* FRONT */}
        <div className="card-face card-front">
          <span className={`chip${gone ? " chip-gone" : ""}`}>
            <SplitFlap value={gone ? "GONE" : "LIVE"} run={chipRun} className="chip-flap" ariaLabel={gone ? "Gone" : "Live"} />
          </span>

          {/* The drop tile fills the card; the subject is weighted to one third
              (§15.5) and the coupon print overlays the clean opposite side (§4.1),
              ink or white per ground, never on a scrim (§4.3). */}
          <div className={`card-tile card-subj-${tileWeight(card.id)}`}>
            {card.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- static local tile asset, no loader needed
              <img className="card-tile-img" src={card.image_url} alt="" loading="lazy" decoding="async" />
            ) : (
              <div className="card-poster" aria-hidden>
                <span className="card-poster-mark data">{card.merchant.name.slice(0, 2).toUpperCase()}</span>
              </div>
            )}
            <p className={`coupon card-offer card-offer-${couponSide(card.id)} ${card.ground_dark ? "coupon-on-dark" : "coupon-on-light"}`}>{card.title}</p>
          </div>

          <div className="card-scarcity">
            <Pips remaining={card.quantity_remaining} total={card.quantity_total} />
            <span className="card-count data">
              {card.quantity_remaining} left · {pct}%
            </span>
          </div>

          <div className="card-meta">
            <div className="card-merchant-row">
              <LogoBubble name={card.merchant.name} logoUrl={card.merchant.logo_url} groundSlug={card.ground_slug} size="sm" />
              <span className="card-merchant">{card.merchant.name}</span>
            </div>
            {card.merchant.redemption_rate !== null && (
              <span className="card-score">
                <span className="score-bar" aria-hidden>
                  <span className={`score-fill wq-${Math.round((card.merchant.redemption_rate ?? 0) * 20) * 5}`} />
                </span>
                <span className="score-label">{Math.round((card.merchant.redemption_rate ?? 0) * 100)}% redeemed</span>
              </span>
            )}
          </div>

          {gone && <GoneStamp />}
        </div>

        {/* BACK — the honest side (§4.6): merchant, terms, window, in Satoshi. */}
        <div className="card-face card-back" aria-hidden={!flipped}>
          <div className="card-back-head">
            <LogoBubble name={card.merchant.name} logoUrl={card.merchant.logo_url} groundSlug={card.ground_slug} size="lg" />
            <span className="card-back-merchant">{card.merchant.name}</span>
          </div>
          <p className="card-back-title">{card.title}</p>
          <dl className="card-back-list">
            <div>
              <dt>Remaining</dt>
              <dd className="data">{card.quantity_remaining} of {card.quantity_total}</dd>
            </div>
            {card.redeem_window && (
              <div>
                <dt>Window</dt>
                <dd>{card.redeem_window}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </article>
  );

  if (gone) return <div className="card-wrap card-wrap-gone">{inner}</div>;
  return (
    <div className="card-wrap-outer">
      <Link href={`/drops/${card.id}`} className="card-wrap">
        {inner}
      </Link>
      {/* Follow the merchant from the board, without disturbing the fixed card
          composition (§4) — the pill sits beneath the card. */}
      <div className="card-follow">
        <FollowButton orgId={card.merchant.org_id} variant="compact" />
      </div>
    </div>
  );
}
