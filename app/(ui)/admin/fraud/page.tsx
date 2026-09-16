"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

type Tab = "transfers" | "unverified" | "velocity" | "risk";

interface TransferPattern { user_id: string; user_handle: string; distinct_senders: number; transfers_received: number }
interface Unverified { redemption_id: string; user_handle: string; drop_title: string; redeemed_at: string }
interface Velocity { user_id: string; user_handle: string; unverified_30d: number; limit: number }
interface Risk { user_id: string; redemption_rate: number | null; abandoned_catches: number; distinct_transfer_senders: number; review_reasons: string[] }

export default function AdminFraud() {
  const [tab, setTab] = useState<Tab>("transfers");
  const [transfers, setTransfers] = useState<TransferPattern[]>([]);
  const [unverified, setUnverified] = useState<Unverified[]>([]);
  const [velocity, setVelocity] = useState<Velocity[]>([]);
  const [risk, setRisk] = useState<Risk[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [t, u, v, r] = await Promise.all([
        api<TransferPattern[]>("/v1/admin/fraud/transfer-patterns"),
        api<Unverified[]>("/v1/admin/fraud/unverified-redemptions"),
        api<Velocity[]>("/v1/admin/fraud/velocity-flags"),
        api<Risk[]>("/v1/admin/fraud/risk"),
      ]);
      if (!alive) return;
      if (t.ok && t.data) setTransfers(t.data);
      if (u.ok && u.data) setUnverified(u.data);
      if (v.ok && v.data) setVelocity(v.data);
      if (r.ok && r.data) setRisk(r.data);
    })();
    return () => { alive = false; };
  }, []);

  async function recompute() {
    setNote("Recomputing…");
    const r = await api<{ profiles: number; flagged: number }>("/v1/admin/fraud/risk/recompute", { method: "POST" });
    if (r.ok && r.data) {
      setNote(`Recomputed ${r.data.profiles} profiles, ${r.data.flagged} flagged.`);
      const rr = await api<Risk[]>("/v1/admin/fraud/risk");
      if (rr.ok && rr.data) setRisk(rr.data);
    } else setNote(r.error?.message ?? "Recompute failed.");
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "transfers", label: `Transfer patterns (${transfers.length})` },
    { key: "unverified", label: `Unverified (${unverified.length})` },
    { key: "velocity", label: `Velocity (${velocity.length})` },
    { key: "risk", label: `Flagged buyers (${risk.length})` },
  ];

  return (
    <div className="op-page stack">
      <div className="op-page-head">
        <h1 className="op-title">Fraud review</h1>
        <button className="btn-secondary" onClick={recompute}>Recompute risk</button>
      </div>
      {note && <p className="muted">{note}</p>}
      <p className="muted">Review surfaces. Nothing here suspends automatically — an admin reads and decides.</p>

      <div className="tabs">
        {TABS.map((t) => <button key={t.key} className="tab" data-active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      {tab === "transfers" && (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead><tr><th>Recipient</th><th className="op-num">Distinct senders</th><th className="op-num">Transfers received</th></tr></thead>
            <tbody>
              {transfers.length === 0 ? <tr><td colSpan={3} className="op-empty">No transfer-pattern flags.</td></tr> :
                transfers.map((t) => (
                  <tr key={t.user_id}><td className="op-cell-title">{t.user_handle}</td><td className="op-num data">{t.distinct_senders}</td><td className="op-num data">{t.transfers_received}</td></tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "unverified" && (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead><tr><th>Buyer</th><th>Drop</th><th>When</th></tr></thead>
            <tbody>
              {unverified.length === 0 ? <tr><td colSpan={3} className="op-empty">No unverified redemptions.</td></tr> :
                unverified.map((u) => (
                  <tr key={u.redemption_id}><td className="op-cell-title">{u.user_handle}</td><td>{u.drop_title}</td><td className="muted">{new Date(u.redeemed_at).toLocaleString()}</td></tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "velocity" && (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead><tr><th>Buyer</th><th className="op-num">Unverified (30d)</th><th className="op-num">Limit</th></tr></thead>
            <tbody>
              {velocity.length === 0 ? <tr><td colSpan={3} className="op-empty">No velocity flags.</td></tr> :
                velocity.map((v) => (
                  <tr key={v.user_id}><td className="op-cell-title">{v.user_handle}</td><td className="op-num data">{v.unverified_30d}</td><td className="op-num data">{v.limit}</td></tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "risk" && (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead><tr><th>Buyer</th><th>Reasons</th><th className="op-num">Redemption</th><th className="op-num">Abandoned</th><th className="op-num">Senders</th></tr></thead>
            <tbody>
              {risk.length === 0 ? <tr><td colSpan={5} className="op-empty">No flagged buyers. Recompute to refresh.</td></tr> :
                risk.map((r) => (
                  <tr key={r.user_id}>
                    <td className="op-cell-title data">{r.user_id.slice(0, 8)}</td>
                    <td>{r.review_reasons.join(", ")}</td>
                    <td className="op-num data">{r.redemption_rate === null ? "—" : `${Math.round(r.redemption_rate * 100)}%`}</td>
                    <td className="op-num data">{r.abandoned_catches}</td>
                    <td className="op-num data">{r.distinct_transfer_senders}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
