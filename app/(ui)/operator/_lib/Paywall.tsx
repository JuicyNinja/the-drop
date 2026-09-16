"use client";

import { useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/**
 * The allowance paywall (API-CONTRACT §10). Shown when a control returns 402
 * ALLOWANCE_EXHAUSTED — the paywall is the pitch, so the control that triggered
 * it (Add Location, New drop) is never hidden; the wall fires on use. Upgrade is
 * one click, prorated, and unblocks in the same cycle. No overage path exists —
 * that would rebuild volume-based revenue (invariant #1). Enterprise is a
 * contact, never a self-serve purchase.
 */

interface UpgradeOption {
  tier: string;
  drops_per_cycle?: number;
  max_locations?: number;
  price_cents: number;
  prorated_now_cents: number;
}

export interface AllowanceDetails {
  current_tier?: string;
  drops_used?: number;
  drops_per_cycle?: number;
  max_locations?: number;
  cycle_ends_at?: string;
  upgrade_options?: UpgradeOption[];
  enterprise_contact?: boolean;
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const tierName = (t: string) => t.replace(/^local_/, "").replace(/\b\w/g, (c) => c.toUpperCase());

export function Paywall({ orgId, message, details, onUpgraded }: {
  orgId: string;
  message: string;
  details: AllowanceDetails;
  onUpgraded: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const options = details.upgrade_options ?? [];

  async function upgrade(target: string) {
    setBusy(target); setErr(null);
    const r = await api(`/v1/orgs/${orgId}/subscription/upgrade`, { method: "POST", body: { target_tier: target } });
    setBusy(null);
    if (r.ok) { onUpgraded(); return; }
    setErr(r.error?.message ?? "Upgrade did not go through.");
  }

  return (
    <div className="op-paywall stack" role="group" aria-label="Plan limit reached">
      <p className="op-paywall-msg">{message}</p>
      {err && <p className="field-error">{err}</p>}
      {options.length > 0 && (
        <div className="op-plans">
          {options.map((o) => (
            <div key={o.tier} className="op-plan">
              <p className="op-plan-tier">{tierName(o.tier)}</p>
              <p className="op-plan-detail muted">
                {o.drops_per_cycle !== undefined ? `${o.drops_per_cycle} drops / cycle` : null}
                {o.max_locations !== undefined ? `${o.max_locations} locations` : null}
              </p>
              <p className="op-plan-price data">{dollars(o.price_cents)}<span className="op-plan-per">/mo</span></p>
              <p className="op-plan-now muted">{dollars(o.prorated_now_cents)} now, prorated</p>
              <button className="btn-catch" disabled={busy !== null} onClick={() => upgrade(o.tier)}>
                {busy === o.tier ? "Upgrading" : "Upgrade"}
              </button>
            </div>
          ))}
        </div>
      )}
      {details.enterprise_contact && (
        <p className="muted">For more, Enterprise plans are arranged directly.</p>
      )}
    </div>
  );
}
