"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { Pips } from "@/components/drops/Pips";
import { LogoBubble } from "@/components/LogoBubble";

interface ProfileCard {
  id: string; title: string; quantity_total: number; quantity_remaining: number;
  pct_remaining: number; status: string; redeem_until: string | null; gone_at: string | null;
}
interface OrgProfile {
  org_id: string; name: string; logo_url: string | null; ground_slug: string; lane: string; redemption_rate: number | null;
  locations: { name: string; city: string; region: string }[];
  live: ProfileCard[]; gone: ProfileCard[];
}

/**
 * Public business profile (PRD §11, invariant #11). A merchant's Gone drops stay
 * permanently reachable here — shadowed and stamped, but clickable through to the
 * drop, unlike their 5-minute window on the board.
 */
function ProfileCardTile({ c }: { c: ProfileCard }) {
  const gone = c.status === "gone" || c.status === "expired";
  const pct = Math.round(c.pct_remaining * 100);
  return (
    <Link href={`/drops/${c.id}`} className={`profile-card${gone ? " profile-card-gone" : ""}`}>
      <p className="coupon profile-card-title">{c.title}</p>
      <div className="card-scarcity">
        <Pips remaining={c.quantity_remaining} total={c.quantity_total} />
        <span className="card-count data">{gone ? "Gone" : `${c.quantity_remaining} left · ${pct}%`}</span>
      </div>
    </Link>
  );
}

export default function MerchantProfilePage() {
  const id = useParams<{ id: string }>().id;
  const [p, setP] = useState<OrgProfile | null | "missing">(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<OrgProfile>(`/v1/orgs/${id}/profile`);
      if (!alive) return;
      setP(r.ok && r.data ? r.data : "missing");
    })();
    return () => { alive = false; };
  }, [id]);

  if (p === null) return <div className="page muted">Loading.</div>;
  if (p === "missing") return <div className="page muted">No such business.</div>;

  return (
    <div className="page stack profile">
      <div className="profile-head">
        <LogoBubble name={p.name} logoUrl={p.logo_url} groundSlug={p.ground_slug} size="lg" />
        <div>
          <h1 className="profile-name">{p.name}</h1>
          {p.locations[0] && <p className="muted">{p.locations.map((l) => `${l.name}, ${l.city}`).join(" · ")}</p>}
          {p.redemption_rate !== null && <p className="muted">{Math.round(p.redemption_rate * 100)}% redeemed</p>}
        </div>
      </div>

      {p.live.length > 0 && (
        <div className="stack">
          <h2 className="board-lane-label">Live now</h2>
          <div className="profile-grid">{p.live.map((c) => <ProfileCardTile key={c.id} c={c} />)}</div>
        </div>
      )}

      <div className="stack">
        <h2 className="board-lane-label">Gone</h2>
        {p.gone.length === 0 ? <p className="board-empty">No past drops yet.</p> : (
          <div className="profile-grid">{p.gone.map((c) => <ProfileCardTile key={c.id} c={c} />)}</div>
        )}
      </div>
    </div>
  );
}
