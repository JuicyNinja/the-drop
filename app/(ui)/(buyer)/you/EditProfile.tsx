"use client";

import { useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { useHandleAvailability, handleHint } from "@/app/(ui)/_lib/useHandleAvailability";

/**
 * B7 — edit profile. PATCH /v1/users/me is the only mutable-profile door:
 * full_name, handle (once, then permanently locked by a DB trigger), and email.
 * The handle field reuses the live availability check (B10); a locked handle is
 * shown read-only rather than as a disabled input the server would reject.
 * user_number and phone are immutable and not offered here.
 */

interface EditableProfile {
  full_name: string;
  handle: string;
  handle_locked: boolean;
  email: string;
}

export function EditProfile({
  profile,
  onSaved,
}: {
  profile: EditableProfile;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(profile.full_name);
  const [handle, setHandle] = useState(profile.handle);
  const [email, setEmail] = useState(profile.email);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const status = useHandleAvailability(handle, profile.handle);
  const hint = handleHint(status);
  const handleBlocked = status === "taken";

  function reset() {
    setFullName(profile.full_name); setHandle(profile.handle); setEmail(profile.email); setErr(null);
  }

  async function save() {
    setBusy(true); setErr(null);
    const body: Record<string, unknown> = {};
    if (fullName.trim() !== profile.full_name) body.full_name = fullName.trim();
    if (!profile.handle_locked && handle.trim().toLowerCase() !== profile.handle.toLowerCase()) body.handle = handle.trim().toLowerCase();
    if (email.trim() !== profile.email) body.email = email.trim();
    if (Object.keys(body).length === 0) { setBusy(false); setOpen(false); return; }
    const r = await api("/v1/users/me", { method: "PATCH", body });
    setBusy(false);
    if (r.ok) { setOpen(false); onSaved(); return; }
    setErr(r.error?.message ?? "Could not save.");
  }

  if (!open) {
    return (
      <button className="op-link you-edit-open" onClick={() => { reset(); setOpen(true); }}>Edit profile</button>
    );
  }

  return (
    <form className="stack you-panel you-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="you-panel-label muted">Edit profile</p>
      <div>
        <label htmlFor="ep-name">Name</label>
        <input id="ep-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div>
        <label htmlFor="ep-handle">Handle</label>
        {profile.handle_locked ? (
          <p className="you-handle-locked data">{profile.handle} <span className="muted">· locked</span></p>
        ) : (
          <>
            <input id="ep-handle" value={handle} onChange={(e) => setHandle(e.target.value)} aria-invalid={handleBlocked} />
            {hint && <p className={`handle-hint handle-hint-${hint.tone}`}>{hint.text}</p>}
            <p className="muted you-handle-note">A handle can be changed once, then it is permanent.</p>
          </>
        )}
      </div>
      <div>
        <label htmlFor="ep-email">Email</label>
        <input id="ep-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {err && <p className="field-error">{err}</p>}
      <div className="op-form-actions">
        <button type="submit" className="btn-catch" disabled={busy || handleBlocked}>Save</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
