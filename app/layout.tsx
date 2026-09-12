import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Drop",
  description: "Drops. Catches. Gone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
