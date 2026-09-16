"use client";

import { useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/**
 * SMS phone verification (API-CONTRACT §2, PRD §3.4). Sends a code to the
 * account's registered phone, then confirms it — the defense against burner
 * clout farming. Reused at registration and from the You screen.
 */
export function PhoneVerify({ onVerified, onSkip }: { onVerified: () => void; onSkip?: () => void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true); setErr(null);
    const r = await api("/v1/auth/phone/verify/send", { method: "POST" });
    setBusy(false);
    if (r.ok) { setSent(true); return; }
    setErr(r.error?.code === "RATE_LIMITED" ? "Too many codes requested. Try again later." : (r.error?.message ?? "Could not send a code."));
  }

  async function confirm() {
    setBusy(true); setErr(null);
    const r = await api("/v1/auth/phone/verify/confirm", { method: "POST", body: { code: code.trim() } });
    setBusy(false);
    if (r.ok) { onVerified(); return; }
    setErr(r.error?.message ?? "Incorrect code.");
  }

  return (
    <div className="stack phone-verify">
      {!sent ? (
        <>
          <p className="muted">We&apos;ll text a 6-digit code to the phone on your account.</p>
          <div className="row">
            <button className="btn-catch" disabled={busy} onClick={send}>Send code</button>
            {onSkip && <button className="btn-secondary" disabled={busy} onClick={onSkip}>Later</button>}
          </div>
        </>
      ) : (
        <>
          <div>
            <label htmlFor="sms-code">Enter the code</label>
            <input id="sms-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
          </div>
          <div className="row">
            <button className="btn-catch" disabled={busy || code.trim().length < 4} onClick={confirm}>Verify</button>
            <button className="btn-secondary" disabled={busy} onClick={send}>Resend</button>
            {onSkip && <button className="op-link" disabled={busy} onClick={onSkip}>Later</button>}
          </div>
        </>
      )}
      {err && <p className="field-error">{err}</p>}
    </div>
  );
}
