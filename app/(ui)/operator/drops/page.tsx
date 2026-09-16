"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { useOperator } from "../_lib/shell";

/**
 * Drops list (DESIGN-SYSTEM §9): data-dense table, newest first, every status.
 * Duplicate clones any drop to a new draft; Encore is available only from Gone
 * (the sole supply-adding mechanism, invariant #2). Edit reaches draft/scheduled
 * drops only — a live drop is immutable. New drops are entered from a location.
 */

interface OperatorDrop {
  id: string;
  title: string;
  status: string;
  quantity_total: number;
  quantity_remaining: number;
  location_id: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", scheduled: "Scheduled", live: "Live", gone: "Gone",
  expired: "Expired", encore_pending: "Encore pending", submitted: "Submitted",
};

export default function DropsListPage() {
  const { org } = useOperator();
  const router = useRouter();
  const [drops, setDrops] = useState<OperatorDrop[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<OperatorDrop[]>(`/v1/orgs/${org.org_id}/drops`);
      if (alive && r.ok && r.data) setDrops(r.data);
    })();
    return () => { alive = false; };
  }, [org.org_id]);

  const locName = (id: string | null) => org.locations.find((l) => l.id === id)?.name ?? "—";

  async function duplicate(id: string) {
    setBusy(id); setNote(null);
    const r = await api<{ id: string }>(`/v1/drops/${id}/duplicate`, { method: "POST" });
    setBusy(null);
    if (r.ok && r.data) { router.push(`/operator/drops/${r.data.id}/edit`); return; }
    setNote(r.error?.message ?? "Could not duplicate.");
  }

  async function encore(id: string) {
    setBusy(id); setNote(null);
    const r = await api<{ id: string }>(`/v1/drops/${id}/encore`, { method: "POST" });
    setBusy(null);
    if (r.ok && r.data) { router.push(`/operator/drops/${r.data.id}/edit`); return; }
    setNote(r.error?.message ?? "Could not create an encore.");
  }

  return (
    <div className="op-page stack">
      <div className="op-page-head">
        <h1 className="op-title">Drops</h1>
        <Link href="/operator/drops/new" className="btn-catch op-new-btn">New drop</Link>
      </div>

      {note && <p className="field-error">{note}</p>}
      {drops === null && <p className="op-empty">Loading.</p>}
      {drops && drops.length === 0 && <p className="op-empty">No drops yet. New drop starts one from a location.</p>}

      {drops && drops.length > 0 && (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead>
              <tr>
                <th>Drop</th><th>Location</th><th>Status</th><th className="op-num">Remaining</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drops.map((d) => {
                const editable = d.status === "draft" || d.status === "scheduled";
                return (
                  <tr key={d.id}>
                    <td className="op-cell-title">{d.title}</td>
                    <td>{locName(d.location_id)}</td>
                    <td><span className="op-status" data-status={d.status}>{STATUS_LABEL[d.status] ?? d.status}</span></td>
                    <td className="op-num data">{d.quantity_remaining} / {d.quantity_total}</td>
                    <td className="op-actions">
                      <Link href={`/operator/drops/${d.id}/stats`} className="op-link">Stats</Link>
                      {editable && <Link href={`/operator/drops/${d.id}/edit`} className="op-link">Edit</Link>}
                      <button className="op-link" disabled={busy === d.id} onClick={() => duplicate(d.id)}>Duplicate</button>
                      {d.status === "gone" && <button className="op-link" disabled={busy === d.id} onClick={() => encore(d.id)}>Encore</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
