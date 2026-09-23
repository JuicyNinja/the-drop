"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, getSession } from "@/app/(ui)/_lib/api";
import { Pips } from "@/components/Pips";
import { LogoBubble } from "@/components/LogoBubble";
import { SplitFlap } from "@/components/SplitFlap";
import { GoneStamp } from "@/components/GoneStamp";
import { FollowButton } from "@/app/(ui)/(buyer)/_lib/FollowButton";

interface PublicDrop {
  id: string; lane: string; title: string; description: string; terms: string | null;
  image_urls: string[]; quantity_remaining: number; quantity_total: number; pct_remaining: number;
  price_cents: number | null; live_until: string | null; redeem_from: string | null; redeem_until: string | null;
  redeem_window: string;
  status: string;
  ground_slug: string;
  merchant: { org_id: string; name: string; logo_url: string | null; redemption_rate: number | null; location: { name: string; city: string; lat: number; lng: number } | null };
  can_catch: boolean; catch_blocked_reason: string | null;
}
interface CatchResult { catch_id: string; position_number: number; code: string }

const REASON: Record<string, string> = {
  UNAUTHENTICATED: "Sign in to catch.",
  PHONE_UNVERIFIED: "Verify your phone in You to catch.",
  LOCATION_PERMISSION_REQUIRED: "Turn on location to catch.",
  ALREADY_CAUGHT: "You already caught this one.",
  DROP_NOT_LIVE: "This drop isn't live.",
  ACCOUNT_SUSPENDED: "Your account can't catch right now.",
};

function pad(n: number, total: number): string {
  return String(n).padStart(String(total).length, "0");
}

export default function DropPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [drop, setDrop] = useState<PublicDrop | null>(null);
  const [caught, setCaught] = useState<CatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // api() attaches the session token when the viewer is signed in (refining
  // can_catch server-side) and behaves as a public call when not — the detail
  // page stays the shared-link surface while telling a signed-in viewer the truth.
  const load = async () => {
    const r = await api<PublicDrop>(`/v1/drops/${id}`);
    if (r.ok && r.data) setDrop(r.data);
  };
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<PublicDrop>(`/v1/drops/${id}`);
      if (alive && r.ok && r.data) setDrop(r.data);
    })();
    return () => { alive = false; };
  }, [id]);

  // Share attribution: a signed-in viewer who arrived through a share link
  // (/s/{token} redirects here with ?ref={token}) confirms the return so the
  // SHARER earns clout — the sole clout path for a share (API-CONTRACT §9). The
  // server owns every guard (no self-attribution, once-only, concurrency-safe),
  // so this is fire-and-forget; a repeat or self return simply no-ops.
  useEffect(() => {
    if (!getSession()) return;
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) return;
    void api(`/v1/shares/${encodeURIComponent(ref)}/verify`, { method: "POST" });
  }, [id]);

  if (!drop) return <div className="page muted">Loading.</div>;

  const gone = drop.status === "gone" || drop.status === "expired";
  const pct = Math.round(drop.pct_remaining * 100);
  const wouldBe = drop.quantity_total - drop.quantity_remaining + 1;
  const signedIn = Boolean(getSession());

  async function onCatch() {
    setBusy(true); setNote(null);
    const idem = (crypto as Crypto).randomUUID();
    const r = await api<CatchResult>("/v1/catches", { method: "POST", body: { drop_id: id }, idem });
    setBusy(false);
    if (r.ok && r.data) { setCaught(r.data); return; }
    setNote(r.error?.code === "DROP_GONE" ? "Gone." : (r.error?.message ?? "Could not catch."));
    load();
  }

  async function onShare() {
    const r = await api<{ url: string }>("/v1/shares", { method: "POST", body: { drop_id: id } });
    if (r.ok && r.data) {
      try { await navigator.clipboard.writeText(r.data.url); setNote("Link copied."); }
      catch { setNote(r.data.url); }
    }
  }

  // Catch confirmation (§5.2, §6.1): full-screen position number, split-flap arrival.
  if (caught) {
    return (
      <div className="confirm">
        <p className="confirm-caught display">Caught.</p>
        <div className="position-hero" role="img" aria-label={`Position ${caught.position_number} of ${drop.quantity_total}`}>
          <SplitFlap value={pad(caught.position_number, drop.quantity_total)} charset="digits" run={1} className="position-flap" />
          <span className="position-of">of {drop.quantity_total}</span>
        </div>
        <p className="confirm-code muted">Your code is <span className="data">{caught.code}</span></p>
        <a className="btn-secondary" href="/wallet">Called It</a>
      </div>
    );
  }

  return (
    <div className="page detail">
      <div className="detail-card">
        <span className={`chip${gone ? " chip-gone" : ""}`}>
          <SplitFlap value={gone ? "GONE" : "LIVE"} run={0} ariaLabel={gone ? "Gone" : "Live"} />
        </span>
        <h1 className="coupon detail-offer">{drop.title}</h1>
        <div className="card-poster" aria-hidden><span className="card-poster-mark data">{drop.merchant.name.slice(0, 2).toUpperCase()}</span></div>
        <div className="card-scarcity">
          <Pips remaining={drop.quantity_remaining} total={drop.quantity_total} />
          <span className="card-count data">{drop.quantity_remaining} left · {pct}%</span>
        </div>
        {gone && <GoneStamp />}
      </div>

      <div className="detail-body stack">
        <p className="body">{drop.description}</p>
        {drop.terms && <p className="muted">{drop.terms}</p>}
        <div className="detail-merchant">
          <LogoBubble name={drop.merchant.name} logoUrl={drop.merchant.logo_url} groundSlug={drop.ground_slug} size="lg" />
          <Link href={`/merchants/${drop.merchant.org_id}`} className="inline-link detail-merchant-name">{drop.merchant.name}</Link>
        </div>
        <dl className="detail-facts">
          {drop.merchant.location && <div><dt>Where</dt><dd>{drop.merchant.location.name}, {drop.merchant.location.city}</dd></div>}
          {drop.redeem_window && <div><dt>Window</dt><dd>{drop.redeem_window}</dd></div>}
          {drop.merchant.redemption_rate !== null && <div><dt>Redeemed</dt><dd className="data">{Math.round((drop.merchant.redemption_rate ?? 0) * 100)}%</dd></div>}
        </dl>

        <FollowButton orgId={drop.merchant.org_id} />

        {!gone && (
          <div className="position-hint">
            You&apos;d be <span className="data position-hint-num">{pad(wouldBe, drop.quantity_total)}</span>
          </div>
        )}

        {note && <p className="field-error">{note}</p>}

        <div className="detail-actions">
          {gone ? (
            <p className="muted">This drop is gone.</p>
          ) : (
            <>
              <button className="btn-catch" onClick={onCatch} disabled={busy || (signedIn && !drop.can_catch)}>
                {signedIn ? "Catch" : "Sign in to catch"}
              </button>
              <button className="btn-secondary" onClick={onShare}>Share</button>
            </>
          )}
        </div>
        {signedIn && !drop.can_catch && drop.catch_blocked_reason && (
          <p className="muted">{REASON[drop.catch_blocked_reason] ?? ""}</p>
        )}
      </div>
    </div>
  );
}
