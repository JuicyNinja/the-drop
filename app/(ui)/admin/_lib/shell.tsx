"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/app/(ui)/_lib/api";
import { RequireAuth } from "@/components/RequireAuth";

/**
 * The admin portal shell. Admin is gated twice: the API checks the admin role on
 * every route, and this shell only renders for an admin (users/me carries each
 * role with its scope now). A non-admin who reaches the URL sees a plain notice,
 * never data.
 */

interface Role { role: string; org_id: string | null; location_id: string | null }

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/orgs", label: "Orgs" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/cities", label: "Cities" },
  { href: "/admin/fraud", label: "Fraud" },
  { href: "/admin/taxonomy", label: "Taxonomy" },
  { href: "/admin/upcoming", label: "Upcoming" },
  { href: "/admin/audit", label: "Audit" },
];

function Gate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "admin" | "denied">("loading");
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<{ roles: Role[] }>("/v1/users/me");
      if (!alive) return;
      const isAdmin = r.ok && r.data ? r.data.roles.some((x) => x.role === "admin") : false;
      setState(isAdmin ? "admin" : "denied");
    })();
    return () => { alive = false; };
  }, []);

  if (state === "loading") return <div className="page muted">Loading.</div>;
  if (state === "denied") {
    return (
      <div className="page">
        <div className="auth-card stack">
          <h1 className="auth-title">Not authorized</h1>
          <p className="muted">This area is for platform administrators.</p>
        </div>
      </div>
    );
  }
  return <Chrome>{children}</Chrome>;
}

function Chrome({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="op">
      <header className="op-bar">
        <div className="op-bar-left">
          <span className="nav-brand">The Drop · Admin</span>
          <nav className="op-nav">
            {NAV.map((n) => {
              const active = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
              return <Link key={n.href} href={n.href} className="op-nav-link" data-active={active}>{n.label}</Link>;
            })}
          </nav>
        </div>
      </header>
      <main className="op-main">{children}</main>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <Gate>{children}</Gate>
    </RequireAuth>
  );
}
