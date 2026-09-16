"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

interface AdminCity {
  id: string; name: string; region: string; timezone: string;
  default_geofence_m: number; coldstart_days: number; coldstart_min_events: number;
  active: boolean; launched_at: string | null;
}

export default function AdminCities() {
  const [cities, setCities] = useState<AdminCity[] | null>(null);
  const [edit, setEdit] = useState<AdminCity | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    const r = await api<AdminCity[]>("/v1/admin/cities");
    if (r.ok && r.data) setCities(r.data);
  };
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<AdminCity[]>("/v1/admin/cities");
      if (alive && r.ok && r.data) setCities(r.data);
    })();
    return () => { alive = false; };
  }, []);

  async function save() {
    if (!edit) return;
    setBusy(true); setNote(null);
    const r = await api(`/v1/admin/cities/${edit.id}`, { method: "PATCH", body: {
      timezone: edit.timezone,
      default_geofence_m: edit.default_geofence_m,
      coldstart_days: edit.coldstart_days,
      coldstart_min_events: edit.coldstart_min_events,
    } });
    setBusy(false);
    if (r.ok) { setNote("Saved."); setEdit(null); void load(); return; }
    setNote(r.error?.message ?? "Could not save.");
  }

  async function launch(c: AdminCity) {
    setBusy(true); setNote(null);
    const r = await api(`/v1/admin/cities/${c.id}`, { method: "PATCH", body: { active: true } });
    setBusy(false);
    if (r.ok) { setNote(`${c.name} launched.`); void load(); return; }
    setNote(r.error?.message ?? "Could not launch.");
  }

  return (
    <div className="op-page stack">
      <h1 className="op-title">Cities</h1>
      {note && <p className="muted">{note}</p>}
      {cities === null ? <p className="op-empty">Loading.</p> : (
        <div className="op-table-wrap">
          <table className="op-table">
            <thead><tr><th>City</th><th>Timezone</th><th className="op-num">Radius (m)</th><th className="op-num">Cold-start days</th><th className="op-num">Event threshold</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {cities.map((c) => (
                <tr key={c.id}>
                  <td className="op-cell-title">{c.name}, {c.region}</td>
                  <td>{c.timezone}</td>
                  <td className="op-num data">{c.default_geofence_m}</td>
                  <td className="op-num data">{c.coldstart_days}</td>
                  <td className="op-num data">{c.coldstart_min_events}</td>
                  <td>{c.active ? <span className="op-status" data-status="live">launched</span> : <span className="muted">unlaunched</span>}</td>
                  <td className="op-actions">
                    <button className="op-link" onClick={() => setEdit(c)}>Configure</button>
                    {!c.active && <button className="op-link" disabled={busy} onClick={() => launch(c)}>Launch</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <form className="op-panel stack op-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="op-page-head"><h2 className="op-section">Configure {edit.name}</h2><button type="button" className="op-link" onClick={() => setEdit(null)}>Cancel</button></div>
          <div className="op-form-grid">
            <div><label htmlFor="tz">Timezone (IANA)</label><input id="tz" value={edit.timezone} onChange={(e) => setEdit({ ...edit, timezone: e.target.value })} /></div>
            <div><label htmlFor="gf">Radius (m)</label><input id="gf" type="number" min={1} value={edit.default_geofence_m} onChange={(e) => setEdit({ ...edit, default_geofence_m: Number(e.target.value) })} /></div>
            <div><label htmlFor="cd">Cold-start days</label><input id="cd" type="number" min={0} value={edit.coldstart_days} onChange={(e) => setEdit({ ...edit, coldstart_days: Number(e.target.value) })} /></div>
            <div><label htmlFor="ce">Event threshold</label><input id="ce" type="number" min={0} value={edit.coldstart_min_events} onChange={(e) => setEdit({ ...edit, coldstart_min_events: Number(e.target.value) })} /></div>
          </div>
          <div className="op-form-actions"><button type="submit" className="btn-catch" disabled={busy}>Save</button></div>
        </form>
      )}
    </div>
  );
}
