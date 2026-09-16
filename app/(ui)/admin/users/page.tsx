"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

interface AdminUser {
  id: string; user_number_display: string; handle: string; full_name: string; email: string;
  suspended_at: string | null; clout_frozen_at: string | null;
}
interface RiskProfile {
  user_id: string; catches_total: number; redemptions_total: number; abandoned_catches: number;
  redemption_rate: number | null; transfers_received_total: number; distinct_transfer_senders: number;
  whisper_count: number; needs_review: boolean; review_reasons: string[]; computed_at: string;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [risk, setRisk] = useState<RiskProfile | "none" | null>(null);
  const [riskFor, setRiskFor] = useState<string | null>(null);

  const load = async (term = "") => {
    const r = await api<AdminUser[]>(`/v1/admin/users${term ? `?q=${encodeURIComponent(term)}` : ""}`);
    if (r.ok && r.data) setUsers(r.data);
  };
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<AdminUser[]>("/v1/admin/users");
      if (alive && r.ok && r.data) setUsers(r.data);
    })();
    return () => { alive = false; };
  }, []);

  async function suspend(u: AdminUser) {
    setBusy(u.id);
    await api(`/v1/admin/users/${u.id}/suspend`, { method: "POST", body: { suspended: !u.suspended_at } });
    setBusy(null); void load(q);
  }
  async function freeze(u: AdminUser) {
    setBusy(u.id);
    await api(`/v1/admin/users/${u.id}/clout/freeze`, { method: "POST", body: { frozen: !u.clout_frozen_at } });
    setBusy(null); void load(q);
  }
  async function viewRisk(u: AdminUser) {
    setRiskFor(u.id); setRisk(null);
    const r = await api<RiskProfile>(`/v1/admin/users/${u.id}/risk`);
    setRisk(r.ok && r.data ? r.data : "none");
  }

  return (
    <div className="op-page stack">
      <h1 className="op-title">Users</h1>
      <form className="op-inline-field" onSubmit={(e) => { e.preventDefault(); void load(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="handle, name, or email" aria-label="Search users" />
        <button className="btn-secondary" type="submit">Search</button>
      </form>

      {users === null ? <p className="op-empty">Loading.</p> : users.length === 0 ? <p className="op-empty">No users.</p> : (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead><tr><th>User</th><th>Number</th><th>State</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="op-cell-title">{u.handle}<span className="muted"> · {u.full_name}</span></td>
                  <td className="data">{u.user_number_display}</td>
                  <td>
                    {u.suspended_at && <span className="op-status" data-status="suspended">suspended</span>}
                    {u.clout_frozen_at && <span className="op-status"> clout frozen</span>}
                    {!u.suspended_at && !u.clout_frozen_at && <span className="muted">active</span>}
                  </td>
                  <td className="op-actions">
                    <button className="op-link" disabled={busy === u.id} onClick={() => suspend(u)}>{u.suspended_at ? "Reinstate" : "Suspend"}</button>
                    <button className="op-link" disabled={busy === u.id} onClick={() => freeze(u)}>{u.clout_frozen_at ? "Unfreeze clout" : "Freeze clout"}</button>
                    <button className="op-link" onClick={() => viewRisk(u)}>Risk</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {riskFor && (
        <div className="op-panel stack">
          <div className="op-page-head"><h2 className="op-section">Risk profile</h2><button className="op-link" onClick={() => { setRiskFor(null); setRisk(null); }}>Close</button></div>
          {risk === null && <p className="op-empty">Loading.</p>}
          {risk === "none" && <p className="op-empty">No risk profile computed for this user yet. Run a recompute from Fraud.</p>}
          {risk && risk !== "none" && (
            <>
              <p className={risk.needs_review ? "op-whisper-return" : "muted"} data-yes={risk.needs_review}>
                {risk.needs_review ? `Flagged for review: ${risk.review_reasons.join(", ")}` : "No flags."}
              </p>
              <div className="op-stats-grid">
                <div className="op-stat"><span className="op-stat-num data">{risk.catches_total}</span><span className="op-stat-label">catches</span></div>
                <div className="op-stat"><span className="op-stat-num data">{risk.redemptions_total}</span><span className="op-stat-label">redeemed</span></div>
                <div className="op-stat"><span className="op-stat-num data">{risk.abandoned_catches}</span><span className="op-stat-label">abandoned</span></div>
                <div className="op-stat"><span className="op-stat-num data">{risk.redemption_rate === null ? "—" : `${Math.round(risk.redemption_rate * 100)}%`}</span><span className="op-stat-label">redemption rate</span></div>
                <div className="op-stat"><span className="op-stat-num data">{risk.distinct_transfer_senders}</span><span className="op-stat-label">distinct senders</span></div>
                <div className="op-stat"><span className="op-stat-num data">{risk.whisper_count}</span><span className="op-stat-label">whispers</span></div>
              </div>
              <p className="muted">Flags prompt a human review. Nothing here suspends automatically.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
