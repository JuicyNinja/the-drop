"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/**
 * Notification preferences (B3) and the in-app inbox (B2), API-CONTRACT §9.
 * Channels toggle per user; the daily digest lands at digest_hour_local. Transfer
 * SMS ignores the SMS toggle (user-initiated) — that is enforced server-side.
 */

interface Prefs { push_enabled: boolean; email_enabled: boolean; sms_enabled: boolean; digest_hour_local: number }
interface Notif { id: string; kind: string; channel: string; payload: Record<string, unknown>; read_at: string | null; created_at: string }

function humanKind(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function summary(n: Notif): string {
  const p = n.payload as { title?: string; body?: string; drop_title?: string };
  return p.title || p.body || p.drop_title || humanKind(n.kind);
}
const hour12 = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;

export function Notifications() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [notifs, setNotifs] = useState<Notif[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [p, n] = await Promise.all([
        api<Prefs>("/v1/users/me/notification-prefs"),
        api<Notif[]>("/v1/users/me/notifications"),
      ]);
      if (!alive) return;
      if (p.ok && p.data) setPrefs(p.data);
      if (n.ok && n.data) setNotifs(n.data);
    })();
    return () => { alive = false; };
  }, []);

  async function patch(next: Partial<Prefs>) {
    if (!prefs) return;
    const optimistic = { ...prefs, ...next };
    setPrefs(optimistic); setSaving(true);
    const r = await api<Prefs>("/v1/users/me/notification-prefs", { method: "PATCH", body: next });
    setSaving(false);
    if (r.ok && r.data) setPrefs(r.data);
  }

  return (
    <div className="stack">
      <p className="you-panel-label muted">Notifications</p>

      {prefs && (
        <div className="notif-prefs">
          {([["push_enabled", "Push"], ["email_enabled", "Email"], ["sms_enabled", "SMS"]] as const).map(([key, label]) => (
            <label key={key} className="notif-toggle">
              <input type="checkbox" checked={prefs[key]} disabled={saving} onChange={(e) => patch({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          <label className="notif-digest">
            Daily digest at
            <select value={prefs.digest_hour_local} disabled={saving} onChange={(e) => patch({ digest_hour_local: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour12(h)}</option>)}
            </select>
          </label>
        </div>
      )}

      {notifs !== null && (
        notifs.length === 0 ? <p className="muted">No notifications yet.</p> : (
          <ul className="notif-list">
            {notifs.slice(0, 20).map((n) => (
              <li key={n.id} className="notif" data-unread={n.read_at === null}>
                <span className="notif-kind">{humanKind(n.kind)}</span>
                <span className="notif-summary">{summary(n)}</span>
                <span className="notif-time muted">{new Date(n.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
