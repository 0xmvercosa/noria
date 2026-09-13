import { mainnet, base, arbitrum, unichain } from "viem/chains";
import type { Chain } from "viem";
import type { NetworkId, NetworkOption } from "../domain/types";

export interface NetworkConfig extends NetworkOption {
  chain: Chain;
  subgraphId?: string;
  factory?: `0x${string}`;
  rpcUrl?: string;
  llamaChain: string;
  nativePriceKey: string;
  blockLag: number;
  explorerUrl: string;
}
export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  ethereum: {
    id: "ethereum",
    label: "Ethereum",
    available: true,
    chain: mainnet,
    subgraphId: "2SNYtSof7BDC8aCfPy85JZ9Mrh8vYTVecYkeNNtcmQXN",
    factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    llamaChain: "ethereum",
    nativePriceKey: "coingecko:ethereum",
    blockLag: 6,
    explorerUrl: "https://etherscan.io",
  },
  base: {
    id: "base",
    label: "Base",
    available: true,
    subgraphId: "GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz",
    factory: "0x33128a8fc17869897dce68ed026d694621f6fdfd",
    rpcUrl: "https://mainnet.base.org",
    chain: base,
    llamaChain: "base",
    nativePriceKey: "coingecko:ethereum",
    blockLag: 6,
    explorerUrl: "https://basescan.org",
  },
  arbitrum: {
    id: "arbitrum",
    label: "Arbitrum",
    available: true,
    subgraphId: "FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM",
    factory: "0x1f98431c8ad98523631ae4a59f267346ea31f984",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    chain: arbitrum,
    llamaChain: "arbitrum",
    nativePriceKey: "coingecko:ethereum",
    blockLag: 6,
    explorerUrl: "https://arbiscan.io",
  },
  unichain: {
    id: "unichain",
    label: "Unichain",
    available: true,
    subgraphId: "57u1SNex2eyQULFpmSfzcpN87Yp3Q7cJeNKNWLAonSNn",
    factory: "0x1f98400000000000000000000000000000000003",
    rpcUrl: "https://mainnet.unichain.org",
    chain: unichain,
    llamaChain: "unichain",
    nativePriceKey: "coingecko:ethereum",
    blockLag: 6,
    explorerUrl: "https://uniscan.xyz",
  },
};
export function networkOptions(): NetworkOption[] {
  return Object.values(NETWORKS).map(({ id, label, available, reason }) => ({
    id,
    label,
    available,
    ...(reason ? { reason } : {}),
  }));
}
export function networkConfig(id: NetworkId) {
  const n = NETWORKS[id];
  if (!n?.available || !n.subgraphId || !n.factory || !n.rpcUrl)
    throw new Error(n?.reason ?? "Unsupported network.");
  return n as NetworkConfig & {
    subgraphId: string;
    factory: `0x${string}`;
    rpcUrl: string;
  };
}
