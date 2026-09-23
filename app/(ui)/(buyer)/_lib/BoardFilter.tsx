"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/**
 * Board category filter + sort (WP-11 built the board query; this surfaces it).
 * Category is a type-ahead over the platform taxonomy (no free text, invariant
 * #13). Sort reorders On Fire — hottest (heat), nearest (distance), ending soon.
 */

interface TagHit { id: string; label: string; group: string }

export type BoardSort = "heat" | "distance" | "ending";
const SORTS: { key: BoardSort; label: string }[] = [
  { key: "heat", label: "Hottest" },
  { key: "distance", label: "Nearest" },
  { key: "ending", label: "Ending soon" },
];

// "Redeemable when" — plan ahead: a drop matches if its window is open AT ALL
// during the band, not necessarily right now. Default is no filter.
export type RedeemPreset = "now" | "tonight" | "tomorrow_morning" | "tomorrow" | "this_weekend";
export type RedeemFilter =
  | { kind: "none" }
  | { kind: "preset"; preset: RedeemPreset }
  | { kind: "custom"; date: string; start: string; end: string };
const REDEEM_PRESETS: { key: RedeemPreset; label: string }[] = [
  { key: "now", label: "Now" },
  { key: "tonight", label: "Tonight" },
  { key: "tomorrow_morning", label: "Tomorrow morning" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "this_weekend", label: "This weekend" },
];

export function BoardFilter({
  tag, sort, redeem, onPickTag, onClearTag, onSort, onRedeem,
}: {
  tag: { id: string; label: string } | null;
  sort: BoardSort;
  redeem: RedeemFilter;
  onPickTag: (t: { id: string; label: string }) => void;
  onClearTag: () => void;
  onSort: (s: BoardSort) => void;
  onRedeem: (r: RedeemFilter) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TagHit[]>([]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { if (alive) setHits([]); return; }
      const r = await api<TagHit[]>(`/v1/tags/search?q=${encodeURIComponent(q.trim())}&lane=local`);
      if (alive && r.ok && r.data) setHits(r.data);
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  return (
    <div className="board-filter">
      <div className="board-filter-cat">
        {tag ? (
          <span className="board-filter-chip">
            {tag.label}
            <button className="board-filter-clear" aria-label="Clear category" onClick={onClearTag}>×</button>
          </span>
        ) : (
          <div className="board-filter-search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by category" aria-label="Filter by category" autoComplete="off" />
            {hits.length > 0 && (
              <ul className="board-filter-hits">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button className="board-filter-hit" onClick={() => { onPickTag({ id: h.id, label: h.label }); setQ(""); setHits([]); }}>
                      {h.label} <span className="muted">{h.group}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <label className="board-filter-sort">
        <span className="op-switcher-label">Redeemable</span>
        <select
          value={redeem.kind === "preset" ? redeem.preset : redeem.kind}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "none") onRedeem({ kind: "none" });
            else if (v === "custom") onRedeem({ kind: "custom", date: "", start: "09:00", end: "17:00" });
            else onRedeem({ kind: "preset", preset: v as RedeemPreset });
          }}
        >
          <option value="none">Any time</option>
          {REDEEM_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {redeem.kind === "custom" && (
        <div className="board-filter-custom">
          <input type="date" aria-label="Redeemable date" value={redeem.date} onChange={(e) => onRedeem({ ...redeem, date: e.target.value })} />
          <input type="time" aria-label="Redeemable from" value={redeem.start} onChange={(e) => onRedeem({ ...redeem, start: e.target.value })} />
          <input type="time" aria-label="Redeemable to" value={redeem.end} onChange={(e) => onRedeem({ ...redeem, end: e.target.value })} />
        </div>
      )}
      <label className="board-filter-sort">
        <span className="op-switcher-label">Sort</span>
        <select value={sort} onChange={(e) => onSort(e.target.value as BoardSort)}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
    </div>
  );
}
