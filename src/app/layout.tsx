import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { NoriaWalletProvider } from "../components/NoriaWalletProvider";
import { EthUsdProvider } from "../components/EthUsd";
import "./globals.css";

export const metadata: Metadata = {
  title: "Noria Discover — Inspect your liquidity decision",
  description:
    "Turn capital and intent into an inspectable Uniswap v3 position analysis, with live Graph data, independent onchain verification, and a downloadable analysis report.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en">
      <body>
        <EthUsdProvider>
          <NoriaWalletProvider nonce={nonce}>{children}</NoriaWalletProvider>
        </EthUsdProvider>
      </body>
    </html>
  );
}
