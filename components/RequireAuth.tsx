"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, devSignIn, getSession } from "@/app/(ui)/_lib/api";
import { PhoneVerify } from "@/app/(ui)/(buyer)/_lib/PhoneVerify";
import { useHandleAvailability, handleHint } from "@/app/(ui)/_lib/useHandleAvailability";

interface Me { registration_complete?: boolean; phone_verified?: boolean }

/** Best-effort E.164 for a US number: 10 digits → +1XXXXXXXXXX. */
function toE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

/**
 * Session gate for authed surfaces. Reaches the product only through /v1. A
 * signed-out visitor gets a dev sign-in (production swaps in the real OAuth
 * redirect); a new account completes registration, then verifies its phone
 * (PRD §3.4 — SMS-verified accounts), then grants location.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"loading" | "signin" | "register" | "verify" | "ready">("loading");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // registration fields
  const [fullName, setFullName] = useState("");
  const [handle, setHandle] = useState("");
  const [phone, setPhone] = useState("");
  const handleStatus = useHandleAvailability(handle);
  const handleTaken = handleStatus === "taken";

  useEffect(() => {
    (async () => {
      if (!getSession()) { setPhase("signin"); return; }
      const me = await api<Me>("/v1/users/me");
      setPhase(me.ok && me.data ? "ready" : "signin");
    })();
  }, []);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await devSignIn(email.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.message ?? "Sign-in failed."); return; }
    if (r.registered) { setPhase("ready"); return; }
    setPhase("register");
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const reg = await api("/v1/auth/register/complete", {
      method: "POST",
      body: {
        full_name: fullName.trim(),
        handle: handle.trim().toLowerCase(),
        phone: toE164(phone),
        address: { label: "Home", line1: "1 S Main St", city: "Salt Lake City", region: "UT", postal_code: "84101" },
      },
    });
    if (!reg.ok) { setBusy(false); setErr(reg.error?.message ?? "Could not complete registration."); return; }
    await api("/v1/users/me/location-permission", { method: "POST", body: { granted: true } });
    setBusy(false);
    setPhase("verify");
  }

  if (phase === "ready") return <>{children}</>;
  if (phase === "loading") return <div className="page muted">Loading.</div>;

  return (
    <div className="page">
      <div className="auth-card stack">
        {phase === "signin" && (
          <form className="stack" onSubmit={onSignIn}>
            <h1 className="auth-title">Sign in</h1>
            <p className="muted">Enter your email to continue.</p>
            <div>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            {err && <p className="field-error">{err}</p>}
            <button className="btn-catch" disabled={busy || !email} type="submit">Continue</button>
          </form>
        )}

        {phase === "register" && (
          <form className="stack" onSubmit={onRegister}>
            <h1 className="auth-title">Finish your account</h1>
            <div>
              <label htmlFor="name">Name</label>
              <input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="handle">Handle</label>
              <input id="handle" value={handle} onChange={(e) => setHandle(e.target.value)} required aria-invalid={handleTaken} />
              {handleHint(handleStatus) && (
                <p className={`handle-hint handle-hint-${handleHint(handleStatus)!.tone}`}>{handleHint(handleStatus)!.text}</p>
              )}
            </div>
            <div>
              <label htmlFor="phone">Mobile number</label>
              <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(801) 555-0100" autoComplete="tel" required />
            </div>
            {err && <p className="field-error">{err}</p>}
            <button className="btn-catch" disabled={busy || !fullName || !handle || !phone || handleTaken} type="submit">Create account</button>
          </form>
        )}

        {phase === "verify" && (
          <div className="stack">
            <h1 className="auth-title">Verify your number</h1>
            <p className="muted">Verification is required to finish signing up (PRD §3.4).</p>
            {/* No skip: SMS verification is mandatory at signup, before return-to-intent (§3.5 step 3). */}
            <PhoneVerify onVerified={() => setPhase("ready")} />
          </div>
        )}
      </div>
    </div>
  );
}
