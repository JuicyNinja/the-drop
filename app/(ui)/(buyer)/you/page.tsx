"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearSession } from "@/app/(ui)/_lib/api";
import { RequireAuth } from "@/components/RequireAuth";
import { AddressManager } from "./AddressManager";
import { FollowingList } from "./FollowingList";
import { PhoneSection } from "./PhoneSection";
import { PushOptIn } from "./PushOptIn";
import { Notifications } from "./Notifications";
import { EditProfile } from "./EditProfile";

interface Me { user_number: string; handle: string; handle_locked: boolean; full_name: string; email: string; phone: string; phone_verified: boolean; badges: { slug: string; label: string }[] }
interface CloutEvent { source: string; points: number; occurred_at: string }
interface Clout { tier: number; percentile: number | null; decayed_score: number; recent_events: CloutEvent[] }

function pad14(n: string): string { return n.padStart(14, "0"); }

// Clout is earned only from completed redemptions, whispers, and attributed
// shares (invariant #6). These are the ledger sources the API emits.
const SOURCE_LABEL: Record<string, string> = {
  redemption: "Redeemed a drop",
  whisper: "Left a whisper",
  share_attributed: "A share you made was caught",
  share: "Attributed share",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, " ");
const eventDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

function You() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [clout, setClout] = useState<Clout | null>(null);

  const loadMe = async () => {
    const m = await api<Me>("/v1/users/me");
    if (m.ok && m.data) setMe(m.data);
  };

  useEffect(() => {
    (async () => {
      const [m, c] = await Promise.all([api<Me>("/v1/users/me"), api<Clout>("/v1/users/me/clout")]);
      if (m.ok && m.data) setMe(m.data);
      if (c.ok && c.data) setClout(c.data);
    })();
  }, []);

  if (!me) return <div className="page muted">Loading.</div>;

  return (
    <div className="page stack you">
      <div>
        <h1 className="you-handle">{me.handle}</h1>
        <p className="you-name muted">{me.full_name}</p>
        <EditProfile
          profile={{ full_name: me.full_name, handle: me.handle, handle_locked: me.handle_locked, email: me.email }}
          onSaved={() => void loadMe()}
        />
      </div>

      <div className="you-panel">
        <p className="you-panel-label muted">Clout</p>
        <p className="you-tier data">Tier {clout?.tier ?? 1}</p>
        {clout && clout.percentile !== null && <p className="muted">Top {Math.max(1, Math.round(clout.percentile * 100))}% in your city</p>}
        {clout && clout.recent_events.length > 0 && (
          <ul className="clout-ledger">
            {clout.recent_events.map((e, i) => (
              <li key={`${e.source}-${e.occurred_at}-${i}`} className="clout-row">
                <span className="clout-source">{sourceLabel(e.source)}</span>
                <span className="clout-points data">+{e.points}</span>
                <span className="clout-when muted">{eventDate(e.occurred_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {clout && clout.recent_events.length === 0 && <p className="muted">No clout yet. Redeem a drop to start.</p>}
      </div>

      <div>
        <p className="you-panel-label muted">Badges</p>
        {me.badges.length === 0 ? <p className="muted">No badges yet.</p> : (
          <div className="row you-badges">{me.badges.map((b) => <span key={b.slug} className="badge">{b.label}</span>)}</div>
        )}
      </div>

      <FollowingList />

      <AddressManager />

      <PhoneSection phone={me.phone} verified={me.phone_verified} />

      <PushOptIn />

      <Notifications />

      <div>
        <p className="you-panel-label muted">Account number</p>
        <p className="you-usernum data">{pad14(me.user_number)}</p>
      </div>

      <button className="btn-secondary you-signout" onClick={() => { clearSession(); router.replace("/"); }}>Sign out</button>
    </div>
  );
}

export default function YouPage() {
  return <RequireAuth><You /></RequireAuth>;
}
