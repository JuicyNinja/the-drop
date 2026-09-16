import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { BuyerProvider } from "./_lib/buyer";

/** Buyer shell: the terminal hall with its nav rail and the persistent
 *  active-market indicator (PRD §8.1). */
export default function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <BuyerProvider>
      <Nav />
      {children}
    </BuyerProvider>
  );
}
