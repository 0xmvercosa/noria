"use client";

import { ChevronDown, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNoriaWallet } from "./NoriaWalletProvider";
import s from "./AquaWorkbench.module.css";

export function NoriaWallet() {
  const wallet = useNoriaWallet();
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const retryInHeader =
    !wallet.ready && !!wallet.error && wallet.error === dismissedError;
  const closeMenu = () => {
    if (menu.current) menu.current.open = false;
  };
  useEffect(() => {
    setDismissedError(null);
    if (wallet.error) closeMenu();
  }, [wallet.error]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        closeMenu();
        trigger.current?.focus();
      }
    };
    const onOutside = (event: PointerEvent) => {
      if (
        menu.current?.open &&
        event.target instanceof Node &&
        !menu.current.contains(event.target)
      )
        closeMenu();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
    };
  }, []);
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
          disabled={!wallet.ready && !retryInHeader}
          onClick={retryInHeader ? wallet.retry : wallet.connect}
        >
          <Wallet size={14} aria-hidden="true" />
          {retryInHeader
            ? "Retry wallet connection"
            : wallet.ready
              ? "Create or open wallet"
              : "Loading wallet…"}
        </button>
      ) : (
        <details
          className={s.walletMenu}
          ref={menu}
          onToggle={(event) => setMenuOpen(event.currentTarget.open)}
        >
          <summary className={s.walletButton} ref={trigger}>
            <span className={s.connectionDot} aria-hidden="true" />
            <span>
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
            <span className={s.srOnly}>Connected wallet settings</span>
          </summary>
          <div className={s.walletDropdown}>
            <button
              type="button"
              onClick={() => {
                closeMenu();
                trigger.current?.focus();
              }}
            >
              <X size={16} aria-hidden="true" /> Close wallet menu
            </button>
            <strong>Your Privy wallet</strong>
            <code>{wallet.address}</code>
            {wallet.error && <p role="alert">{wallet.error}</p>}
            <p>
              {wallet.chainId === "eip155:42161"
                ? "Arbitrum One"
                : "Your wallet is on another network."}
            </p>
            <a href="/reserve" onClick={closeMenu}>
              Balances, transfers &amp; activity
            </a>
            <a href="/reserve#fund-heading" onClick={closeMenu}>
              Buy USDC with euros
            </a>
            {wallet.chainId !== "eip155:42161" && (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  void wallet.switchToArbitrum();
                }}
              >
                Switch to Arbitrum
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                closeMenu();
                void wallet.disconnect();
              }}
            >
              Sign out
            </button>
          </div>
        </details>
      )}
      {wallet.error && wallet.error !== dismissedError && !menuOpen && (
        <div className={s.walletError} role="alert">
          <p>{wallet.error}</p>
          {!wallet.ready && (
            <button type="button" onClick={wallet.retry}>
              Retry wallet connection
            </button>
          )}
          <button type="button" onClick={() => setDismissedError(wallet.error)}>
            Dismiss message
          </button>
        </div>
      )}
    </div>
  );
}
