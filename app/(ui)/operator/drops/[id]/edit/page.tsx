"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { useOperator } from "../../../_lib/shell";
import { toLocalInput, fromLocalInput } from "../../../_lib/datetime";
import { Paywall, type AllowanceDetails } from "../../../_lib/Paywall";
import { RedeemWindowField, redeemWindowBody, type RedeemWindowValue } from "../../../_lib/RedeemWindow";

/**
 * Edit drop. Reaches draft/scheduled only — a live drop is immutable
 * (DROP_IMMUTABLE, invariant #3). Fields pre-fill from the operator drops list.
 * A draft can be scheduled (consumes allowance; 402 → paywall); a scheduled drop
 * can be pulled back to draft (allowance is not restored — the counter never goes
 * up, invariant #2).
 */

interface OperatorDrop {
  id: string; title: string; description: string; terms: string | null; status: string;
  quantity_total: number; location_id: string | null;
  live_at: string | null; live_until: string | null; redeem_from: string | null; redeem_until: string | null;
  redeem_days: number[] | null; redeem_time_start: string | null; redeem_time_end: string | null;
}

/** "HH:MM:SS" or "HH:MM" → "HH:MM" for the <input type="time"> value. */
function toTimeInput(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

export default function EditDropPage() {
  const { org } = useOperator();
  const router = useRouter();
  const id = useParams<{ id: string }>().id;

  const [drop, setDrop] = useState<OperatorDrop | null | "missing">(null);
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
  const [note, setNote] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<{ message: string; details: AllowanceDetails } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<OperatorDrop[]>(`/v1/orgs/${org.org_id}/drops`);
      if (!alive) return;
      const found = (r.ok && r.data ? r.data : []).find((d) => d.id === id) ?? null;
      if (!found) { setDrop("missing"); return; }
      setDrop(found);
      setTitle(found.title);
      setDescription(found.description);
      setTerms(found.terms ?? "");
      setQuantity(String(found.quantity_total));
      setLiveAt(toLocalInput(found.live_at));
      setLiveUntil(toLocalInput(found.live_until));
      setRedeemFrom(toLocalInput(found.redeem_from));
      setRedeemUntil(toLocalInput(found.redeem_until));
      setWindow({
        days: found.redeem_days ?? [],
        start: toTimeInput(found.redeem_time_start),
        end: toTimeInput(found.redeem_time_end),
      });
    })();
    return () => { alive = false; };
  }, [id, org.org_id]);

  if (drop === null) return <div className="op-page op-empty">Loading.</div>;
  if (drop === "missing") return <div className="op-page op-empty">No such drop on this business.</div>;

  const immutable = drop.status !== "draft" && drop.status !== "scheduled";

  function fieldBody(): Record<string, unknown> {
    const qty = Number(quantity);
    const body: Record<string, unknown> = {
      title: title.trim(), description: description.trim(),
      terms: terms.trim() ? terms.trim() : null, quantity_total: qty,
    };
    body.live_at = fromLocalInput(liveAt) ?? null;
    body.live_until = fromLocalInput(liveUntil) ?? null;
    body.redeem_from = fromLocalInput(redeemFrom) ?? null;
    body.redeem_until = fromLocalInput(redeemUntil) ?? null;
    return body;
  }

  async function saveFields() {
    setErr(null); setNote(null);
    const qty = Number(quantity);
    if (!title.trim() || !description.trim()) { setErr("Title and description are required."); return; }
    if (!Number.isInteger(qty) || qty < 1) { setErr("Quantity must be a whole number, at least one."); return; }
    const win = redeemWindowBody(window, true); // clear a prior recurring window when the days are emptied
    if (!win.ok) { setErr(win.error); return; }
    setBusy(true);
    const r = await api(`/v1/drops/${id}`, { method: "PATCH", body: { ...fieldBody(), ...win.body } });
    setBusy(false);
    if (r.ok) { setNote("Saved."); return; }
    setErr(r.error?.message ?? "Could not save.");
  }

  async function transition(status: "scheduled" | "draft") {
    setErr(null); setNote(null); setPaywall(null);
    setBusy(true);
    const r = await api(`/v1/drops/${id}`, { method: "PATCH", body: { status } });
    setBusy(false);
    if (r.ok) { router.push("/operator/drops"); return; }
    if (r.error?.code === "ALLOWANCE_EXHAUSTED") {
      setPaywall({ message: r.error.message, details: (r.error.details ?? {}) as AllowanceDetails });
      return;
    }
    setErr(r.error?.message ?? "Could not update.");
  }

  return (
    <div className="op-page op-form-page stack">
      <h1 className="op-title">Edit drop</h1>
      <p className="muted">{org.locations.find((l) => l.id === drop.location_id)?.name ?? "—"} · {drop.status}</p>

      {immutable && <p className="op-empty">This drop is {drop.status} and can no longer be edited.</p>}

      {!immutable && (
        <form className="stack op-form" onSubmit={(e) => { e.preventDefault(); void saveFields(); }}>
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
            <div><label htmlFor="la">Live from</label><input id="la" type="datetime-local" value={liveAt} onChange={(e) => setLiveAt(e.target.value)} /></div>
            <div><label htmlFor="lu">Live until</label><input id="lu" type="datetime-local" value={liveUntil} onChange={(e) => setLiveUntil(e.target.value)} /></div>
            <div><label htmlFor="rf">Redeem from</label><input id="rf" type="datetime-local" value={redeemFrom} onChange={(e) => setRedeemFrom(e.target.value)} /></div>
            <div><label htmlFor="ru">Redeem until</label><input id="ru" type="datetime-local" value={redeemUntil} onChange={(e) => setRedeemUntil(e.target.value)} /></div>
          </div>

          <RedeemWindowField value={window} onChange={setWindow} />

          {err && <p className="field-error">{err}</p>}
          {note && <p className="muted">{note}</p>}

          <div className="op-form-actions">
            <button type="submit" className="btn-secondary" disabled={busy}>Save</button>
            {drop.status === "draft" && <button type="button" className="btn-catch" disabled={busy} onClick={() => void transition("scheduled")}>Schedule</button>}
            {drop.status === "scheduled" && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void transition("draft")}>Return to draft</button>}
          </div>
        </form>
      )}

      {paywall && (
        <Paywall orgId={org.org_id} message={paywall.message} details={paywall.details} onUpgraded={() => { setPaywall(null); void transition("scheduled"); }} />
      )}
    </div>
  );
}
