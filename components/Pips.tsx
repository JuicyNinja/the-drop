/**
 * Inventory pips (DESIGN-SYSTEM §4.5). Discrete units — NEVER a progress bar.
 *   ≤ 30 units: one pip per unit
 *   31–100:     5 units per pip, remainder partial
 *   > 100:      10 units per pip
 * Filled = --signal; below 25% remaining, filled turns --flap. Empty =
 * --hairline on light, --board-deep on the board. A pip going out is a
 * mechanical 120ms hard step (CSS), never a fade.
 */
export function Pips({ remaining, total, onBoard = false }: { remaining: number; total: number; onBoard?: boolean }) {
  const upp = total <= 30 ? 1 : total <= 100 ? 5 : 10;
  const pipCount = Math.max(1, Math.ceil(total / upp));
  const pct = total > 0 ? remaining / total : 0;
  const low = pct < 0.25;

  const pips = [];
  for (let i = 0; i < pipCount; i++) {
    const rangeStart = i * upp;
    const filledUnits = Math.min(upp, Math.max(0, remaining - rangeStart));
    const fraction = filledUnits / upp; // 1 full, 0 empty, partial otherwise
    const wq = Math.round(fraction * 20) * 5; // nearest 5% — CSP-safe width class
    pips.push(
      <span key={i} className={`pip${onBoard ? " pip-onboard" : ""}${low ? " pip-low" : ""}`}>
        <span className={`pip-fill wq-${wq}`} />
      </span>,
    );
  }
  return (
    <span className="pips" role="img" aria-label={`${remaining} of ${total} remaining`}>
      {pips}
    </span>
  );
}
