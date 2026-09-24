"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { useOperator } from "../_lib/shell";
import { Paywall, type AllowanceDetails } from "../_lib/Paywall";
import { LocationRow, type OpLocation } from "./LocationRow";
import { StaffManager } from "./StaffManager";
import { LogoUpload } from "./LogoUpload";

/**
 * Account and billing (API-CONTRACT §10). Limits are the org's stored values,
 * never derived from the tier enum. Add Location is ALWAYS visible at every tier
 * — the paywall fires on submit and never hides the control (gate item 2).
 */

interface AnnualOffer {
  annual_price_cents: number;
  annual_monthly_cents: number;
  intro_monthly_cents: number;
  intro_months: number;
  year_total_cents: number;
}
interface Billing {
  tier: string;
  max_locations: number;
  drops_per_cycle: number;
  drops_pooled_org_level: boolean;
  active_locations: number;
  cycle: { start: string; end: string };
  billing_interval: "monthly" | "annual";
  annual_offer: AnnualOffer | null;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
type Location = OpLocation;

const tierName = (t: string) => t.replace(/^local_/, "").replace(/\b\w/g, (c) => c.toUpperCase());
const date = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

export default function AccountPage() {
  const { org } = useOperator();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Add-location form
  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postal, setPostal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<{ message: string; details: AllowanceDetails } | null>(null);
  const [annualBusy, setAnnualBusy] = useState(false);
  const [annualNote, setAnnualNote] = useState<string | null>(null);

  const load = async () => {
    const [b, l] = await Promise.all([
      api<Billing>(`/v1/orgs/${org.org_id}/billing`),
      api<{ locations: Location[] }>(`/v1/orgs/${org.org_id}/locations`),
    ]);
    if (b.ok && b.data) setBilling(b.data);
    if (l.ok && l.data) setLocations(l.data.locations ?? []);
  };
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [b, l] = await Promise.all([
        api<Billing>(`/v1/orgs/${org.org_id}/billing`),
        api<{ locations: Location[] }>(`/v1/orgs/${org.org_id}/locations`),
      ]);
      if (!alive) return;
      if (b.ok && b.data) setBilling(b.data);
      if (l.ok && l.data) setLocations(l.data.locations ?? []);
    })();
    return () => { alive = false; };
  }, [org.org_id]);

  async function goAnnual() {
    setAnnualBusy(true); setAnnualNote(null);
    const r = await api<{ charged_cents: number }>(`/v1/orgs/${org.org_id}/subscription/annual`, { method: "POST", idem: crypto.randomUUID() });
    setAnnualBusy(false);
    if (r.ok && r.data) { setAnnualNote(`You're on an annual contract. First charge: ${usd(r.data.charged_cents)}.`); void load(); return; }
    setAnnualNote(r.error?.message ?? "Could not switch to annual.");
  }

  async function addLocation() {
    setErr(null); setPaywall(null);
    if (!name.trim() || !line1.trim() || !city.trim() || !region.trim() || !postal.trim()) {
      setErr("Fill every field to add a location."); return;
    }
    setBusy(true);
    const r = await api(`/v1/orgs/${org.org_id}/locations`, {
      method: "POST",
      body: { name: name.trim(), line1: line1.trim(), city: city.trim(), region: region.trim(), postal_code: postal.trim() },
    });
    setBusy(false);
    if (r.ok) {
      setName(""); setLine1(""); setCity(""); setRegion(""); setPostal(""); setShowForm(false);
      void load();
      return;
    }
    if (r.error?.code === "ALLOWANCE_EXHAUSTED") {
      setPaywall({ message: r.error.message, details: (r.error.details ?? {}) as AllowanceDetails });
      return;
    }
    setErr(r.error?.message ?? "Could not add the location.");
  }

  return (
    <div className="op-page stack">
      <h1 className="op-title">Account</h1>

      {billing && (
        <div className="op-panel">
          <div className="op-billing-grid">
            <div><span className="op-stat-label">Plan</span><p className="op-billing-val">{tierName(billing.tier)}</p></div>
            <div><span className="op-stat-label">Drops / cycle</span><p className="op-billing-val data">{billing.drops_per_cycle}</p></div>
            <div><span className="op-stat-label">Locations</span><p className="op-billing-val data">{billing.active_locations} / {billing.max_locations}</p></div>
            <div><span className="op-stat-label">Allowance</span><p className="op-billing-val">{billing.drops_pooled_org_level ? "Pooled org-wide" : "Per location"}</p></div>
            <div><span className="op-stat-label">Cycle</span><p className="op-billing-val">{date(billing.cycle.start)} – {date(billing.cycle.end)}</p></div>
            <div><span className="op-stat-label">Billing</span><p className="op-billing-val">{billing.billing_interval === "annual" ? "Annual" : "Monthly"}</p></div>
          </div>
          {billing.annual_offer && (
            <div className="op-annual-offer">
              <p className="op-annual-pitch">
                Go annual — <strong>{usd(billing.annual_offer.intro_monthly_cents)}/mo for {billing.annual_offer.intro_months} months</strong>, then {usd(billing.annual_offer.annual_monthly_cents)}/mo. Two months free versus monthly; {usd(billing.annual_offer.year_total_cents)} the first year.
              </p>
              <button className="btn-catch" disabled={annualBusy} onClick={() => void goAnnual()}>Switch to annual</button>
            </div>
          )}
          {annualNote && <p className="op-annual-note">{annualNote}</p>}
        </div>
      )}

      <div className="stack">
        <div className="op-page-head">
          <h2 className="op-section">Locations</h2>
          {/* Always visible at every tier — the paywall is the pitch, not a hidden control. */}
          <button className="btn-catch op-new-btn" onClick={() => { setShowForm((s) => !s); setPaywall(null); }}>Add location</button>
        </div>

        <ul className="op-loc-list">
          {locations.map((l) => (
            <LocationRow key={l.id} loc={l} onChanged={() => void load()} />
          ))}
          {locations.length === 0 && <li className="op-empty">No locations yet.</li>}
        </ul>

        {showForm && (
          <form className="stack op-form op-panel" onSubmit={(e) => { e.preventDefault(); void addLocation(); }}>
            <div><label htmlFor="ln">Name</label><input id="ln" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label htmlFor="l1">Address</label><input id="l1" value={line1} onChange={(e) => setLine1(e.target.value)} /></div>
            <div className="op-form-grid">
              <div><label htmlFor="ci">City</label><input id="ci" value={city} onChange={(e) => setCity(e.target.value)} /></div>
              <div><label htmlFor="re">Region</label><input id="re" value={region} onChange={(e) => setRegion(e.target.value)} /></div>
              <div><label htmlFor="po">Postal code</label><input id="po" value={postal} onChange={(e) => setPostal(e.target.value)} /></div>
            </div>
            {err && <p className="field-error">{err}</p>}
            <div className="op-form-actions">
              <button type="submit" className="btn-catch" disabled={busy}>Add</button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        {paywall && (
          <Paywall orgId={org.org_id} message={paywall.message} details={paywall.details} onUpgraded={() => { setPaywall(null); void addLocation(); }} />
        )}
      </div>

      {/* Branding and staff are owner-managed; staff never see these (PRD §13.6). */}
      {org.role === "merchant_owner" && <LogoUpload orgId={org.org_id} name={org.name} />}
      {org.role === "merchant_owner" && (
        <StaffManager orgId={org.org_id} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />
      )}
    </div>
  );
}
