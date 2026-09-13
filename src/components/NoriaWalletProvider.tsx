"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PrivyProvider,
  getEmbeddedConnectedWallet,
  useCreateWallet,
  useFundWallet,
  useFiatOnramp,
  usePrivy,
  useSendTransaction,
  useWallets,
} from "@privy-io/react-auth";
import { arbitrum } from "viem/chains";
import { formatUnits, type Hash } from "viem";
import {
  PreparedSchema,
  assertReserveAction,
  assertReserveGas,
  reserveActionDetails,
  isTransferAction,
  reserveTransaction,
  type PreparedReserveAction,
} from "../integrations/privy/reserve";
import { euroOnrampOptions } from "../integrations/privy/fiat";
import {
  assertPreparedLaunch,
  launchTransaction,
  type LaunchPrepared,
} from "../integrations/aqua/launch-contract";

type WalletContext = {
  configured: boolean;
  ready: boolean;
  address: string | null;
  chainId: string | null;
  error: string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
  switchToArbitrum: () => Promise<void>;
  fund: (asset: "USDC" | "ETH") => Promise<void>;
  fundWithEuro: (
    amount: string,
  ) => Promise<{ status: "submitted" | "confirmed" }>;
  sendReserveAction: (prepared: PreparedReserveAction) => Promise<Hash>;
  sendLaunchAction: (prepared: LaunchPrepared, plan?: unknown) => Promise<Hash>;
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
  fund: async () => {
    throw new Error("Privy is not configured.");
  },
  fundWithEuro: async () => {
    throw new Error("Privy is not configured.");
  },
  sendReserveAction: async () => {
    throw new Error("Privy is not configured.");
  },
  sendLaunchAction: async () => {
    throw new Error("Privy is not configured.");
  },
};
const NoriaWalletContext = createContext<WalletContext>(unavailable);
export function useNoriaWallet() {
  return useContext(NoriaWalletContext);
}

function ConnectedWalletProvider({ children }: { children: ReactNode }) {
  const { ready: privyReady, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { fundWallet } = useFundWallet();
  const { fund: fiatOnramp } = useFiatOnramp();
  const { sendTransaction } = useSendTransaction();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const wallet = authenticated
    ? getEmbeddedConnectedWallet(wallets)
    : undefined;
  const activeAddress = useRef(wallet?.address);
  activeAddress.current = wallet?.address;

  function connect() {
    setError(null);
    if (!authenticated) {
      login();
      return;
    }
    if (wallet || creating) return;
    setCreating(true);
    void createWallet()
      .catch(() =>
        setError("Wallet creation was not completed. Please try again."),
      )
      .finally(() => setCreating(false));
  }
  async function disconnect() {
    setError(null);
    try {
      await logout();
    } catch {
      setError("Sign-out was not completed. Please try again.");
    }
  }
  async function switchToArbitrum() {
    setError(null);
    try {
      await wallet?.switchChain(arbitrum.id);
    } catch {
      setError("The wallet network could not be changed.");
    }
  }
  async function fund(asset: "USDC" | "ETH") {
    if (!wallet) throw new Error("Create your Privy wallet first.");
    // Established funding hook in pinned SDK 3.42.0. The newer useAddFunds is experimental.
    // Dismissal or completion here never proves that funds arrived on Arbitrum.
    await fundWallet({
      address: wallet.address,
      options: {
        chain: arbitrum,
        asset: asset === "USDC" ? "USDC" : "native-currency",
        amount: asset === "USDC" ? "10" : "0.001",
        defaultFundingMethod: "wallet",
      },
    });
  }
  async function sendReserveAction(
    input: PreparedReserveAction,
  ): Promise<Hash> {
    const prepared = PreparedSchema.parse(input);
    const owner = prepared.action.owner;
    const isCurrent = () =>
      activeAddress.current?.toLowerCase() === owner.toLowerCase();
    if (!wallet || !isCurrent())
      throw new Error("The wallet changed. Review this operation again.");
    assertReserveAction(prepared.action, prepared.before);
    assertReserveGas(
      prepared.action,
      prepared.before,
      prepared.estimatedGasWei,
    );
    await wallet.switchChain(arbitrum.id);
    if (!isCurrent() || Date.now() >= prepared.expiresAt)
      throw new Error("This review expired. Refresh it before signing.");
    const tx = reserveTransaction(prepared.action);
    const details = reserveActionDetails(prepared.action);
    const amount = formatUnits(
      BigInt(prepared.action.amountUnits),
      details.decimals,
    );
    const { hash } = await sendTransaction(
      { ...tx, from: owner },
      {
        address: owner,
        uiOptions: {
          showWalletUIs: true,
          isCancellable: true,
          description:
            prepared.action.kind === "revoke"
              ? "Remove Aave's USDC allowance on Arbitrum"
              : isTransferAction(prepared.action)
                ? `Send ${amount} ${details.asset} to ${details.recipient} on Arbitrum. Network fees are paid separately in ETH.`
                : `${prepared.action.kind} ${amount} USDC on Arbitrum. The reserve belongs to your Privy wallet.`,
          buttonText: "Confirm operation",
        },
      },
    );
    return hash;
  }
  return (
    <NoriaWalletContext.Provider
      value={{
        configured: true,
        // Opening login must not wait for the embedded wallet iframe.
        ready: privyReady && !creating && (!authenticated || walletsReady),
        address: wallet?.address ?? null,
        chainId: wallet?.chainId ?? null,
        error,
        connect,
        disconnect,
        switchToArbitrum,
        fund,
        fundWithEuro: async (amount) => {
          if (
            !wallet ||
            activeAddress.current?.toLowerCase() !==
              wallet.address.toLowerCase()
          )
            throw new Error("Create your Privy wallet first.");
          // The pinned SDK marks this interface experimental; ordinary signed
          // transfers/deposits remain the submission's qualifying wallet action.
          return fiatOnramp(euroOnrampOptions(wallet.address, amount));
        },
        sendReserveAction,
        sendLaunchAction: async (input, plan) => {
          const prepared = assertPreparedLaunch(input, input.request, plan);
          const owner = prepared.request.owner;
          const isCurrent = () =>
            activeAddress.current?.toLowerCase() === owner.toLowerCase();
          if (!wallet || !isCurrent())
            throw new Error(
              "The wallet changed. Review the position operation again.",
            );
          await wallet.switchChain(arbitrum.id);
          if (!isCurrent())
            throw new Error("The wallet changed. Review again.");
          assertPreparedLaunch(prepared, prepared.request, plan);
          const tx = launchTransaction(prepared);
          const { hash } = await sendTransaction(
            { ...tx, from: owner },
            {
              address: owner,
              uiOptions: {
                showWalletUIs: true,
                isCancellable: true,
                description: `Noria Aqua: ${prepared.request.kind} on Arbitrum. Confirm the reviewed amount and destination; network fees are paid separately in ETH.`,
                buttonText: "Confirm position operation",
              },
            },
          );
          return hash;
        },
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
        loginMethods: ["email", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          solana: { createOnLogin: "off" },
          showWalletUIs: true,
        },
        appearance: {
          theme: "dark",
          accentColor: "#d3f78b",
          walletChainType: "ethereum-only",
        },
      }}
    >
      <ConnectedWalletProvider>{children}</ConnectedWalletProvider>
    </PrivyProvider>
  );
}
