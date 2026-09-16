"use client";

/**
 * Upcoming picks — a v1 stub (BUILD-PLAN WP-14: the tab exists, the lanes do not).
 * The board has no Upcoming lane in v1; this tab is a deliberate placeholder so
 * the surface is stable when the feature lands.
 */
export default function AdminUpcoming() {
  return (
    <div className="op-page stack">
      <h1 className="op-title">Upcoming picks</h1>
      <div className="op-panel stack">
        <p>Upcoming picks are not live in v1.</p>
        <p className="muted">The tab and the <span className="data">PUT /v1/admin/board/upcoming</span> endpoint exist so the surface is stable; the board has no Upcoming lane yet. This lands in a later package.</p>
      </div>
    </div>
  );
}
