import type { ReactNode } from "react";

/** The (ui) tree. Buyer and operator each carry their own shell in a nested
 *  route group ((buyer) has the nav rail; (operator) has the scoreboard). */
export default function UiLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
