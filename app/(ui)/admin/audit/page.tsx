"use client";

import { Fragment, useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

interface AuditEntry {
  id: string; actor_handle: string; action: string; target_type: string; target_id: string | null;
  ip_address: string | null; occurred_at: string; before: unknown; after: unknown;
}

export default function AdminAudit() {
  const [log, setLog] = useState<AuditEntry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<AuditEntry[]>("/v1/admin/audit-log");
      if (alive && r.ok && r.data) setLog(r.data);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="op-page stack">
      <h1 className="op-title">Audit log</h1>
      <p className="muted">Append-only. Every admin mutation records actor, action, target, before/after, and IP.</p>
      {log === null ? <p className="op-empty">Loading.</p> : log.length === 0 ? <p className="op-empty">No admin actions recorded yet.</p> : (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th><th></th></tr></thead>
            <tbody>
              {log.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td className="muted">{new Date(e.occurred_at).toLocaleString()}</td>
                    <td className="op-cell-title">{e.actor_handle}</td>
                    <td className="data">{e.action}</td>
                    <td>{e.target_type}{e.target_id ? ` · ${e.target_id.slice(0, 8)}` : ""}</td>
                    <td className="data">{e.ip_address ?? "—"}</td>
                    <td className="op-actions"><button className="op-link" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Hide" : "Diff"}</button></td>
                  </tr>
                  {open === e.id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="op-form-grid">
                          <div><span className="op-stat-label">before</span><pre className="op-diff">{JSON.stringify(e.before, null, 2)}</pre></div>
                          <div><span className="op-stat-label">after</span><pre className="op-diff">{JSON.stringify(e.after, null, 2)}</pre></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
