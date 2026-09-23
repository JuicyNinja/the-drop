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
  const tabs = TABS.map((t) => {
    const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
    return (
      <Link key={t.href} href={t.href} className="nav-link" data-active={active}>
        {t.label}
      </Link>
    );
  });

  // Web: one glass top bar (brand · tabs · active market). Mobile (UI kit): the
  // brand + market stay in a slim top bar and the section tabs move to a sticky
  // glass bottom bar. Same five destinations either way — the layout moves, no
  // control is dropped.
  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <Link href="/" className="nav-brand" aria-label="The Drop">
            {/* eslint-disable-next-line @next/next/no-img-element -- static local brand mark, no loader/optimization needed */}
            <img className="nav-brand-logo" src="/brand/the-drop.svg" alt="The Drop" width={740} height={343} />
          </Link>
          <div className="nav-tabs">{tabs}</div>
          {/* Persistent active-market indicator (PRD §8.1): links to address management. */}
          <Link href="/you" className="active-address-link" aria-label="Active address">
            <ActiveAddressIndicator />
          </Link>
        </div>
      </nav>
      {/* Mobile-only bottom tab bar; hidden at ≥768px where the top bar carries the tabs. */}
      <nav className="nav-bottom" aria-label="Sections">{tabs}</nav>
    </>
  );
}
