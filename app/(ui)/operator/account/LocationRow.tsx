"use client";

import { useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/** One location row on Account: edit (name/address/geofence radius) and
 *  deactivate (soft delete — drops reference the row, so it is kept). O3 / O4. */

export interface OpLocation {
  id: string; name: string; line1: string; line2: string | null;
  city: string; region: string; postal_code: string; geofence_radius_m: number; active: boolean;
}

export function LocationRow({ loc, onChanged }: { loc: OpLocation; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    name: loc.name, line1: loc.line1, city: loc.city, region: loc.region,
    postal_code: loc.postal_code, geofence_radius_m: loc.geofence_radius_m,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function save() {
    setBusy(true); setErr(null);
    const r = await api(`/v1/locations/${loc.id}`, { method: "PATCH", body: f });
    setBusy(false);
    if (r.ok) { setEditing(false); onChanged(); return; }
    setErr(r.error?.message ?? "Could not save.");
  }
  async function deactivate() {
    setBusy(true); setErr(null);
    const r = await api(`/v1/locations/${loc.id}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) { onChanged(); return; }
    setErr(r.error?.message ?? "Could not deactivate.");
  }

  if (editing) {
    return (
      <li className="op-loc op-panel">
        <form className="stack op-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div><label htmlFor={`n-${loc.id}`}>Name</label><input id={`n-${loc.id}`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label htmlFor={`a-${loc.id}`}>Address</label><input id={`a-${loc.id}`} value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} /></div>
          <div className="op-form-grid">
            <div><label htmlFor={`c-${loc.id}`}>City</label><input id={`c-${loc.id}`} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
            <div><label htmlFor={`r-${loc.id}`}>Region</label><input id={`r-${loc.id}`} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} /></div>
            <div><label htmlFor={`p-${loc.id}`}>Postal code</label><input id={`p-${loc.id}`} value={f.postal_code} onChange={(e) => setF({ ...f, postal_code: e.target.value })} /></div>
            <div><label htmlFor={`g-${loc.id}`}>Geofence (m)</label><input id={`g-${loc.id}`} type="number" min={1} value={f.geofence_radius_m} onChange={(e) => setF({ ...f, geofence_radius_m: Number(e.target.value) })} /></div>
          </div>
          {err && <p className="field-error">{err}</p>}
          <div className="op-form-actions">
            <button type="submit" className="btn-catch" disabled={busy}>Save</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="op-loc">
      <div>
        <span className="op-loc-name">{loc.name}</span>
        <span className="muted"> · {loc.line1}, {loc.city}, {loc.region} · geofence {loc.geofence_radius_m}m</span>
      </div>
      <div className="op-actions">
        <button className="op-link" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
        {confirming ? (
          <>
            <button className="op-link" disabled={busy} onClick={deactivate}>Confirm deactivate</button>
            <button className="op-link" disabled={busy} onClick={() => setConfirming(false)}>No</button>
          </>
        ) : (
          <button className="op-link" disabled={busy} onClick={() => setConfirming(true)}>Deactivate</button>
        )}
      </div>
      {err && <p className="field-error">{err}</p>}
    </li>
  );
}
