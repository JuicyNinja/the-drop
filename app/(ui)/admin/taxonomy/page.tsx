"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";

interface AdminTag {
  id: string; parent_id: string | null; slug: string; label: string;
  synonyms: string[]; lanes: string[]; selectable: boolean; active: boolean; sort_order: number;
}

export default function AdminTaxonomy() {
  const [tags, setTags] = useState<AdminTag[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const r = await api<AdminTag[]>("/v1/admin/tags");
    if (r.ok && r.data) setTags(r.data);
  };
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<AdminTag[]>("/v1/admin/tags");
      if (alive && r.ok && r.data) setTags(r.data);
    })();
    return () => { alive = false; };
  }, []);

  async function toggleActive(t: AdminTag) {
    setBusy(t.id);
    await api(`/v1/admin/tags/${t.id}`, { method: "PATCH", body: { active: !t.active } });
    setBusy(null); void load();
  }

  const groups = (tags ?? []).filter((t) => t.parent_id === null);
  const leavesByParent = new Map<string, AdminTag[]>();
  for (const t of tags ?? []) if (t.parent_id) leavesByParent.set(t.parent_id, [...(leavesByParent.get(t.parent_id) ?? []), t]);

  return (
    <div className="op-page stack">
      <h1 className="op-title">Taxonomy</h1>
      <p className="muted">Platform-controlled (invariant #13). Groups organize; leaves carry lanes and are selectable.</p>
      {tags === null ? <p className="op-empty">Loading.</p> : (
        <div className="stack">
          <p className="muted">{groups.length} groups · {(tags.length - groups.length)} leaves</p>
          {groups.map((g) => (
            <details key={g.id} className="op-panel">
              <summary className="op-cell-title">{g.label} <span className="muted">({(leavesByParent.get(g.id) ?? []).length})</span></summary>
              <div className="op-table-wrap">
                <table className="op-table">
                  <thead><tr><th>Leaf</th><th>Lanes</th><th>Active</th><th>Actions</th></tr></thead>
                  <tbody>
                    {(leavesByParent.get(g.id) ?? []).map((t) => (
                      <tr key={t.id}>
                        <td className="op-cell-title">{t.label} <span className="muted">{t.slug}</span></td>
                        <td>{t.lanes.join(", ")}</td>
                        <td>{t.active ? "yes" : <span className="muted">no</span>}</td>
                        <td className="op-actions"><button className="op-link" disabled={busy === t.id} onClick={() => toggleActive(t)}>{t.active ? "Deactivate" : "Activate"}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
