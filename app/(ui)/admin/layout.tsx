import type { ReactNode } from "react";
import { AdminShell } from "./_lib/shell";

/** Admin portal shell. Admin-gated; reuses the operator portal's dense styling. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
