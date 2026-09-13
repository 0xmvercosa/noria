import {
  createPublicClient,
  encodeDeployData,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
  type Transaction,
  type TransactionReceipt,
} from "viem";
import { arbitrum } from "viem/chains";
import routerArtifact from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import { LAUNCH } from "../../src/integrations/aqua/launch-contract";
import {
  createLaunchService,
  officialRuntimeHashes,
} from "../../src/integrations/aqua/launch-service";
import type { ForgeArtifact } from "./aqua-artifacts";

export type Stage = "adapter" | "factory";
export type DeploymentReview = {
  stage: Stage;
  owner: Address;
  chainId: 42161;
  nonce: number;
  expectedAddress: Address;
  data: Hex;
  value: "0x0";
  gas: Hex;
  gasEstimate: string;
  estimatedFeeWei: string;
  balanceWei: string;
  blockNumber: string;
  blockHash: Hex;
  expiresAt: number;
  constructorArgs: unknown[];
  adapter: Address | null;
};
export const adapterArgs = [
  LAUNCH.uniswapRouter,
  LAUNCH.weth,
  LAUNCH.usdc,
  LAUNCH.adapterFee,
] as const;
export const protocols = (adapter: Address) => ({
  weth: LAUNCH.weth,
  usdc: LAUNCH.usdc,
  aWeth: LAUNCH.aWeth,
  aUsdc: LAUNCH.aUsdc,
  debtUSDC: LAUNCH.variableDebtUSDC,
  aave: LAUNCH.aavePool,
  aqua: LAUNCH.aqua,
  swapVM: LAUNCH.swapVm,
  adapter,
});
const requireMatch = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};

/** Pure receipt binding. A successful unrelated deployment can never advance the wizard. */
export function assertDeploymentReceipt(
  review: Pick<
    DeploymentReview,
    "owner" | "nonce" | "data" | "expectedAddress"
  >,
  tx: Pick<
    Transaction,
    "from" | "to" | "input" | "value" | "nonce" | "chainId" | "blockHash"
  >,
  receipt: Pick<TransactionReceipt, "status" | "contractAddress" | "blockHash">,
) {
  requireMatch(
    tx.from.toLowerCase() === review.owner.toLowerCase() &&
      !tx.to &&
      tx.input.toLowerCase() === review.data.toLowerCase() &&
      tx.value === 0n &&
      tx.nonce === review.nonce &&
      tx.chainId === 42161 &&
      tx.blockHash === receipt.blockHash,
    "Receipt does not match the exact reviewed creation transaction, wallet, chain and nonce.",
  );
  if (receipt.status === "success")
    requireMatch(
      receipt.contractAddress?.toLowerCase() ===
        review.expectedAddress.toLowerCase(),
      "Unexpected deployed contract address.",
    );
}

