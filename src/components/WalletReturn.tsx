"use client";

import { useEffect } from "react";
import { consumeWalletReturn } from "../integrations/privy/navigation";
import { useNoriaWallet } from "./NoriaWalletProvider";
import { NoriaWallet } from "./NoriaWallet";
import s from "./AquaWorkbench.module.css";

export function WalletReturn() {
  const wallet = useNoriaWallet();
  useEffect(() => {
    if (wallet.ready && wallet.address)
      window.location.replace(consumeWalletReturn());
  }, [wallet.ready, wallet.address]);
  return (
    <main className={s.main}>
      <section className={s.panel}>
        <h1>Returning to your Noria wallet</h1>
        <p>
          Finish signing in to continue your saved journey. No funds move during
          sign-in.
        </p>
        <NoriaWallet />
        <p>
          <a href="/reserve">Continue to wallet and funds</a>
        </p>
      </section>
    </main>
  );
}
