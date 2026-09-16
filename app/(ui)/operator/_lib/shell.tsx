"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { RequireAuth } from "@/components/RequireAuth";
import { Scoreboard } from "./Scoreboard";
import { CreateOrgForm } from "./CreateOrgForm";

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
  reload: (selectOrgId?: string) => Promise<void>;
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

  const reload = useCallback(async (selectOrgId?: string) => {
    const r = await api<Membership[]>("/v1/orgs");
    const list = r.ok && r.data ? r.data : [];
    setMemberships(list);
    setSelectedId((current) => {
      const want = selectOrgId ?? current ?? readSelected();
      const picked = list.find((m) => m.org_id === want) ?? list[0];
      if (picked && selectOrgId) { try { localStorage.setItem(SELECTED_KEY, picked.org_id); } catch { /* ignore */ } }
      return picked?.org_id ?? null;
    });
  }, []);

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

  // Self-onboarding: an account with no business creates its first one here.
  if (memberships.length === 0) {
    return (
      <div className="op">
        <header className="op-bar"><div className="op-bar-left"><Link href="/operator" className="nav-brand">The Drop · Operator</Link></div></header>
        <main className="op-main op-form-page">
          <div className="stack">
            <h1 className="op-title">Create your business</h1>
            <p className="muted">Set up your business to start dropping. The board is at <Link href="/" className="inline-link">The Drop</Link>.</p>
            <CreateOrgForm onCreated={(id) => { void reload(id); }} />
          </div>
        </main>
      </div>
    );
  }

  const org = memberships.find((m) => m.org_id === selectedId) ?? memberships[0];
  return (
    <Ctx.Provider value={{ memberships, org, setOrg, reload }}>
      <OperatorChrome>{children}</OperatorChrome>
    </Ctx.Provider>
  );
}

function OperatorChrome({ children }: { children: ReactNode }) {
  const { memberships, org, setOrg, reload } = useOperator();
  const path = usePathname();
  const [adding, setAdding] = useState(false);
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
          <button className="op-nav-link op-add-business" onClick={() => setAdding(true)}>+ Add business</button>
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
      <main className="op-main">
        {adding ? (
          <div className="op-page op-form-page stack">
            <h1 className="op-title">Add a business</h1>
            <CreateOrgForm onCreated={(id) => { setAdding(false); void reload(id); }} onCancel={() => setAdding(false)} />
          </div>
        ) : children}
      </main>
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
