"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { useOperator } from "../../_lib/shell";
import { fromLocalInput } from "../../_lib/datetime";
import { Paywall, type AllowanceDetails } from "../../_lib/Paywall";
import { RedeemWindowField, redeemWindowBody, type RedeemWindowValue } from "../../_lib/RedeemWindow";

/**
 * New drop — entered from a location (API-CONTRACT §10; a bare drop form is never
 * the entry). Local drops go draft → scheduled directly. Publish schedules
 * immediately and consumes allowance; at the cap the response is 402 and the
 * paywall appears in place — the button is never hidden.
 */
export default function NewDropPage() {
  const { org } = useOperator();
  const router = useRouter();
  const params = useSearchParams();
  const presetLoc = params.get("location");

  const [locationId, setLocationId] = useState(presetLoc && org.locations.some((l) => l.id === presetLoc) ? presetLoc : org.locations[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [terms, setTerms] = useState("");
  const [quantity, setQuantity] = useState("");
  const [liveAt, setLiveAt] = useState("");
  const [liveUntil, setLiveUntil] = useState("");
  const [redeemFrom, setRedeemFrom] = useState("");
  const [redeemUntil, setRedeemUntil] = useState("");
  const [window, setWindow] = useState<RedeemWindowValue>({ days: [], start: "", end: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<{ message: string; details: AllowanceDetails } | null>(null);

  async function submit(publish: boolean) {
    setErr(null); setPaywall(null);
    const qty = Number(quantity);
    if (!locationId) { setErr("Choose a location."); return; }
    if (!title.trim() || !description.trim()) { setErr("Title and description are required."); return; }
    if (!Number.isInteger(qty) || qty < 1) { setErr("Quantity must be a whole number, at least one."); return; }
    const win = redeemWindowBody(window, false);
    if (!win.ok) { setErr(win.error); return; }

    setBusy(true);
    const body: Record<string, unknown> = {
      location_id: locationId,
      title: title.trim(),
      description: description.trim(),
      quantity_total: qty,
      publish,
      ...win.body,
    };
    if (terms.trim()) body.terms = terms.trim();
    const live_at = fromLocalInput(liveAt); if (live_at) body.live_at = live_at;
    const live_until = fromLocalInput(liveUntil); if (live_until) body.live_until = live_until;
    const redeem_from = fromLocalInput(redeemFrom); if (redeem_from) body.redeem_from = redeem_from;
    const redeem_until = fromLocalInput(redeemUntil); if (redeem_until) body.redeem_until = redeem_until;

    const r = await api<{ id: string }>("/v1/drops", { method: "POST", body });
    setBusy(false);
    if (r.ok && r.data) { router.push("/operator/drops"); return; }
    if (r.error?.code === "ALLOWANCE_EXHAUSTED") {
      setPaywall({ message: r.error.message, details: (r.error.details ?? {}) as AllowanceDetails });
      return;
    }
    setErr(r.error?.message ?? "Could not create the drop.");
  }

  return (
    <div className="op-page op-form-page stack">
      <h1 className="op-title">New drop</h1>

      <form className="stack op-form" onSubmit={(e) => { e.preventDefault(); void submit(false); }}>
        <div>
          <label htmlFor="loc">Location</label>
          <select id="loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {org.locations.length === 0 && <option value="">No locations — add one in Account</option>}
            {org.locations.map((l) => <option key={l.id} value={l.id}>{l.name}, {l.city}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="title">Title</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
        </div>
        <div>
          <label htmlFor="desc">Description</label>
          <textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} />
        </div>
        <div>
          <label htmlFor="terms">Terms</label>
          <textarea id="terms" value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={4000} rows={2} />
        </div>
        <div>
          <label htmlFor="qty">Quantity</label>
          <input id="qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" />
        </div>
        <div className="op-form-grid">
          <div>
            <label htmlFor="la">Live from</label>
            <input id="la" type="datetime-local" value={liveAt} onChange={(e) => setLiveAt(e.target.value)} />
          </div>
          <div>
            <label htmlFor="lu">Live until</label>
            <input id="lu" type="datetime-local" value={liveUntil} onChange={(e) => setLiveUntil(e.target.value)} />
          </div>
          <div>
            <label htmlFor="rf">Redeem from</label>
            <input id="rf" type="datetime-local" value={redeemFrom} onChange={(e) => setRedeemFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ru">Redeem until</label>
            <input id="ru" type="datetime-local" value={redeemUntil} onChange={(e) => setRedeemUntil(e.target.value)} />
          </div>
        </div>

        <RedeemWindowField value={window} onChange={setWindow} />

        {err && <p className="field-error">{err}</p>}

        <div className="op-form-actions">
          <button type="submit" className="btn-secondary" disabled={busy}>Save draft</button>
          <button type="button" className="btn-catch" disabled={busy} onClick={() => void submit(true)}>Publish</button>
        </div>
      </form>

      {paywall && (
        <Paywall orgId={org.org_id} message={paywall.message} details={paywall.details} onUpgraded={() => { setPaywall(null); void submit(true); }} />
      )}
    </div>
  );
}
