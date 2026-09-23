"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { RequireAuth } from "@/components/RequireAuth";

interface Catch { id: string; status: string; position_number: number; code: string; transfer_count: number; expires_at: string; redeem_window: string; drop: { id: string; title: string } }
interface Incoming { id: string; from_handle: string; position_number: number; drop_title: string; accept_by: string }
interface Hit { handle: string; display_name: string }

function pad(n: number): string { return String(n).padStart(3, "0"); }

function WalletTab({ catches, onSend }: { catches: Catch[]; onSend: (c: Catch) => void }) {
  if (catches.length === 0) return <p className="board-empty">Nothing caught yet.</p>;
  return (
    <div className="wallet-list">
      {catches.map((c) => (
        <article key={c.id} className="wallet-card">
          <span className="wallet-pos data">{pad(c.position_number)}</span>
          <div className="wallet-body">
            <p className="wallet-title">{c.drop.title}</p>
            <p className="muted wallet-status">{c.status === "held" ? "Held" : c.status === "transfer_pending" ? "Transfer pending" : c.status === "redeemed" ? "Redeemed" : "Expired"} · code <span className="data">{c.code}</span></p>
            {c.redeem_window && <p className="muted wallet-window">{c.redeem_window}</p>}
          </div>
          {c.status === "held" && c.transfer_count < 1 && (
            <button className="btn-secondary wallet-send-btn" onClick={() => onSend(c)}>Send</button>
          )}
        </article>
      ))}
    </div>
  );
}

function SendTab({ catches, onDone }: { catches: Catch[]; onDone: () => void }) {
  const sendable = catches.filter((c) => c.status === "held" && c.transfer_count < 1);
  const [pick, setPick] = useState<string>(sendable[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { if (alive) setHits([]); return; }
      const r = await api<Hit[]>(`/v1/users/me/handle-search?q=${encodeURIComponent(q.trim())}`);
      if (alive && r.ok && r.data) setHits(r.data);
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  async function send() {
    setNote(null);
    if (!pick || !to) return;
    const r = await api("/v1/transfers", { method: "POST", body: { catch_id: pick, to_handle: to } });
    if (r.ok) { setNote(`Sent to ${to}. It returns to you if they don't accept in 5 minutes.`); setTo(null); setQ(""); onDone(); }
    else setNote(r.error?.message ?? "Could not send.");
  }

  if (sendable.length === 0) return <p className="board-empty">No catches available to send.</p>;
  return (
    <div className="stack send-tab">
      <div>
        <label htmlFor="pick">Which catch</label>
        <select id="pick" value={pick} onChange={(e) => setPick(e.target.value)}>
          {sendable.map((c) => <option key={c.id} value={c.id}>{pad(c.position_number)} · {c.drop.title}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="to">Send to</label>
        <input id="to" value={to ?? q} onChange={(e) => { setTo(null); setQ(e.target.value); }} placeholder="Type a handle" autoCapitalize="off" autoComplete="off" />
        {!to && hits.length > 0 && (
          <ul className="handle-hits">
            {hits.map((h) => (
              <li key={h.handle}><button className="handle-hit" onClick={() => { setTo(h.handle); setQ(h.handle); setHits([]); }}>{h.handle} <span className="muted">{h.display_name}</span></button></li>
            ))}
          </ul>
        )}
      </div>
      {note && <p className="muted">{note}</p>}
      <button className="btn-catch" disabled={!to} onClick={send}>Send</button>
    </div>
  );
}

function Wallet() {
  const [tab, setTab] = useState<"wallet" | "send">("wallet");
  const [catches, setCatches] = useState<Catch[]>([]);
  const [incoming, setIncoming] = useState<Incoming[]>([]);

  const load = async () => {
    const [c, i] = await Promise.all([api<Catch[]>("/v1/catches"), api<Incoming[]>("/v1/transfers/incoming")]);
    if (c.ok && c.data) setCatches(c.data);
    if (i.ok && i.data) setIncoming(i.data);
  };
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [c, i] = await Promise.all([api<Catch[]>("/v1/catches"), api<Incoming[]>("/v1/transfers/incoming")]);
      if (!alive) return;
      if (c.ok && c.data) setCatches(c.data);
      if (i.ok && i.data) setIncoming(i.data);
    })();
    return () => { alive = false; };
  }, []);

  async function respond(idc: string, action: "accept" | "decline") {
    await api(`/v1/transfers/${idc}/${action}`, { method: "POST" });
    load();
  }

  return (
    <div className="page">
      <h1 className="board-title">Called It</h1>

      {incoming.length > 0 && (
        <div className="incoming stack">
          {incoming.map((t) => (
            <div key={t.id} className="incoming-row">
              <span>{t.from_handle} sent you <span className="data">{pad(t.position_number)}</span> of {t.drop_title}</span>
              <div className="row">
                <button className="btn-catch" onClick={() => respond(t.id, "accept")}>Accept</button>
                <button className="btn-secondary" onClick={() => respond(t.id, "decline")}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="tabs">
        <button className="tab" data-active={tab === "wallet"} onClick={() => setTab("wallet")}>Wallet</button>
        <button className="tab" data-active={tab === "send"} onClick={() => setTab("send")}>Send</button>
      </div>

      {tab === "wallet" ? <WalletTab catches={catches} onSend={() => setTab("send")} /> : <SendTab catches={catches} onDone={load} />}
    </div>
  );
}

export default function WalletPage() {
  return <RequireAuth><Wallet /></RequireAuth>;
}
