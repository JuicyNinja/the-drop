"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

/**
 * Category chips — the group-level browse furniture (DESIGN-SYSTEM §15.2).
 * Each chip is a generated group tile with the category name as a **CSS label
 * overlaid in the lower third** (§15.2.2), never baked into the image. The label
 * sits on a strip of the group's ground token (§15.2.1 rank-2), so the wayfinding
 * color is a solid swatch behind crisp, translatable, screen-reader-readable
 * text. Tapping a chip filters the board to that group (the board expands a group
 * id to its leaves server-side); tapping the active chip clears it.
 *
 * Ground color is set through a per-ground class, not an inline style — the CSP
 * forbids inline styles (style-src is 'self' + nonce).
 */

interface Group {
  id: string;
  slug: string;
  label: string;
  ground_hex: string | null;
  leaves: { id: string; label: string; slug: string }[];
}

// The 9 grounds (§15.3), hex → token name for the label-backing class.
const GROUND: Record<string, string> = {
  "#F25C05": "orange", "#F5B428": "amber", "#C0271A": "oxide", "#2E5A78": "steel",
  "#1E7A6F": "teal", "#5E7444": "moss", "#E4826E": "blush", "#58B89C": "mint", "#EDE6D8": "bone",
};
const groundClass = (hex: string | null) => `chip-ground-${(hex && GROUND[hex.toUpperCase()]) || "bone"}`;

export function CategoryChips({
  activeId, onPick, onClear,
}: {
  activeId: string | null;
  onPick: (t: { id: string; label: string }) => void;
  onClear: () => void;
}) {
  const [groups, setGroups] = useState<Group[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<Group[]>("/v1/tags?lane=local");
      if (alive && r.ok && r.data) setGroups(r.data);
    })();
    return () => { alive = false; };
  }, []);

  if (!groups || groups.length === 0) return null;

  return (
    <div className="cat-chips" role="group" aria-label="Browse by category">
      {groups.map((g) => {
        const active = g.id === activeId;
        return (
          <button
            key={g.id}
            className={`cat-chip${active ? " cat-chip-active" : ""}`}
            aria-pressed={active}
            onClick={() => (active ? onClear() : onPick({ id: g.id, label: g.label }))}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static public asset, no layout shift, no loader needed */}
            <img className="cat-chip-img" src={`/tiles/groups/${g.slug}.webp`} alt="" loading="lazy" decoding="async" />
            <span className={`cat-chip-label ${groundClass(g.ground_hex)}`}>{g.label}</span>
          </button>
        );
      })}
    </div>
  );
}
