"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  PrivyProvider,
  useConnectWallet,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { arbitrum } from "viem/chains";

type WalletContext = {
  configured: boolean;
  ready: boolean;
  address: string | null;
  chainId: string | null;
  error: string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
  switchToArbitrum: () => Promise<void>;
};
const unavailable: WalletContext = {
  configured: false,
  ready: true,
  address: null,
  chainId: null,
  error: null,
  connect: () => {},
  disconnect: async () => {},
  switchToArbitrum: async () => {},
};
const NoriaWalletContext = createContext<WalletContext>(unavailable);
export function useNoriaWallet() {
  return useContext(NoriaWalletContext);
}

function ConnectedWalletProvider({ children }: { children: ReactNode }) {
  const { ready: privyReady } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [error, setError] = useState<string | null>(null);
  const { connectWallet } = useConnectWallet({
    onSuccess: () => setError(null),
    onError: () =>
      setError("The wallet connection was not completed. You can try again."),
  });
  const wallet = wallets.find(
    (candidate) =>
      !String(candidate.walletClientType).startsWith("privy") &&
      candidate.connectorType !== "embedded",
  );
  // Use the external connection flow, without login, signing, or transactions.
  function connect() {
    setError(null);
    try {
      connectWallet();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Wallet connection is unavailable.",
      );
    }
  }
  async function disconnect() {
    setError(null);
    try {
      await wallet?.disconnect();
      if (await wallet?.isConnected())
        setError("Disconnect this site in your wallet to end the connection.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The wallet could not be disconnected.",
      );
    }
  }
  async function switchToArbitrum() {
    setError(null);
    try {
      await wallet?.switchChain(arbitrum.id);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The wallet network could not be changed.",
      );
    }
  }
  return (
    <NoriaWalletContext.Provider
      value={{
        configured: true,
        ready: privyReady && walletsReady,
        address: wallet?.address ?? null,
        chainId: wallet?.chainId ?? null,
        error,
        connect,
        disconnect,
        switchToArbitrum,
      }}
    >
      {children}
    </NoriaWalletContext.Provider>
  );
}

export function NoriaWalletProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  if (!appId)
    return (
      <NoriaWalletContext.Provider value={unavailable}>
        {children}
      </NoriaWalletContext.Provider>
    );
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: arbitrum,
        supportedChains: [arbitrum],
        loginMethods: ["wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
        appearance: {
          theme: "dark",
          accentColor: "#d3f78b",
          walletChainType: "ethereum-only",
          walletList: [
            "detected_wallets",
            "metamask",
            "coinbase_wallet",
            "wallet_connect",
          ],
        },
      }}
    >
      <ConnectedWalletProvider>{children}</ConnectedWalletProvider>
    </PrivyProvider>
  );
}
