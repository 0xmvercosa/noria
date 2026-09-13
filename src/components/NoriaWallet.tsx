"use client";

import { ChevronDown, Wallet } from "lucide-react";
import { useNoriaWallet } from "./NoriaWalletProvider";
import s from "./AquaWorkbench.module.css";

export function NoriaWallet() {
  const wallet = useNoriaWallet();
  return (
    <div className={s.wallet}>
      {!wallet.configured ? (
        <span
          className={s.walletUnavailable}
          title="Privy wallet access has not been configured for this deployment."
        >
          <Wallet size={14} aria-hidden="true" /> Wallet unavailable
        </span>
      ) : !wallet.address ? (
        <button
          className={s.walletButton}
          type="button"
          disabled={!wallet.ready}
          onClick={wallet.connect}
        >
          <Wallet size={14} aria-hidden="true" />
          {wallet.ready ? "Create or open wallet" : "Loading wallet…"}
        </button>
      ) : (
        <details className={s.walletMenu}>
          <summary className={s.walletButton}>
            <span className={s.connectionDot} aria-hidden="true" />
            <span>
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
            <span className={s.srOnly}>Connected wallet settings</span>
          </summary>
          <div className={s.walletDropdown}>
            <strong>Your Privy wallet</strong>
            <code>{wallet.address}</code>
            <p>
              {wallet.chainId === "eip155:42161"
                ? "Arbitrum One"
                : "Your wallet is on another network."}
            </p>
            {wallet.chainId !== "eip155:42161" && (
              <button
                type="button"
                onClick={() => void wallet.switchToArbitrum()}
              >
                Switch to Arbitrum
              </button>
            )}
            <button type="button" onClick={() => void wallet.disconnect()}>
              Sign out
            </button>
          </div>
        </details>
      )}
      {wallet.error && (
        <div className={s.walletError} role="alert">
          <p>{wallet.error}</p>
          {!wallet.ready && (
            <button type="button" onClick={wallet.retry}>
              Retry wallet connection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
