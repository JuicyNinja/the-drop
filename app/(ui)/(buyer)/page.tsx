"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { RequireAuth } from "@/components/RequireAuth";
import { DropCard, type BoardCard } from "@/components/DropCard";
import { BoardFilter, type BoardSort } from "@/app/(ui)/(buyer)/_lib/BoardFilter";

interface Lane { on_fire: BoardCard[]; new: BoardCard[]; gone: BoardCard[] }
interface Board { local: Lane; maker: Lane; digital: Lane }

function isFresh(c: BoardCard): boolean {
  // live_until is present; a card is "fresh" if the drop went live very recently.
  // The board card does not carry live_at, so recency is approximated by a large
  // remaining fraction on a just-seen card — kept conservative so the flip is rare.
  return c.pct_remaining >= 0.98;
}

function Grid({ cards, fresh }: { cards: BoardCard[]; fresh?: boolean }) {
  return (
    <div className="board-grid">
      {cards.map((c) => (
        <DropCard key={c.id} card={c} freshArrival={fresh && isFresh(c)} />
      ))}
    </div>
  );
}

function BoardView() {
  const [board, setBoard] = useState<Board | null>(null);
  const [cold, setCold] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tag, setTag] = useState<{ id: string; label: string } | null>(null);
  const [sort, setSort] = useState<BoardSort>("heat");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const params = new URLSearchParams();
      if (tag) params.set("tag_id", tag.id);
      if (sort) params.set("sort", sort);
      const qs = params.toString();
      const r = await api<Board>(`/v1/board${qs ? `?${qs}` : ""}`);
      if (!alive) return;
      if (r.ok && r.data) { setBoard(r.data); setCold(Boolean(r.meta?.cold_start)); setError(null); }
      else setError(r.error?.message ?? "The board could not load.");
    };
    load();
    const t = setInterval(load, 30_000); // refresh; Gone cards leave after 5 min
    return () => { alive = false; clearInterval(t); };
  }, [tag, sort]);

  const filter = (
    <BoardFilter tag={tag} sort={sort} onPickTag={setTag} onClearTag={() => setTag(null)} onSort={setSort} />
  );

  if (error) return <div className="board-hall"><div className="board-head"><h1 className="board-title">The board</h1></div>{filter}<p className="board-empty">{error}</p></div>;
  if (!board) return <div className="board-hall"><div className="board-head"><h1 className="board-title">The board</h1></div>{filter}<p className="board-empty">Loading the board.</p></div>;

  const local = board.local;
  const onFire = local.on_fire;
  const fresh = local.new;
  const gone = local.gone;
  const nothing = onFire.length === 0 && fresh.length === 0 && gone.length === 0;

  return (
    <div className="board-hall">
      <div className="board-head">
        <h1 className="board-title">The board</h1>
        {cold && <span className="muted">New market. Sorted by distance.</span>}
      </div>

      {filter}

      {nothing && <p className="board-empty">{tag ? `No live ${tag.label} drops nearby right now.` : "No live drops nearby right now."}</p>}

      {onFire.length > 0 && (
        <>
          <h2 className="board-lane-label">On fire</h2>
          <Grid cards={onFire} fresh />
        </>
      )}

      {fresh.length > 0 && (
        <>
          <h2 className="board-lane-label">New</h2>
          <Grid cards={fresh} fresh />
        </>
      )}

      {gone.length > 0 && (
        <>
          <h2 className="board-lane-label">Gone</h2>
          <Grid cards={gone} />
        </>
      )}
    </div>
  );
}

export default function BoardPage() {
  return (
    <RequireAuth>
      <BoardView />
    </RequireAuth>
  );
}
