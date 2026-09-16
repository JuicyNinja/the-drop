"use client";

import { useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { WHISPER_DIMENSIONS as DIMENSIONS } from "@/lib/whisper-dimensions";

/**
 * Whisper submission (API-CONTRACT §9, PRD §10.5): private post-redemption
 * feedback, anchored on "would you return at full price". One per redemption;
 * earns clout and feeds the merchant score. Dimension names live in
 * lib/whisper-dimensions.ts so this form and the operator read-view agree.
 */

export function WhisperForm({ redemptionId, onDone }: { redemptionId: string; onDone: (cloutEarned: number) => void }) {
  const [wouldReturn, setWouldReturn] = useState<boolean | null>(null);
  const [dims, setDims] = useState<{ dim_2: number; dim_3: number; dim_4: number }>({ dim_2: 4, dim_3: 4, dim_4: 4 });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (wouldReturn === null) { setErr("Answer whether you'd return at full price."); return; }
    setBusy(true); setErr(null);
    const r = await api<{ clout_earned: number }>("/v1/whispers", {
      method: "POST",
      body: { redemption_id: redemptionId, would_return_at_full_price: wouldReturn, ...dims, note: note.trim() || undefined },
    });
    setBusy(false);
    if (r.ok && r.data) { onDone(r.data.clout_earned); return; }
    setErr(r.error?.message ?? "Could not send your whisper.");
  }

  return (
    <form className="whisper-form stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="whisper-anchor">Would you return at full price?</p>
      <div className="row">
        <button type="button" className="btn-secondary" data-selected={wouldReturn === true} onClick={() => setWouldReturn(true)}>Yes</button>
        <button type="button" className="btn-secondary" data-selected={wouldReturn === false} onClick={() => setWouldReturn(false)}>No</button>
      </div>
      {DIMENSIONS.map((d) => (
        <div key={d.key}>
          <label htmlFor={d.key}>{d.label}: {dims[d.key]}</label>
          <input id={d.key} type="range" min={1} max={5} value={dims[d.key]} onChange={(e) => setDims({ ...dims, [d.key]: Number(e.target.value) })} />
        </div>
      ))}
      <div>
        <label htmlFor="whisper-note">Anything to add (private to the merchant)</label>
        <textarea id="whisper-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
      </div>
      {err && <p className="field-error">{err}</p>}
      <button type="submit" className="btn-catch" disabled={busy}>Send whisper</button>
    </form>
  );
}
