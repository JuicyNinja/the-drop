"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { RequireAuth } from "@/components/RequireAuth";

interface Catch { id: string; status: string; position_number: number; expires_at: string; drop: { id: string; title: string } }

function pad(n: number): string { return String(n).padStart(3, "0"); }

const OUTCOME: Record<string, string> = { redeemed: "Redeemed", expired: "Expired", held: "Held", transfer_pending: "Transfer pending" };

/** Past Drops — permanently browsable (invariant #11). Gone drops are not
 *  deleted; a caught drop lives here after its window whether redeemed or not. */
function Graveyard() {
  const [past, setPast] = useState<Catch[]>([]);
  useEffect(() => { (async () => { const r = await api<Catch[]>("/v1/catches"); if (r.ok && r.data) setPast(r.data); })(); }, []);

  const done = past.filter((c) => c.status === "redeemed" || c.status === "expired");
  const list = done.length > 0 ? done : past;

  return (
    <div className="page">
      <h1 className="board-title">Past drops</h1>
      {list.length === 0 ? (
        <p className="board-empty">Nothing here yet.</p>
      ) : (
        <div className="wallet-list">
          {list.map((c) => (
            <article key={c.id} className={`wallet-card${c.status === "expired" ? " past-expired" : ""}`}>
              <span className="wallet-pos data">{pad(c.position_number)}</span>
              <div className="wallet-body">
                <p className="wallet-title">{c.drop.title}</p>
                <p className="muted wallet-status">{OUTCOME[c.status] ?? c.status}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GraveyardPage() {
  return <RequireAuth><Graveyard /></RequireAuth>;
}
