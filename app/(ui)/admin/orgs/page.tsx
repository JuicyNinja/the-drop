"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

interface AdminOrg {
  id: string; name: string; lane: string; status: string; tier: string;
  max_locations: number; drops_per_cycle: number; drops_pooled_org_level: boolean;
}

export default function AdminOrgs() {
  const [orgs, setOrgs] = useState<AdminOrg[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    const r = await api<AdminOrg[]>("/v1/admin/orgs");
    if (r.ok && r.data) setOrgs(r.data);
  };
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<AdminOrg[]>("/v1/admin/orgs");
      if (alive && r.ok && r.data) setOrgs(r.data);
    })();
    return () => { alive = false; };
  }, []);

  async function act(id: string, action: "suspend" | "delist") {
    setBusy(id); setNote(null);
    const r = await api(`/v1/admin/orgs/${id}/${action}`, { method: "POST" });
    setBusy(null);
    if (r.ok) { setNote(`Org ${action}ed.`); void load(); return; }
    setNote(r.error?.message ?? `Could not ${action}.`);
  }

  return (
    <div className="op-page stack">
      <h1 className="op-title">Organizations</h1>
      {note && <p className="muted">{note}</p>}
      {orgs === null ? <p className="op-empty">Loading.</p> : orgs.length === 0 ? <p className="op-empty">No organizations.</p> : (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead><tr><th>Org</th><th>Tier</th><th>Status</th><th className="op-num">Locations</th><th className="op-num">Drops/cycle</th><th>Actions</th></tr></thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td className="op-cell-title">{o.name}</td>
                  <td>{o.tier.replace(/^local_/, "")}</td>
                  <td><span className="op-status" data-status={o.status}>{o.status}</span></td>
                  <td className="op-num data">{o.max_locations}</td>
                  <td className="op-num data">{o.drops_per_cycle}{o.drops_pooled_org_level ? " (pooled)" : ""}</td>
                  <td className="op-actions">
                    <button className="op-link" disabled={busy === o.id || o.status === "suspended"} onClick={() => act(o.id, "suspend")}>Suspend</button>
                    <button className="op-link" disabled={busy === o.id || o.status === "delisted"} onClick={() => act(o.id, "delist")}>Delist</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
