import type { ReactNode } from "react";

/**
 * Force dynamic rendering for the whole authenticated UI tree.
 *
 * The strict CSP (middleware.ts) uses a per-request nonce on script-src with
 * 'strict-dynamic'. Next can only stamp that nonce onto its bootstrap <script>
 * tags when a route is server-rendered per request. Statically prerendered
 * routes bake their HTML at build time with no runtime nonce, so every script
 * is blocked and the page never hydrates. These pages are client components
 * that fetch after mount, so per-request rendering of the shell is cheap and
 * changes no behavior — it only lets the nonce be applied. Without this, the
 * board, wallet, redeem and profile are inert in a production build.
 */
export const dynamic = "force-dynamic";

/** The (ui) tree. Buyer and operator each carry their own shell in a nested
 *  route group ((buyer) has the nav rail; (operator) has the scoreboard). */
export default function UiLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
