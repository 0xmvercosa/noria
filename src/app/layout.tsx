import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Noria Discover — Inspect your liquidity decision",
  description:
    "Turn capital and intent into an inspectable Uniswap v3 position analysis, with live Graph data, independent onchain verification, and a downloadable analysis report.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
