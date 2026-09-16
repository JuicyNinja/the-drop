"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { RequireAuth } from "@/components/RequireAuth";
import { Scoreboard } from "./Scoreboard";

/**
 * The operator shell (DESIGN-SYSTEM §9): the persistent scoreboard top-right on
 * every operator screen, the nav, and the org context switcher. Org context is
 * discovered through GET /v1/orgs — multi-org is the general case, so the
 * current org is always visible; the switcher appears only when there is more
 * than one membership and is skipped silently at length one. A buyer with no
 * merchant role sees a plain "no access" note, never an error.
 */

export interface Membership {
  org_id: string;
  name: string;
  lane: string;
  role: "merchant_owner" | "merchant_staff";
  tier: string;
  status: string;
  locations: { id: string; name: string; city: string }[];
}

interface OperatorCtx {
  memberships: Membership[];
  org: Membership;
  setOrg: (orgId: string) => void;
}

const Ctx = createContext<OperatorCtx | null>(null);

/** The current operator org context. Throws if used outside the shell. */
export function useOperator(): OperatorCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOperator must be used within the operator shell");
  return c;
}

const SELECTED_KEY = "thedrop.operator.org";

const NAV = [
  { href: "/operator", label: "Today" },
  { href: "/operator/drops", label: "Drops" },
  { href: "/operator/whispers", label: "Whispers" },
  { href: "/operator/account", label: "Account" },
];

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

function Portal({ children }: { children: ReactNode }) {
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<Membership[]>("/v1/orgs");
      if (!alive) return;
      const list = r.ok && r.data ? r.data : [];
      setMemberships(list);
      const saved = readSelected();
      const initial = list.find((m) => m.org_id === saved) ?? list[0];
      setSelectedId(initial?.org_id ?? null);
    })();
    return () => { alive = false; };
  }, []);

  function setOrg(orgId: string): void {
    setSelectedId(orgId);
    try { localStorage.setItem(SELECTED_KEY, orgId); } catch { /* ignore */ }
  }

  if (memberships === null) return <div className="page muted">Loading.</div>;
  if (memberships.length === 0) {
    return (
      <div className="page">
        <div className="auth-card stack">
          <h1 className="auth-title">No merchant access</h1>
          <p className="muted">This account is not attached to a business. The board is at <Link href="/" className="inline-link">The Drop</Link>.</p>
        </div>
      </div>
    );
  }

  const org = memberships.find((m) => m.org_id === selectedId) ?? memberships[0];
  return (
    <Ctx.Provider value={{ memberships, org, setOrg }}>
      <OperatorChrome>{children}</OperatorChrome>
    </Ctx.Provider>
  );
}

function OperatorChrome({ children }: { children: ReactNode }) {
  const { memberships, org, setOrg } = useOperator();
  const path = usePathname();
  return (
    <div className="op">
      <header className="op-bar">
        <div className="op-bar-left">
          <Link href="/operator" className="nav-brand">The Drop</Link>
          {memberships.length > 1 ? (
            <label className="op-switcher">
              <span className="op-switcher-label">Business</span>
              <select value={org.org_id} onChange={(e) => setOrg(e.target.value)} aria-label="Current business">
                {memberships.map((m) => (
                  <option key={m.org_id} value={m.org_id}>{m.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="op-current" aria-label="Current business">{org.name}</span>
          )}
          <nav className="op-nav">
            {NAV.map((n) => {
              const active = n.href === "/operator" ? path === "/operator" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className="op-nav-link" data-active={active}>{n.label}</Link>
              );
            })}
          </nav>
        </div>
        <Scoreboard orgId={org.org_id} />
      </header>
      <main className="op-main">{children}</main>
    </div>
  );
}

export function OperatorShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <Portal>{children}</Portal>
    </RequireAuth>
  );
}