export function createDeploymentService(
  artifacts: { factory: ForgeArtifact; adapter: ForgeArtifact },
  owner: Address,
  readOnlyRpcUrl?: string,
) {
  const client = createPublicClient({
    chain: arbitrum,
    transport: http(
      readOnlyRpcUrl ||
        process.env.ARBITRUM_RPC_URL?.trim() ||
        "https://arb1.arbitrum.io/rpc",
      { timeout: 20_000, retryCount: 1 },
    ),
  });
  async function checkRuntime(
    address: Address,
    data: Hex,
    blockNumber: bigint,
  ) {
    const [actual, expected] = await Promise.all([
      client.getCode({ address, blockNumber }),
      client.call({ data, blockNumber }),
    ]);
    requireMatch(
      !!actual &&
        actual !== "0x" &&
        !!expected.data &&
        keccak256(actual!) === keccak256(expected.data!),
      "Contract runtime differs from the reviewed constructor and configuration.",
    );
    return keccak256(actual!);
  }
  const adapterData = encodeDeployData({
    abi: artifacts.adapter.abi,
    bytecode: artifacts.adapter.bytecode.object,
    args: adapterArgs,
  });
  async function checkAdapter(address: Address, blockNumber: bigint) {
    return checkRuntime(address, adapterData, blockNumber);
  }
  async function preflight() {
    requireMatch(
      (await client.getChainId()) === 42161,
      "RPC must be Arbitrum One (42161).",
    );
    const block = await client.getBlock();
    requireMatch(
      Math.abs(Date.now() / 1000 - Number(block.timestamp)) < 90,
      "RPC head is stale. Refresh the provider before deployment.",
    );
    await Promise.all(
      Object.entries(officialRuntimeHashes).map(async ([address, hash]) => {
        const code = await client.getCode({
          address: address as Address,
          blockNumber: block.number,
        });
        requireMatch(
          !!code && keccak256(code!) === hash,
          "Official Aqua/SwapVM code differs from the reviewed deployment.",
        );
      }),
    );
    await checkRuntime(
      LAUNCH.uniswapRouter,
      encodeDeployData({
        abi: routerArtifact.abi,
        bytecode: routerArtifact.bytecode as Hex,
        args: [LAUNCH.uniswapFactory, LAUNCH.weth],
      }),
      block.number,
    );
    const abi = parseAbi([
      "function UNDERLYING_ASSET_ADDRESS() view returns(address)",
      "function POOL() view returns(address)",
    ]);
    await Promise.all(
      [
        [LAUNCH.aWeth, LAUNCH.weth],
        [LAUNCH.aUsdc, LAUNCH.usdc],
        [LAUNCH.variableDebtUSDC, LAUNCH.usdc],
      ].map(async ([address, asset]) => {
        const [underlying, pool] = await Promise.all([
          client.readContract({
            address: address as Address,
            abi,
            functionName: "UNDERLYING_ASSET_ADDRESS",
            blockNumber: block.number,
          }),
          client.readContract({
            address: address as Address,
            abi,
            functionName: "POOL",
            blockNumber: block.number,
          }),
        ]);
        requireMatch(
          underlying.toLowerCase() === asset &&
            pool.toLowerCase() === LAUNCH.aavePool,
          "Aave receipt/debt token identity differs from canonical configuration.",
        );
      }),
    );
    return block;
  }
  async function prepare(
    stage: Stage,
    adapter: Address | null,
  ): Promise<DeploymentReview> {
    const block = await preflight();
    if (stage === "factory") {
      requireMatch(!!adapter, "Verify the adapter deployment first.");
      await checkAdapter(adapter!, block.number);
    }
    const constructorArgs =
      stage === "adapter" ? [...adapterArgs] : [protocols(adapter!)];
    const a = artifacts[stage];
    const data = encodeDeployData({
      abi: a.abi,
      bytecode: a.bytecode.object,
      args: constructorArgs,
    });
    const [nonce, balance, gasPrice, gasEstimate] = await Promise.all([
      client.getTransactionCount({ address: owner, blockTag: "pending" }),
      client.getBalance({ address: owner, blockNumber: block.number }),
      client.getGasPrice(),
      client.estimateGas({ account: owner, data, value: 0n }),
    ]);
    const gas = (gasEstimate * 120n + 99n) / 100n;
    requireMatch(
      balance >= gas * gasPrice,
      "The deployer needs more ETH on Arbitrum for this gas estimate. Fund it and refresh; USDC cannot pay gas.",
    );
    return {
      stage,
      owner,
      chainId: 42161,
      nonce,
      expectedAddress: getContractAddress({
        from: owner,
        nonce: BigInt(nonce),
      }),
      data,
      value: "0x0",
      gas: `0x${gas.toString(16)}`,
      gasEstimate: String(gasEstimate),
      estimatedFeeWei: String(gas * gasPrice),
      balanceWei: String(balance),
      blockNumber: String(block.number),
      blockHash: block.hash,
      expiresAt: Date.now() + 120_000,
      constructorArgs,
      adapter,
    };
  }
  async function verify(review: DeploymentReview, hash: Hex) {
    const expected = encodeDeployData({
      abi: artifacts[review.stage].abi,
      bytecode: artifacts[review.stage].bytecode.object,
      args:
        review.stage === "adapter" ? adapterArgs : [protocols(review.adapter!)],
    });
    requireMatch(
      review.owner === owner &&
        review.data === expected &&
        review.expectedAddress ===
          getContractAddress({ from: owner, nonce: BigInt(review.nonce) }),
      "Saved review does not match this wallet and reviewed build.",
    );
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);
    assertDeploymentReceipt(review, tx, receipt);
    const canonical = await client.getBlock({
      blockNumber: receipt.blockNumber,
    });
    requireMatch(
      canonical.hash === receipt.blockHash,
      "Receipt is no longer on the canonical chain.",
    );
    if (receipt.status === "reverted")
      return {
        transaction: tx,
        receipt,
        runtimeHash: null,
        verifiedAt: new Date().toISOString(),
      };
    const runtimeHash = await checkRuntime(
      review.expectedAddress,
      review.data,
      receipt.blockNumber,
    );
    if (review.stage === "factory") {
      const snapshot = await createLaunchService({
        client,
        factoryAddress: () => review.expectedAddress,
      }).snapshot(owner);
      requireMatch(
        snapshot.status === "ready",
        "The public launch service did not accept this factory.",
      );
    }
    return {
      transaction: tx,
      receipt,
      runtimeHash,
      verifiedAt: new Date().toISOString(),
    };
  }
  return { client, preflight, prepare, verify, checkAdapter };
}
