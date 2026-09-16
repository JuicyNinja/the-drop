"use client";

import { useState } from "react";
import { PhoneVerify } from "../_lib/PhoneVerify";

/** Phone verification status + inline verify flow (PRD §3.4). */
export function PhoneSection({ phone, verified: initialVerified }: { phone: string; verified: boolean }) {
  const [verified, setVerified] = useState(initialVerified);
  const [verifying, setVerifying] = useState(false);

  return (
    <div>
      <p className="you-panel-label muted">Phone</p>
      <p className="you-phone">
        <span className="data">{phone || "—"}</span>
        <span className={verified ? "phone-verified" : "phone-unverified"}>{verified ? "verified" : "unverified"}</span>
      </p>
      {!verified && !verifying && <button className="btn-secondary" onClick={() => setVerifying(true)}>Verify phone</button>}
      {!verified && verifying && <PhoneVerify onVerified={() => { setVerified(true); setVerifying(false); }} onSkip={() => setVerifying(false)} />}
    </div>
  );
}
