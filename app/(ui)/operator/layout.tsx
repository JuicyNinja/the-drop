import type { ReactNode } from "react";
import { OperatorShell } from "./_lib/shell";

/** Operator shell: the persistent scoreboard and org context on every screen. */
export default function OperatorLayout({ children }: { children: ReactNode }) {
  return <OperatorShell>{children}</OperatorShell>;
}
