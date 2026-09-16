"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { useOperator } from "../_lib/shell";
import { WHISPER_DIMENSIONS } from "@/lib/whisper-dimensions";

/**
 * Whispers (API-CONTRACT §9): read-only, owner/admin only, anchored on "would
 * return at full price". Never a star rating, never public, buyer identity
 * omitted. The operator reads; there is no reply. Copy states facts.
 */

interface Whisper {
  id: string;
  would_return_at_full_price: boolean;
  dim_2: number; dim_3: number; dim_4: number;
  note: string | null;
  drop_title: string;
  created_at: string;
}

const date = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

export default function WhispersPage() {
  const { org } = useOperator();
  const [whispers, setWhispers] = useState<Whisper[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<Whisper[]>(`/v1/orgs/${org.org_id}/whispers`);
      if (!alive) return;
      if (r.status === 403) { setForbidden(true); setWhispers([]); return; }
      setWhispers(r.ok && r.data ? r.data : []);
    })();
    return () => { alive = false; };
  }, [org.org_id]);

  if (whispers === null) return <div className="op-page op-empty">Loading.</div>;

  return (
    <div className="op-page stack">
      <h1 className="op-title">Whispers</h1>
      {forbidden && <p className="op-empty">Whispers are visible to the business owner.</p>}
      {!forbidden && whispers.length === 0 && <p className="op-empty">No whispers yet.</p>}

      <div className="op-whispers">
        {whispers.map((w) => (
          <article key={w.id} className="op-whisper">
            <div className="op-whisper-head">
              <span className="op-whisper-return" data-yes={w.would_return_at_full_price}>
                {w.would_return_at_full_price ? "Would return at full price" : "Would not return at full price"}
              </span>
              <span className="muted op-whisper-date">{date(w.created_at)}</span>
            </div>
            <p className="op-whisper-drop">{w.drop_title}</p>
            <div className="op-whisper-dims">
              {WHISPER_DIMENSIONS.map((d) => (
                <span key={d.key} className="op-whisper-dim">
                  <span className="op-whisper-dim-label">{d.label}</span>
                  <span className="op-whisper-dim-val data">{w[d.key]}/5</span>
                </span>
              ))}
            </div>
            {w.note && <p className="op-whisper-note">{w.note}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}
