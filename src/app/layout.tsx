import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NoriaWalletProvider } from "../components/NoriaWalletProvider";
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
      <body>
        <NoriaWalletProvider>{children}</NoriaWalletProvider>
      </body>
    </html>
  );
}
