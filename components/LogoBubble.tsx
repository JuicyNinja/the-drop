/**
 * The logo bubble (DESIGN-SYSTEM §4.2). Circular, 40px, top-left, overlapping the
 * card edge by 8px, carrying the wrong-direction --sh-logo shadow so it reads as
 * a badge pinned onto the card — the card's deliberate fingerprint. Shows the
 * merchant's initial.
 */
export function LogoBubble({ name }: { name: string }) {
  const initial = (name?.trim()?.[0] ?? "•").toUpperCase();
  return (
    <span className="logo-bubble data" aria-hidden>
      {initial}
    </span>
  );
}
