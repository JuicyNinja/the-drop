"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { LogoBubble } from "@/components/LogoBubble";

/**
 * Merchant logo control (DESIGN-SYSTEM §4.2). The mark sits beside the merchant
 * name on every card; here the operator sets it. A picked file is resized
 * client-side to a small square webp data: URI and saved via PATCH /v1/orgs/{id}
 * — no upload/storage service exists in v1, so the mark travels inline. Without a
 * logo the card shows a monogram, so removing one is a supported state.
 */

const MARK_PX = 96; // rendered at ~40px on the card; 96 keeps it crisp on retina

async function fileToSquareWebp(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode failed"));
    i.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = MARK_PX;
  canvas.height = MARK_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  // Cover-crop to a centered square so a rectangular upload still fills the circle.
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, MARK_PX, MARK_PX);
  return canvas.toDataURL("image/webp", 0.85);
}

export function LogoUpload({ orgId, name }: { orgId: string; name: string }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<{ logo_url: string | null }>(`/v1/orgs/${orgId}`);
      if (alive && r.ok && r.data) setLogoUrl(r.data.logo_url);
    })();
    return () => { alive = false; };
  }, [orgId]);

  async function onPick(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const mark = await fileToSquareWebp(file);
      const r = await api<{ logo_url: string | null }>(`/v1/orgs/${orgId}`, { method: "PATCH", body: { logo_url: mark } });
      if (r.ok && r.data) setLogoUrl(r.data.logo_url);
      else setErr(r.error?.message ?? "Could not save the logo.");
    } catch {
      setErr("That image could not be read. Try a PNG or JPG.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onRemove() {
    setErr(null);
    setBusy(true);
    const r = await api<{ logo_url: string | null }>(`/v1/orgs/${orgId}`, { method: "PATCH", body: { logo_url: null } });
    setBusy(false);
    if (r.ok) setLogoUrl(null);
    else setErr(r.error?.message ?? "Could not remove the logo.");
  }

  return (
    <div className="op-panel stack op-logo">
      <h2 className="op-section">Logo</h2>
      <div className="op-logo-row">
        <LogoBubble name={name} logoUrl={logoUrl} size="lg" />
        <div className="op-logo-actions">
          <input
            ref={fileRef}
            id="logo-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="op-logo-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f); }}
            disabled={busy}
          />
          <label htmlFor="logo-file" className="btn-secondary op-logo-btn" aria-disabled={busy}>
            {logoUrl ? "Replace" : "Upload"}
          </label>
          {logoUrl && <button type="button" className="btn-secondary" onClick={() => void onRemove()} disabled={busy}>Remove</button>}
        </div>
      </div>
      <p className="muted rw-hint">A square mark reads best. It shows beside your name on every card; without one, buyers see your initials.</p>
      {err && <p className="field-error">{err}</p>}
    </div>
  );
}
