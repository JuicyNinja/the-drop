"use client";

import { useState } from "react";
import { useBuyer } from "../_lib/buyer";

/** The buyer's follows (API-CONTRACT §8): tier per merchant, with unfollow. */
export function FollowingList() {
  const { follows, setFollow, unfollow } = useBuyer();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function toTier(orgId: string, tier: "follower" | "fanatic") {
    setBusy(orgId); setNote(null);
    const r = await setFollow(orgId, tier);
    setBusy(null);
    if (!r.ok) setNote(r.message ?? "Could not update.");
  }
  async function stop(orgId: string) { setBusy(orgId); await unfollow(orgId); setBusy(null); }

  return (
    <div>
      <p className="you-panel-label muted">Following</p>
      {note && <p className="field-error">{note}</p>}
      {follows.length === 0 ? (
        <p className="muted">Not following anyone yet. Follow a merchant from a drop to hear when they drop.</p>
      ) : (
        <ul className="following-list">
          {follows.map((f) => (
            <li key={f.org_id} className="following">
              <span className="following-name">{f.name}</span>
              <span className="following-tier" data-fanatic={f.tier === "fanatic"}>{f.tier === "fanatic" ? "Fanatic" : "Follower"}</span>
              <span className="following-actions">
                {f.tier === "follower"
                  ? <button className="op-link" disabled={busy === f.org_id} onClick={() => toTier(f.org_id, "fanatic")}>Fanatic</button>
                  : <button className="op-link" disabled={busy === f.org_id} onClick={() => toTier(f.org_id, "follower")}>Follower</button>}
                <button className="op-link" disabled={busy === f.org_id} onClick={() => stop(f.org_id)}>Unfollow</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
