"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, SESSION_EVENT } from "@/app/(ui)/_lib/api";

/**
 * Buyer address context. Holds the saved addresses and which one is active, so
 * the persistent header indicator (PRD §8.1 — a buyer must always know which
 * market they are browsing) and the address manager on You share one source of
 * truth. A mutation calls `refresh()` and the header updates immediately.
 */

export interface Address {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  radius_miles: number;
  is_home: boolean;
  lat: number | null;
  lng: number | null;
  formatted_address: string | null;
}

export interface Follow {
  org_id: string;
  name: string;
  lane: string;
  tier: "follower" | "fanatic";
}

export interface FollowResult {
  ok: boolean;
  code?: string;
  message?: string;
  fanatics?: { org_id: string; name: string }[];
}

interface BuyerCtx {
  addresses: Address[];
  activeId: string | null;
  active: Address | null;
  follows: Follow[];
  loading: boolean;
  refresh: () => Promise<void>;
  followTierOf: (orgId: string) => "follower" | "fanatic" | null;
  setFollow: (orgId: string, tier: "follower" | "fanatic") => Promise<FollowResult>;
  unfollow: (orgId: string) => Promise<void>;
}

const Ctx = createContext<BuyerCtx | null>(null);

export function useBuyer(): BuyerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBuyer must be used within BuyerProvider");
  return c;
}

export function BuyerProvider({ children }: { children: ReactNode }) {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [follows, setFollows] = useState<Follow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Unauthenticated calls 401 and simply yield empty state (no session token).
    const [a, me, f] = await Promise.all([
      api<{ addresses: Address[] }>("/v1/addresses"),
      api<{ active_address_id: string | null }>("/v1/users/me"),
      api<Follow[]>("/v1/follows"),
    ]);
    setAddresses(a.ok && a.data ? a.data.addresses : []);
    setActiveId(me.ok && me.data ? (me.data.active_address_id ?? null) : null);
    setFollows(f.ok && f.data ? f.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [a, me, f] = await Promise.all([
        api<{ addresses: Address[] }>("/v1/addresses"),
        api<{ active_address_id: string | null }>("/v1/users/me"),
        api<Follow[]>("/v1/follows"),
      ]);
      if (!alive) return;
      setAddresses(a.ok && a.data ? a.data.addresses : []);
      setActiveId(me.ok && me.data ? (me.data.active_address_id ?? null) : null);
      setFollows(f.ok && f.data ? f.data : []);
      setLoading(false);
    })();
    // The provider sits above RequireAuth, so its first fetch runs before
    // sign-in. Re-fetch when the session changes (sign-in / sign-out) so the
    // header indicator, addresses, and follows populate the moment auth completes.
    const onSession = () => { void refresh(); };
    window.addEventListener(SESSION_EVENT, onSession);
    return () => { alive = false; window.removeEventListener(SESSION_EVENT, onSession); };
  }, [refresh]);

  const followTierOf = useCallback(
    (orgId: string) => follows.find((x) => x.org_id === orgId)?.tier ?? null,
    [follows],
  );

  const setFollow = useCallback(async (orgId: string, tier: "follower" | "fanatic"): Promise<FollowResult> => {
    const r = await api<Follow>(`/v1/follows/${orgId}`, { method: "PUT", body: { tier } });
    if (r.ok && r.data) {
      const updated = r.data;
      setFollows((cur) => [...cur.filter((x) => x.org_id !== orgId), updated]);
      return { ok: true };
    }
    const d = r.error?.details as { fanatics?: { org_id: string; name: string }[] } | undefined;
    return { ok: false, code: r.error?.code, message: r.error?.message, fanatics: d?.fanatics };
  }, []);

  const unfollow = useCallback(async (orgId: string) => {
    const r = await api(`/v1/follows/${orgId}`, { method: "DELETE" });
    if (r.ok) setFollows((cur) => cur.filter((x) => x.org_id !== orgId));
  }, []);

  const active = addresses.find((x) => x.id === activeId) ?? null;
  return (
    <Ctx.Provider value={{ addresses, activeId, active, follows, loading, refresh, followTierOf, setFollow, unfollow }}>
      {children}
    </Ctx.Provider>
  );
}

/** The persistent active-market indicator in the header (PRD §8.1). */
export function ActiveAddressIndicator() {
  const { active, loading } = useBuyer();
  if (loading || !active) return null;
  return (
    <span className="active-address" title={active.formatted_address ?? undefined} aria-label={`Browsing ${active.city}, ${active.region}`}>
      <span className="active-address-dot" aria-hidden />
      <span className="active-address-label">{active.label}</span>
      <span className="active-address-city">{active.city}, {active.region}</span>
    </span>
  );
}
