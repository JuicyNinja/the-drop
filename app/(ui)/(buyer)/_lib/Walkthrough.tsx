"use client";

import { useEffect, useState } from "react";
import { api, getSession, SESSION_EVENT } from "@/app/(ui)/_lib/api";

/**
 * B8 — the first-session walkthrough (PRD §3.5 step 7). Shown once, when the
 * account's walkthrough_completed is still false. Finishing and dismissing both
 * POST to the server (complete / skip both set the same column) so it never
 * replays on another device — the state is server-authoritative, not a local
 * flag. Copy states facts in the product voice; scarcity does the work.
 */

interface Me { walkthrough_completed?: boolean }

const SLIDES: { title: string; body: string }[] = [
  { title: "Drops, not deals", body: "Makers and merchants drop. You catch. When it's caught out, it's Gone — and Gone stays on the board a while so you see it happen." },
  { title: "Your address finds drops. Your location redeems them.", body: "The board shows what's live near your active address. Redeeming a catch checks where you actually are, at the counter." },
  { title: "A catch holds your place", body: "Every catch carries a permanent position number. Numbers are never reused and counters never go up. An Encore is new supply, never a restock." },
  { title: "Clout is earned", body: "Redeem, leave a whisper, share a drop that gets caught. Clout is never bought — it only accrues from what you do." },
];

export function Walkthrough() {
  const [show, setShow] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!getSession()) { if (alive) setShow(false); return; }
      const r = await api<Me>("/v1/users/me");
      if (!alive) return;
      if (r.ok && r.data && r.data.walkthrough_completed === false) { setI(0); setShow(true); }
    };
    void check();
    window.addEventListener(SESSION_EVENT, check);
    return () => { alive = false; window.removeEventListener(SESSION_EVENT, check); };
  }, []);

  if (!show) return null;

  const last = i === SLIDES.length - 1;
  const slide = SLIDES[i]!;

  async function finish(path: "complete" | "skip") {
    setShow(false);
    await api(`/v1/users/me/walkthrough/${path}`, { method: "POST" });
  }

  return (
    <div className="wt-overlay" role="dialog" aria-modal="true" aria-label="Getting started">
      <div className="wt-card stack">
        <div className="wt-dots" aria-hidden>
          {SLIDES.map((_, n) => <span key={n} className={`wt-dot${n === i ? " wt-dot-on" : ""}`} />)}
        </div>
        <h2 className="wt-title">{slide.title}</h2>
        <p className="wt-body">{slide.body}</p>
        <div className="wt-actions">
          <button className="op-link" onClick={() => void finish("skip")}>Skip</button>
          {last
            ? <button className="btn-catch" onClick={() => void finish("complete")}>Start</button>
            : <button className="btn-catch" onClick={() => setI((n) => n + 1)}>Next</button>}
        </div>
      </div>
    </div>
  );
}
