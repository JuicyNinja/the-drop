"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { useOperator } from "../../../_lib/shell";

/**
 * Per-drop stats (WP-13, replacing the NOT_IMPLEMENTED shell). Real metrics:
 * catches, redemptions, the redemption rate, and the gps-verified vs
 * unverified-timeout split — the latter being the fraud signal, surfaced plainly.
 */

interface DropStats {
  drop_id: string; status: string; quantity_total: number; quantity_remaining: number;
  pct_remaining: number; catches: number; redemptions: number; redemption_rate: number | null;
  gps_verified: number; unverified_timeout: number;
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="op-stat">
      <span className="op-stat-num data">{value}</span>
      <span className="op-stat-label">{label}</span>
    </div>
  );
}

export default function DropStatsPage() {
  const { org } = useOperator();
  const id = useParams<{ id: string }>().id;
  const [stats, setStats] = useState<DropStats | null | "error">(null);
  const [title, setTitle] = useState<string>("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [s, list] = await Promise.all([
        api<DropStats>(`/v1/drops/${id}/stats`),
        api<{ id: string; title: string }[]>(`/v1/orgs/${org.org_id}/drops`),
      ]);
      if (!alive) return;
      setStats(s.ok && s.data ? s.data : "error");
      if (list.ok && list.data) setTitle(list.data.find((d) => d.id === id)?.title ?? "");
    })();
    return () => { alive = false; };
  }, [id, org.org_id]);

  if (stats === null) return <div className="op-page op-empty">Loading.</div>;
  if (stats === "error") return <div className="op-page op-empty">Stats are not available for this drop.</div>;

  const caught = stats.quantity_total - stats.quantity_remaining;
  return (
    <div className="op-page stack">
      <div className="op-page-head">
        <div>
          <h1 className="op-title">{title || "Drop"}</h1>
          <p className="muted">{stats.status}</p>
        </div>
        <Link href="/operator/drops" className="op-link">Back to drops</Link>
      </div>

      <div className="op-stats-grid">
        <Stat value={`${caught} / ${stats.quantity_total}`} label="caught" />
        <Stat value={stats.quantity_remaining} label="remaining" />
        <Stat value={stats.redemptions} label="redeemed" />
        <Stat value={stats.redemption_rate === null ? "—" : `${Math.round(stats.redemption_rate * 100)}%`} label="redemption rate" />
        <Stat value={stats.gps_verified} label="gps verified" />
        <Stat value={stats.unverified_timeout} label="unverified" />
      </div>
    </div>
  );
}
