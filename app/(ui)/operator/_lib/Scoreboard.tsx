"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/**
 * The persistent scoreboard (DESIGN-SYSTEM §9): a --board panel fixed top-right
 * on every operator screen, Departure Mono numerals, --signal on the number that
 * matters most this cycle — drops remaining, because running out of allowance is
 * what stops the operator working. When drops_pooled_org_level is true the counts
 * are org-wide; that fork is the server's, surfaced here as a quiet label.
 */

interface ScoreboardData {
  drops_used: number;
  drops_remaining: number;
  live_now: number;
  total_catches: number;
  total_redemptions: number;
  whispers: number;
  cycle_ends_at: string;
  drops_pooled_org_level: boolean;
}

export function Scoreboard({ orgId }: { orgId: string }) {
  const [data, setData] = useState<ScoreboardData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await api<ScoreboardData>(`/v1/orgs/${orgId}/scoreboard`);
      if (alive && r.ok && r.data) setData(r.data);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [orgId]);

  return (
    <div className="op-scoreboard" role="status" aria-label="Scoreboard">
      <div className="op-score op-score-primary">
        <span className="op-score-num data">{data ? data.drops_remaining : "—"}</span>
        <span className="op-score-label">drops left</span>
      </div>
      <div className="op-score">
        <span className="op-score-num data">{data ? data.live_now : "—"}</span>
        <span className="op-score-label">live</span>
      </div>
      <div className="op-score">
        <span className="op-score-num data">{data ? data.total_catches : "—"}</span>
        <span className="op-score-label">caught</span>
      </div>
      <div className="op-score">
        <span className="op-score-num data">{data ? data.total_redemptions : "—"}</span>
        <span className="op-score-label">redeemed</span>
      </div>
      <div className="op-score">
        <span className="op-score-num data">{data ? data.whispers : "—"}</span>
        <span className="op-score-label">whispers</span>
      </div>
    </div>
  );
}
