"use client";

import { useState } from "react";
import { getSession } from "@/app/(ui)/_lib/api";
import { useBuyer } from "./buyer";

/**
 * Follow / unfollow a merchant (API-CONTRACT §8). Follower = push + in-app,
 * uncapped. Fanatic = SMS + push, capped at 10 per lane and self-initiated only.
 * WP-12's notification engine fires to these tiers, so this is the only way a
 * buyer opts into a merchant's drops. `compact` is the board-card affordance; the
 * full control (tier switch) lives on drop detail.
 */
export function FollowButton({ orgId, variant = "full" }: { orgId: string; variant?: "full" | "compact" }) {
  const { followTierOf, setFollow, unfollow } = useBuyer();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const tier = followTierOf(orgId);

  // The follow surfaces are auth-only; a signed-out shared-link viewer sees nothing.
  if (typeof window !== "undefined" && !getSession()) return null;

  async function toFollow(t: "follower" | "fanatic") {
    setBusy(true); setNote(null);
    const r = await setFollow(orgId, t);
    setBusy(false);
    if (!r.ok) setNote(r.code === "FANATIC_LIMIT_REACHED" ? (r.message ?? "You already have 10 Fanatics in this lane.") : (r.message ?? "Could not follow."));
  }
  async function stop() { setBusy(true); setNote(null); await unfollow(orgId); setBusy(false); }

  if (variant === "compact") {
    return tier ? (
      <button className="follow-pill" data-following="true" disabled={busy} onClick={(e) => { e.preventDefault(); void stop(); }}>
        {tier === "fanatic" ? "★ Fanatic" : "✓ Following"}
      </button>
    ) : (
      <button className="follow-pill" disabled={busy} onClick={(e) => { e.preventDefault(); void toFollow("follower"); }}>
        + Follow
      </button>
    );
  }

  return (
    <div className="follow-full stack">
      {!tier ? (
        <div className="row">
          <button className="btn-secondary" disabled={busy} onClick={() => toFollow("follower")}>Follow</button>
          <button className="btn-secondary" disabled={busy} onClick={() => toFollow("fanatic")}>★ Fanatic</button>
        </div>
      ) : (
        <div className="row follow-manage">
          <span className="follow-state">Following{tier === "fanatic" ? " · Fanatic" : ""}</span>
          {tier === "follower"
            ? <button className="op-link" disabled={busy} onClick={() => toFollow("fanatic")}>Become a Fanatic</button>
            : <button className="op-link" disabled={busy} onClick={() => toFollow("follower")}>Step down to Follower</button>}
          <button className="op-link" disabled={busy} onClick={stop}>Unfollow</button>
        </div>
      )}
      {note && <p className="muted follow-note">{note}</p>}
    </div>
  );
}
