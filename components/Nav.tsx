"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActiveAddressIndicator } from "@/app/(ui)/(buyer)/_lib/buyer";

/** Buyer nav tabs (DESIGN-SYSTEM §10 / PRD §12). Sentence case, no arrows. */
const TABS = [
  { href: "/", label: "Board" },
  { href: "/wallet", label: "Called It" },
  { href: "/redeem", label: "Redeem" },
  { href: "/graveyard", label: "Gone" },
  { href: "/you", label: "You" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand">The Drop</Link>
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className="nav-link" data-active={active}>
              {t.label}
            </Link>
          );
        })}
        {/* Persistent active-market indicator (PRD §8.1): links to address management. */}
        <Link href="/you" className="active-address-link" aria-label="Active address">
          <ActiveAddressIndicator />
        </Link>
      </div>
    </nav>
  );
}
