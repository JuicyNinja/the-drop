import type { Metadata } from "next";
import { Inter, Newsreader, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Claude Design type system (design-system/design.md): Inter for display + UI,
// Newsreader for body copy, JetBrains Mono for timers/codes/labels. next/font
// self-hosts these from /_next/static, so the strict CSP (font-src 'self') is
// satisfied without a Google Fonts origin. Each exposes a CSS variable that
// tokens.css consumes via --font-display / --font-body / --font-data.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "The Drop",
  description: "Drops. Catches. Gone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
