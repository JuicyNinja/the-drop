"use client";

import Link from "next/link";
import { useState } from "react";
import { Pips } from "./Pips";
import { LogoBubble } from "./LogoBubble";
import { GoneStamp } from "./GoneStamp";
import { SplitFlap } from "./SplitFlap";

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
  status: string;
  merchant: { org_id: string; name: string; redemption_rate: number | null };
}

function timing(redeemUntil: string | null): string {
  if (!redeemUntil) return "";
  const d = new Date(redeemUntil);
  return `Redeem by ${d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
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
          <LogoBubble name={card.merchant.name} />
          <span className={`chip${gone ? " chip-gone" : ""}`}>
            <SplitFlap value={gone ? "GONE" : "LIVE"} run={chipRun} className="chip-flap" ariaLabel={gone ? "Gone" : "Live"} />
          </span>

          <p className="coupon card-offer">{card.title}</p>

          <div className="card-poster" aria-hidden>
            <span className="card-poster-mark data">{card.merchant.name.slice(0, 2).toUpperCase()}</span>
          </div>

          <div className="card-scarcity">
            <Pips remaining={card.quantity_remaining} total={card.quantity_total} />
            <span className="card-count data">
              {card.quantity_remaining} left · {pct}%
            </span>
          </div>

          <div className="card-meta">
            <span className="card-merchant">{card.merchant.name}</span>
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

        {/* BACK — the honest side (§4.6): terms, timing, merchant, in Satoshi. */}
        <div className="card-face card-back" aria-hidden={!flipped}>
          <p className="card-back-title">{card.title}</p>
          <dl className="card-back-list">
            <div>
              <dt>Merchant</dt>
              <dd>{card.merchant.name}</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd className="data">{card.quantity_remaining} of {card.quantity_total}</dd>
            </div>
            {card.redeem_until && (
              <div>
                <dt>Window</dt>
                <dd>{timing(card.redeem_until)}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </article>
  );

  if (gone) return <div className="card-wrap card-wrap-gone">{inner}</div>;
  return (
    <Link href={`/drops/${card.id}`} className="card-wrap">
      {inner}
    </Link>
  );
}
