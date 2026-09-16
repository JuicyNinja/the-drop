"use client";

import { useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/**
 * Merchant self-onboarding (POST /v1/orgs). Self-serve tiers only; Enterprise is
 * arranged with an administrator (per-account limits) and is not offered here.
 * Limits are seeded from the tier catalog at creation, never derived later.
 */

const TIERS = [
  { tier: "local_starter", label: "Starter", detail: "2 drops / cycle · 1 location", price: "$99/mo" },
  { tier: "local_limited", label: "Limited", detail: "8 drops / cycle · 1 location", price: "$149/mo" },
  { tier: "local_boss", label: "Boss", detail: "12 drops / cycle · 1 location", price: "$199/mo" },
  { tier: "local_superstar", label: "Superstar", detail: "64 drops / cycle · 8 locations, pooled", price: "$795/mo" },
];

export function CreateOrgForm({ onCreated, onCancel }: { onCreated: (orgId: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState("local_starter");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!name.trim()) { setErr("Name your business."); return; }
    setBusy(true);
    const r = await api<{ id: string }>("/v1/orgs", { method: "POST", body: { name: name.trim(), tier } });
    setBusy(false);
    if (r.ok && r.data) { onCreated(r.data.id); return; }
    setErr(r.error?.message ?? "Could not create the business.");
  }

  return (
    <form className="stack op-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div>
        <label htmlFor="org-name">Business name</label>
        <input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
      </div>
      <div>
        <label>Plan</label>
        <div className="op-plans">
          {TIERS.map((t) => (
            <button
              type="button"
              key={t.tier}
              className="op-plan op-plan-pick"
              data-selected={tier === t.tier}
              onClick={() => setTier(t.tier)}
            >
              <span className="op-plan-tier">{t.label}</span>
              <span className="op-plan-detail muted">{t.detail}</span>
              <span className="op-plan-price data">{t.price}</span>
            </button>
          ))}
        </div>
        <p className="muted">More than Superstar? Enterprise plans are arranged directly.</p>
      </div>
      {err && <p className="field-error">{err}</p>}
      <div className="op-form-actions">
        <button type="submit" className="btn-catch" disabled={busy}>Create business</button>
        {onCancel && <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
