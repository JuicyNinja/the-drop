/**
 * The logo bubble (DESIGN-SYSTEM §4.2). A circular merchant mark that sits
 * immediately left of the merchant name — small on the card front, larger on the
 * flip side. With a logo it shows the mark; without one it never renders empty —
 * it falls back to a monogram of the merchant's initials on the group ground
 * color (`groundSlug`), so every card carries the merchant's identity.
 */
export function LogoBubble({
  name, logoUrl = null, groundSlug = "bone", size = "sm",
}: {
  name: string;
  logoUrl?: string | null;
  groundSlug?: string;
  size?: "sm" | "lg";
}) {
  const cls = `logo-bubble${size === "lg" ? " logo-bubble-lg" : ""}`;
  if (logoUrl) {
    return (
      <span className={cls} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo is a static/data-URI mark, no loader needed */}
        <img className="logo-bubble-img" src={logoUrl} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }
  // Monogram fallback: merchant initials on the group ground color.
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "•";
  return (
    <span className={`${cls} logo-mono lg-${groundSlug} data`} aria-hidden>
      {initials}
    </span>
  );
}
