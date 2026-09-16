import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";

/** Buyer shell: the terminal hall with its nav rail. */
export default function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
