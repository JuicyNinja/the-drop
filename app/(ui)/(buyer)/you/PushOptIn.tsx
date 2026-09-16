"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/**
 * Web Push opt-in (API-CONTRACT §9, B4). Requests notification permission,
 * registers the service worker, subscribes with the server's VAPID public key,
 * and stores the subscription. Degrades clearly when push is unsupported,
 * blocked, or unconfigured (dev without VAPID keys).
 */

type State = "checking" | "unsupported" | "blocked" | "idle" | "on" | "unconfigured";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () =>
  typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;

export function PushOptIn() {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!supported()) { if (alive) setState("unsupported"); return; }
      if (Notification.permission === "denied") { if (alive) setState("blocked"); return; }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (alive) setState(sub ? "on" : "idle");
      } catch {
        if (alive) setState("idle");
      }
    })();
    return () => { alive = false; };
  }, []);

  async function enable() {
    setBusy(true); setErr(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("blocked"); setBusy(false); return; }

      const keyRes = await api<{ key: string | null }>("/v1/push/vapid-key");
      const key = keyRes.ok ? keyRes.data?.key ?? null : null;
      if (!key) { setState("unconfigured"); setBusy(false); return; }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const r = await api("/v1/users/me/push-subscriptions", {
        method: "POST",
        body: { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } },
      });
      if (r.ok) { setState("on"); } else { setErr(r.error?.message ?? "Could not save the subscription."); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not enable push.");
    }
    setBusy(false);
  }

  return (
    <div>
      <p className="you-panel-label muted">Push notifications</p>
      {state === "checking" && <p className="muted">…</p>}
      {state === "unsupported" && <p className="muted">This device doesn&apos;t support push notifications.</p>}
      {state === "blocked" && <p className="muted">Notifications are blocked. Enable them for this site in your browser settings.</p>}
      {state === "unconfigured" && <p className="muted">Push isn&apos;t configured in this environment (no VAPID keys).</p>}
      {state === "on" && <p className="muted">Push notifications are on.</p>}
      {state === "idle" && <button className="btn-secondary" disabled={busy} onClick={enable}>Enable push notifications</button>}
      {err && <p className="field-error">{err}</p>}
    </div>
  );
}
