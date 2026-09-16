"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { useOperator } from "./_lib/shell";

/**
 * Today dashboard (DESIGN-SYSTEM §9): today's codes rendered large on --board so
 * they read across a counter, NATO-phonetic guidance beneath in Satoshi, and the
 * live redemption feed newest-first. The operator only ever DISPLAYS the code —
 * the buyer types it into their own device (invariant #8). Unverified redemptions
 * (no_fix_timeout auto-redeem) carry a grey dot and the word "unverified".
 */

interface TodayCode { drop_id: string; code: string; phonetic: string; title: string; redeem_until: string | null }
interface FeedEntry { handle: string; position_number: number; method: string; unverified: boolean; at: string }
interface TodayData { codes: TodayCode[]; feed: FeedEntry[] }

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function TodayPage() {
  const { org } = useOperator();
  // The selected location is derived, not reset via an effect: when the org
  // changes under us, a now-invalid selection falls back to the first location,
  // and the fetch effect (keyed on the derived id) refetches on its own.
  const [selectedLocId, setSelectedLocId] = useState<string>("");
  const locId = org.locations.some((l) => l.id === selectedLocId) ? selectedLocId : (org.locations[0]?.id ?? "");
  const [data, setData] = useState<TodayData | null>(null);

  useEffect(() => {
    if (!locId) return; // no location: nothing to fetch
    let alive = true;
    const load = async () => {
      const r = await api<TodayData>(`/v1/locations/${locId}/today`);
      if (alive && r.ok && r.data) setData(r.data);
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [locId]);

  return (
    <div className="op-page stack">
      <div className="op-page-head">
        <h1 className="op-title">Today</h1>
        {org.locations.length > 1 && (
          <label className="op-inline-field">
            <span className="op-switcher-label">Location</span>
            <select value={locId} onChange={(e) => setSelectedLocId(e.target.value)} aria-label="Location">
              {org.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {org.locations.length === 0 && <p className="op-empty">No locations yet. Add one from Account.</p>}

      {data && data.codes.length === 0 && org.locations.length > 0 && (
        <p className="op-empty">No live drops at this location today.</p>
      )}

      <div className="op-codes">
        {(data?.codes ?? []).map((c) => (
          <div key={c.drop_id} className="op-code-card">
            <p className="op-code-title">{c.title}</p>
            <p className="op-code data">{c.code}</p>
            <p className="op-code-phonetic">{c.phonetic}</p>
            {c.redeem_until && <p className="op-code-until">Redeem until {timeOf(c.redeem_until)}</p>}
          </div>
        ))}
      </div>

      <div className="stack">
        <h2 className="op-section">Redemptions</h2>
        {data && data.feed.length === 0 && <p className="op-empty">Nothing redeemed yet today.</p>}
        <ul className="op-feed">
          {(data?.feed ?? []).map((f, i) => (
            <li key={`${f.handle}-${f.position_number}-${i}`} className="op-feed-row">
              <span className="op-feed-pos data">{String(f.position_number).padStart(3, "0")}</span>
              <span className="op-feed-handle">{f.handle}</span>
              {f.unverified && (
                <span className="op-unverified"><span className="op-unverified-dot" aria-hidden /> unverified</span>
              )}
              <span className="op-feed-time muted">{timeOf(f.at)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
