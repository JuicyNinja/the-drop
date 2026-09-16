"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { useBuyer, type Address } from "../_lib/buyer";

/**
 * Address management (WP-4 API, PRD §8): add, edit, delete, set active, and the
 * per-address discovery radius. Home is undeletable and is the fallback when the
 * active address is deleted (both enforced server-side; the UI mirrors them).
 * A drift suggestion (advisory only, never a silent switch) surfaces when the
 * device is far from the active address and nearer a saved one.
 */

interface FormState {
  label: string; line1: string; line2: string; city: string; region: string; postal_code: string; radius_miles: number;
}

const blank: FormState = { label: "", line1: "", line2: "", city: "", region: "", postal_code: "", radius_miles: 10 };

function toForm(a: Address): FormState {
  return { label: a.label, line1: a.line1, line2: a.line2 ?? "", city: a.city, region: a.region, postal_code: a.postal_code, radius_miles: a.radius_miles };
}

interface Drift {
  suggested_address_id: string | null;
  suggested_label: string | null;
  message: string | null;
}

export function AddressManager() {
  const { addresses, activeId, refresh } = useBuyer();
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drift, setDrift] = useState<Drift | null>(null);

  // Advisory drift check: read the device position and ask the server whether a
  // different saved address is materially closer. Never switches anything.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let alive = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void (async () => {
          const { latitude, longitude } = pos.coords;
          const r = await api<Drift & { drift_detected: boolean }>(`/v1/users/me/location-drift?lat=${latitude}&lng=${longitude}`);
          if (alive && r.ok && r.data?.drift_detected) setDrift(r.data);
        })();
      },
      () => { /* permission denied or no fix: no suggestion, never blocks */ },
      { timeout: 7000 },
    );
    return () => { alive = false; };
  }, []);

  function openNew() { setForm(blank); setEditing("new"); setErr(null); }
  function openEdit(a: Address) { setForm(toForm(a)); setEditing(a); setErr(null); }

  async function setActive(id: string) {
    setBusy(true); setErr(null);
    const r = await api("/v1/users/me/active-address", { method: "PUT", body: { address_id: id } });
    setBusy(false);
    if (r.ok) { setDrift(null); await refresh(); return; }
    setErr(r.error?.message ?? "Could not switch active address.");
  }

  async function del(a: Address) {
    setBusy(true); setErr(null);
    const r = await api(`/v1/addresses/${a.id}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) { await refresh(); return; }
    setErr(r.error?.message ?? "Could not delete.");
  }

  async function save() {
    setErr(null);
    if (!form.label.trim() || !form.line1.trim() || !form.city.trim() || !form.region.trim() || !form.postal_code.trim()) {
      setErr("Label, address, city, region, and postal code are required."); return;
    }
    const body: Record<string, unknown> = {
      label: form.label.trim(), line1: form.line1.trim(), city: form.city.trim(),
      region: form.region.trim(), postal_code: form.postal_code.trim(), radius_miles: form.radius_miles,
    };
    if (form.line2.trim()) body.line2 = form.line2.trim();
    setBusy(true);
    const r = editing === "new"
      ? await api("/v1/addresses", { method: "POST", body })
      : await api(`/v1/addresses/${(editing as Address).id}`, { method: "PATCH", body });
    setBusy(false);
    if (r.ok) { setEditing(null); await refresh(); return; }
    setErr(r.error?.message ?? "Could not save the address.");
  }

  return (
    <div className="stack">
      <div className="addr-head">
        <p className="you-panel-label muted">Addresses</p>
        <button className="btn-secondary addr-add" onClick={openNew}>Add address</button>
      </div>

      {drift && drift.suggested_address_id && (
        <div className="addr-drift">
          <span>{drift.message ?? "A saved address is closer to you."}</span>
          <button className="btn-catch addr-drift-btn" disabled={busy} onClick={() => setActive(drift.suggested_address_id!)}>
            Switch to {drift.suggested_label}
          </button>
        </div>
      )}

      {err && <p className="field-error">{err}</p>}

      <ul className="addr-list">
        {addresses.map((a) => {
          const isActive = a.id === activeId;
          return (
            <li key={a.id} className="addr" data-active={isActive}>
              <div className="addr-body">
                <div className="addr-line">
                  <span className="addr-label">{a.label}</span>
                  {a.is_home && <span className="addr-tag">Home</span>}
                  {isActive && <span className="addr-tag addr-tag-active">Active</span>}
                </div>
                <p className="muted addr-formatted">{a.formatted_address ?? `${a.line1}, ${a.city}, ${a.region}`}</p>
                <p className="muted addr-radius">Radius {a.radius_miles} mi</p>
              </div>
              <div className="addr-actions">
                {!isActive && <button className="op-link" disabled={busy} onClick={() => setActive(a.id)}>Set active</button>}
                <button className="op-link" disabled={busy} onClick={() => openEdit(a)}>Edit</button>
                {/* Home is undeletable (server-enforced); no delete control for it. */}
                {!a.is_home && <button className="op-link" disabled={busy} onClick={() => del(a)}>Delete</button>}
              </div>
            </li>
          );
        })}
        {addresses.length === 0 && <li className="muted">No addresses yet.</li>}
      </ul>

      {editing !== null && (
        <form className="addr-form stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <p className="you-panel-label muted">{editing === "new" ? "New address" : `Edit ${(editing as Address).label}`}</p>
          <div><label htmlFor="a-label">Label</label><input id="a-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Home, Work, …" /></div>
          <div><label htmlFor="a-line1">Address</label><input id="a-line1" value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} /></div>
          <div><label htmlFor="a-line2">Address line 2</label><input id="a-line2" value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} /></div>
          <div className="addr-form-grid">
            <div><label htmlFor="a-city">City</label><input id="a-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div><label htmlFor="a-region">Region</label><input id="a-region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></div>
            <div><label htmlFor="a-postal">Postal code</label><input id="a-postal" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></div>
          </div>
          <div>
            <label htmlFor="a-radius">Discovery radius: {form.radius_miles} mi</label>
            <input id="a-radius" type="range" min={1} max={60} value={form.radius_miles} onChange={(e) => setForm({ ...form, radius_miles: Number(e.target.value) })} />
          </div>
          <div className="row">
            <button type="submit" className="btn-catch" disabled={busy}>{editing === "new" ? "Add" : "Save"}</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
