"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
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

  // Bulk duplicate: schedule one copy per date in a single action (e.g. the four
  // Tuesdays). All-or-nothing on the allowance cap — the server refuses the whole
  // batch rather than leaving a partial set.
  const [bulkFor, setBulkFor] = useState<string | null>(null);
  const [bulkDates, setBulkDates] = useState<string[]>([""]);

  function openBulk(id: string) { setBulkFor(id); setBulkDates([""]); setNote(null); }
  const filledDates = bulkDates.filter(Boolean);

  async function scheduleBulk(id: string) {
    const dates = filledDates.map((v) => new Date(v).toISOString());
    if (dates.length === 0) { setNote("Add at least one go-live date."); return; }
    setBusy(id); setNote(null);
    const r = await api<{ drops: { id: string }[] }>(`/v1/drops/${id}/duplicate`, { method: "POST", body: { schedule_at: dates } });
    setBusy(null);
    if (r.ok && r.data) {
      const n = r.data.drops.length;
      setBulkFor(null);
      setNote(`Scheduled ${n} ${n === 1 ? "copy" : "copies"}.`);
      const rr = await api<OperatorDrop[]>(`/v1/orgs/${org.org_id}/drops`);
      if (rr.ok && rr.data) setDrops(rr.data);
      return;
    }
    setNote(r.error?.message ?? "Could not schedule copies.");
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
                // A copy's window is shifted from the source, so bulk needs a source
                // that already has a schedule (anything past draft/submitted).
                const canBulk = d.status !== "draft" && d.status !== "submitted";
                return (
                  <Fragment key={d.id}>
                    <tr>
                      <td className="op-cell-title">{d.title}</td>
                      <td>{locName(d.location_id)}</td>
                      <td><span className="op-status" data-status={d.status}>{STATUS_LABEL[d.status] ?? d.status}</span></td>
                      <td className="op-num data">{d.quantity_remaining} / {d.quantity_total}</td>
                      <td className="op-actions">
                        <Link href={`/operator/drops/${d.id}/stats`} className="op-link">Stats</Link>
                        {editable && <Link href={`/operator/drops/${d.id}/edit`} className="op-link">Edit</Link>}
                        <button className="op-link" disabled={busy === d.id} onClick={() => duplicate(d.id)}>Duplicate</button>
                        {canBulk && <button className="op-link" disabled={busy === d.id} onClick={() => openBulk(d.id)}>Duplicate to dates</button>}
                        {d.status === "gone" && <button className="op-link" disabled={busy === d.id} onClick={() => encore(d.id)}>Encore</button>}
                      </td>
                    </tr>
                    {bulkFor === d.id && (
                      <tr className="op-bulk-row">
                        <td colSpan={5}>
                          <div className="op-bulk stack">
                            <p className="op-bulk-title">Schedule copies of “{d.title}” — one per go-live date. The redemption window shifts to each date. All-or-nothing: if your allowance can’t cover them all, none are scheduled.</p>
                            {bulkDates.map((v, i) => (
                              <div key={i} className="row">
                                <label className="op-bulk-label" htmlFor={`bulk-${d.id}-${i}`}>Go-live {i + 1}</label>
                                <input id={`bulk-${d.id}-${i}`} type="datetime-local" value={v} onChange={(e) => setBulkDates((ds) => ds.map((x, j) => (j === i ? e.target.value : x)))} />
                                {bulkDates.length > 1 && <button type="button" className="op-link" onClick={() => setBulkDates((ds) => ds.filter((_, j) => j !== i))}>Remove</button>}
                              </div>
                            ))}
                            <div className="row">
                              <button type="button" className="btn-secondary" onClick={() => setBulkDates((ds) => [...ds, ""])}>Add date</button>
                              <button type="button" className="btn-catch" disabled={busy === d.id || filledDates.length === 0} onClick={() => scheduleBulk(d.id)}>
                                Schedule {filledDates.length || ""} {filledDates.length === 1 ? "copy" : "copies"}
                              </button>
                              <button type="button" className="op-link" onClick={() => setBulkFor(null)}>Cancel</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
