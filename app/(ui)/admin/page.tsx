"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

interface DemandPoint { city: string; region: string; saved_addresses: number; lat: number | null; lng: number | null }
interface Metrics {
  users: number; orgs_active: number; drops_live: number; catches_total: number;
  redemptions_total: number; cities_launched: number; demand_map: DemandPoint[];
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return <div className="op-stat"><span className="op-stat-num data">{value}</span><span className="op-stat-label">{label}</span></div>;
}

/** wq-* width classes are 5% steps; the CSP forbids inline style widths. */
function wq(fraction: number): string { return `wq-${Math.round(fraction * 20) * 5}`; }

export default function AdminOverview() {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<Metrics>("/v1/admin/metrics");
      if (alive && r.ok && r.data) setM(r.data);
    })();
    return () => { alive = false; };
  }, []);

  if (!m) return <div className="op-page op-empty">Loading.</div>;
  const maxDemand = Math.max(1, ...m.demand_map.map((d) => d.saved_addresses));

  return (
    <div className="op-page stack">
      <h1 className="op-title">Overview</h1>
      <div className="op-stats-grid">
        <Stat value={m.users} label="users" />
        <Stat value={m.orgs_active} label="active orgs" />
        <Stat value={m.drops_live} label="live drops" />
        <Stat value={m.catches_total} label="catches" />
        <Stat value={m.redemptions_total} label="redemptions" />
        <Stat value={m.cities_launched} label="cities launched" />
      </div>

      <div className="stack">
        <h2 className="op-section">Demand map — saved addresses by city</h2>
        <p className="muted">Where buyers have saved addresses is where demand already is — the signal for which market to launch next.</p>
        {m.demand_map.length === 0 ? <p className="op-empty">No saved addresses yet.</p> : (
          <div className="op-demand">
            {m.demand_map.map((d) => (
              <div key={`${d.city}-${d.region}`} className="op-demand-row">
                <span className="op-demand-city">{d.city}, {d.region}</span>
                <span className="op-demand-bar"><span className={`op-demand-fill ${wq(d.saved_addresses / maxDemand)}`} /></span>
                <span className="op-demand-count data">{d.saved_addresses}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
