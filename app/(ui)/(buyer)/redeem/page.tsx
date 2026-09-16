"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { RequireAuth } from "@/components/RequireAuth";
import { Keypad } from "@/components/Keypad";
import { WhisperForm } from "@/app/(ui)/(buyer)/_lib/WhisperForm";

interface Catch { id: string; status: string; position_number: number; drop: { id: string; title: string } }

type Gps = { gps_status: "fix_acquired"; location: { lat: number; lng: number; accuracy_m: number } } | { gps_status: "no_fix_timeout" } | { gps_status: "permission_denied" };

/** Resolve GPS the two-path way (§7.4): a real fix, a 7s timeout (auto-redeem),
 *  or a permission denial (blocked). The client decides the status; the server
 *  is authoritative on the outcome. */
function getGps(): Promise<Gps> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ gps_status: "no_fix_timeout" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ gps_status: "fix_acquired", location: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy } }),
      (err) => resolve(err.code === err.PERMISSION_DENIED ? { gps_status: "permission_denied" } : { gps_status: "no_fix_timeout" }),
      { timeout: 7000, enableHighAccuracy: true },
    );
  });
}

interface Redeemed { redemption_id: string; clout_earned: number }

function Redeem() {
  const [catches, setCatches] = useState<Catch[]>([]);
  const [pick, setPick] = useState<Catch | null>(null);
  const [done, setDone] = useState<Redeemed | null>(null);
  const [whispered, setWhispered] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { (async () => { const r = await api<Catch[]>("/v1/catches?status=held"); if (r.ok && r.data) setCatches(r.data); })(); }, []);

  async function submit(code: string) {
    if (!pick || busy) return;
    setBusy(true); setError(null);
    const gps = await getGps();
    const r = await api<Redeemed & { redeemed: boolean }>("/v1/redemptions", {
      method: "POST",
      body: { catch_id: pick.id, code, ...gps },
      idem: (crypto as Crypto).randomUUID(),
    });
    setBusy(false);
    if (r.ok && r.data) { setDone({ redemption_id: r.data.redemption_id, clout_earned: r.data.clout_earned }); return; }
    setError(r.error?.code === "LOCATION_PERMISSION_REQUIRED" ? "Turn on location to redeem." : (r.error?.message ?? "That code didn't work."));
  }

  // Success: confirm the redemption, then invite a whisper (§10.5) — one of the
  // three clout sources and the merchant-score input.
  if (done) {
    return (
      <div className="page">
        <div className="redeem-sheet stack">
          <p className="display redeem-done">Redeemed. You earned {done.clout_earned} clout.</p>
          {whispered !== null ? (
            <>
              <p className="muted">Thanks for the whisper{whispered > 0 ? ` — +${whispered} clout.` : "."}</p>
              <a className="btn-secondary" href="/wallet">Called It</a>
            </>
          ) : (
            <>
              <p className="you-panel-label muted">Leave a whisper</p>
              <WhisperForm redemptionId={done.redemption_id} onDone={(c) => setWhispered(c)} />
              <a className="op-link" href="/wallet">Skip</a>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!pick) {
    return (
      <div className="page">
        <h1 className="board-title">Redeem</h1>
        {catches.length === 0 ? <p className="board-empty">Nothing to redeem.</p> : (
          <div className="wallet-list">
            {catches.map((c) => (
              <button key={c.id} className="wallet-card redeem-pick" onClick={() => setPick(c)}>
                <span className="wallet-pos data">{String(c.position_number).padStart(3, "0")}</span>
                <span className="wallet-title">{c.drop.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="redeem-sheet">
        <p className="redeem-prompt">Enter the code</p>
        <Keypad onComplete={submit} disabled={busy} />
        <p className="muted redeem-where">{pick.drop.title}</p>
        {error && <p className="field-error">{error}</p>}
        <button className="btn-secondary" onClick={() => { setPick(null); setError(null); }}>Back</button>
      </div>
    </div>
  );
}

export default function RedeemPage() {
  return <RequireAuth><Redeem /></RequireAuth>;
}
