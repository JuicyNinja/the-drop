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

export function BoardFilter({
  tag, sort, onPickTag, onClearTag, onSort,
}: {
  tag: { id: string; label: string } | null;
  sort: BoardSort;
  onPickTag: (t: { id: string; label: string }) => void;
  onClearTag: () => void;
  onSort: (s: BoardSort) => void;
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
        <span className="op-switcher-label">Sort</span>
        <select value={sort} onChange={(e) => onSort(e.target.value as BoardSort)}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
    </div>
  );
}
