"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/**
 * O2 — staff seats (owner only; the route is requireOwner). A seat is scoped to
 * one location and grants the Today's-Code + redemption-feed view there, nothing
 * more (PRD §13.6). Staff are added by handle — the platform's one
 * recipient-identity primitive, the same the transfer flow uses — never by a
 * raw id. There is no seat-removal endpoint in v1, so none is shown.
 */

interface StaffSeat {
  user_id: string; handle: string; display_name: string; location_id: string; granted_at: string;
}
interface Loc { id: string; name: string }

export function StaffManager({ orgId, locations }: { orgId: string; locations: Loc[] }) {
  const [staff, setStaff] = useState<StaffSeat[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [handle, setHandle] = useState("");
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "a location";

  const load = async () => {
    const r = await api<{ staff: StaffSeat[] }>(`/v1/orgs/${orgId}/staff`);
    if (r.ok && r.data) setStaff(r.data.staff);
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<{ staff: StaffSeat[] }>(`/v1/orgs/${orgId}/staff`);
      if (alive && r.ok && r.data) setStaff(r.data.staff);
    })();
    return () => { alive = false; };
  }, [orgId]);

  async function add() {
    setErr(null);
    const loc = locationId || locations[0]?.id;
    if (!handle.trim() || !loc) { setErr("Enter a handle and choose a location."); return; }
    setBusy(true);
    const r = await api(`/v1/orgs/${orgId}/staff`, {
      method: "POST",
      body: { to_handle: handle.trim().toLowerCase(), location_id: loc },
    });
    setBusy(false);
    if (r.ok) { setHandle(""); setShowForm(false); void load(); return; }
    setErr(r.error?.message ?? "Could not add the staff seat.");
  }

  return (
    <div className="stack">
      <div className="op-page-head">
        <h2 className="op-section">Staff</h2>
        <button className="btn-catch op-new-btn" onClick={() => { setShowForm((s) => !s); setErr(null); }}>Add staff</button>
      </div>

      <ul className="op-loc-list">
        {(staff ?? []).map((s) => (
          <li key={s.user_id + s.location_id} className="op-loc">
            <div>
              <span className="op-loc-name">{s.handle}</span>
              <span className="muted"> · {s.display_name} · {locName(s.location_id)}</span>
            </div>
          </li>
        ))}
        {staff !== null && staff.length === 0 && <li className="op-empty">No staff yet.</li>}
      </ul>

      {showForm && (
        <form className="stack op-form op-panel" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <div>
            <label htmlFor="staff-handle">Handle</label>
            <input id="staff-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="theirhandle" />
          </div>
          <div>
            <label htmlFor="staff-loc">Location</label>
            <select id="staff-loc" value={locationId || locations[0]?.id || ""} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          {err && <p className="field-error">{err}</p>}
          <div className="op-form-actions">
            <button type="submit" className="btn-catch" disabled={busy}>Add</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
