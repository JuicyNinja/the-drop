"use client";

import { useEffect, useState } from "react";
import { publicApi } from "@/app/(ui)/_lib/api";

/**
 * B10 — live handle availability. Debounces the typed handle and asks the
 * unauthenticated GET /v1/auth/handle-available, which judges the same
 * confusable-normalized form the server enforces at submit, so an "available"
 * here will not be rejected later. The endpoint returns only `{ available }`
 * (taken, reserved, and confusable all collapse to false) — this hook never
 * surfaces which; it only reports available / taken.
 *
 * When `currentHandle` is given (the edit-profile case), a handle that matches
 * the caller's own current handle short-circuits to "current" — otherwise it
 * would report as taken (by themselves).
 *
 * The immediate states (idle / short / current) are derived purely during
 * render; only the network result is held in state, and it is set solely inside
 * the debounced async callback — never synchronously in the effect body
 * (React 19 forbids that, and it would cascade renders).
 */
export type HandleStatus = "idle" | "short" | "checking" | "available" | "taken" | "current";

const norm = (h: string) => h.trim().toLowerCase();

export function useHandleAvailability(handle: string, currentHandle?: string): HandleStatus {
  const trimmed = norm(handle);
  const isCurrent = currentHandle !== undefined && trimmed.length > 0 && trimmed === norm(currentHandle);
  const needsCheck = trimmed.length >= 3 && !isCurrent;

  // The network verdict, tagged with the handle it was for, so a stale result
  // for a previous keystroke never surfaces against the current input.
  const [remote, setRemote] = useState<{ h: string; status: "available" | "taken" | "idle" } | null>(null);

  useEffect(() => {
    if (!needsCheck) return; // no setState in the effect body
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        const r = await publicApi<{ available: boolean }>(
          `/v1/auth/handle-available?handle=${encodeURIComponent(trimmed)}`,
        );
        if (!alive) return;
        // On a rate-limit or transient failure, fall back to "idle" (no hint);
        // the submit path still validates authoritatively.
        setRemote({ h: trimmed, status: r.ok && r.data ? (r.data.available ? "available" : "taken") : "idle" });
      })();
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [trimmed, needsCheck]);

  if (trimmed.length === 0) return "idle";
  if (isCurrent) return "current";
  if (trimmed.length < 3) return "short";
  if (remote && remote.h === trimmed) return remote.status === "idle" ? "idle" : remote.status;
  return "checking";
}

/** The one-line hint shown beneath a handle field for a given status. */
export function handleHint(status: HandleStatus): { text: string; tone: "ok" | "bad" | "muted" } | null {
  switch (status) {
    case "available": return { text: "Available", tone: "ok" };
    case "taken": return { text: "Not available", tone: "bad" };
    case "checking": return { text: "Checking", tone: "muted" };
    case "short": return { text: "At least 3 characters", tone: "muted" };
    case "current": return { text: "Your current handle", tone: "muted" };
    default: return null;
  }
}
