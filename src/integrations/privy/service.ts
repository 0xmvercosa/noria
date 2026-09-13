import { createPublicClient, http, parseEventLogs, type Hash } from "viem";
import { arbitrum } from "viem/chains";
import {
  RESERVE,
  ActionSchema,
  OwnerSchema,
  assertReserveAction,
  reserveTransaction,
  tokenAbi,
  poolAbi,
  aTokenAbi,
  type ReserveAction,
  type ReserveSnapshot,
} from "./reserve";

export function createReserveClient() {
  return createPublicClient({
    chain: arbitrum,
    transport: http(
      process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      { timeout: 12_000, retryCount: 1 },
    ),
  });
}
export type ReserveClient = ReturnType<typeof createReserveClient>;

/** Read-only RPC service. The browser's Privy wallet is the only broadcaster. */
export function createReserveService(
  client: ReserveClient = createReserveClient(),
) {
  async function snapshot(
    ownerInput: string,
    blockNumber?: bigint,
  ): Promise<ReserveSnapshot> {
    const owner = OwnerSchema.parse(ownerInput);
    if ((await client.getChainId()) !== RESERVE.chainId)
      throw new Error("The reserve RPC is not Arbitrum One.");
    const block = await client.getBlock(
      blockNumber === undefined ? { blockTag: "latest" } : { blockNumber },
    );
    const at = { blockNumber: block.number };
    const [
      usdc,
      aUsdc,
      native,
      allowance,
      account,
      config,
      underlying,
      aTokenPool,
    ] = await Promise.all([
      client.readContract({
        ...at,
        address: RESERVE.usdc,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        ...at,
        address: RESERVE.aUsdc,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.getBalance({ ...at, address: owner }),
      client.readContract({
        ...at,
        address: RESERVE.usdc,
        abi: tokenAbi,
        functionName: "allowance",
        args: [owner, RESERVE.pool],
      }),
      client.readContract({
        ...at,
        address: RESERVE.pool,
        abi: poolAbi,
        functionName: "getUserAccountData",
        args: [owner],
      }),
      client.readContract({
        ...at,
        address: RESERVE.pool,
        abi: poolAbi,
        functionName: "getConfiguration",
        args: [RESERVE.usdc],
      }),
      client.readContract({
        ...at,
        address: RESERVE.aUsdc,
        abi: aTokenAbi,
        functionName: "UNDERLYING_ASSET_ADDRESS",
      }),
      client.readContract({
        ...at,
        address: RESERVE.aUsdc,
        abi: aTokenAbi,
        functionName: "POOL",
      }),
    ]);
    if (
      underlying.toLowerCase() !== RESERVE.usdc ||
      aTokenPool.toLowerCase() !== RESERVE.pool
    )
      throw new Error(
        "Aave reserve identity does not match the supported deployment.",
      );
    const bit = (n: bigint) => Boolean((config.data >> n) & 1n);
    return {
      owner,
      chainId: RESERVE.chainId,
      blockNumber: block.number.toString(),
      blockHash: block.hash,
      blockTimestamp: Number(block.timestamp),
      usdcUnits: usdc.toString(),
      aUsdcUnits: aUsdc.toString(),
      nativeWei: native.toString(),
      allowanceUnits: allowance.toString(),
      debtBase: account[1].toString(),
      supplyAvailable: bit(56n) && !bit(57n) && !bit(60n),
      withdrawAvailable: bit(56n) && !bit(60n),
    };
  }

  async function prepare(input: ReserveAction) {
    const action = ActionSchema.parse(input);
    const before = await snapshot(action.owner);
    if (Math.abs(Date.now() / 1000 - before.blockTimestamp) > 90)
      throw new Error("Arbitrum state is stale. Try again shortly.");
    assertReserveAction(action, before);
    const tx = reserveTransaction(action);
    // eth_estimateGas executes the exact calldata. Caps, liquidity and protocol rules
    // are enforced by the official contracts again when the user submits it.
    const [gas, gasPrice] = await Promise.all([
      client.estimateGas({
        account: action.owner,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      }),
      client.getGasPrice(),
    ]);
    const estimatedGasWei = (gas * gasPrice * 120n) / 100n;
    if (BigInt(before.nativeWei) < estimatedGasWei)
      throw new Error(
        "Add ETH on Arbitrum for network fees before continuing.",
      );
    return {
      action,
      before,
      expiresAt: Date.now() + 60_000,
      estimatedGasWei: estimatedGasWei.toString(),
    };
  }

  async function verify(input: ReserveAction, hash: Hash) {
    const action = ActionSchema.parse(input);
    if ((await client.getChainId()) !== RESERVE.chainId)
      throw new Error("The reserve RPC is not Arbitrum One.");
    // A missing receipt is pending, never a successful financial flow.
    const receipt = await client.getTransactionReceipt({ hash });
    const transaction = await client.getTransaction({ hash });
    const expected = reserveTransaction(action);
    const same = (a: string | null, b: string) =>
      a?.toLowerCase() === b.toLowerCase();
    if (
      !same(transaction.from, action.owner) ||
      !same(transaction.to, expected.to) ||
      transaction.input.toLowerCase() !== expected.data.toLowerCase() ||
      transaction.value !== 0n ||
      transaction.chainId !== RESERVE.chainId
    )
      throw new Error(
        "The receipt does not match this wallet, network and exact operation.",
      );
    if (
      transaction.blockHash !== receipt.blockHash ||
      receipt.transactionHash !== hash
    )
      throw new Error("The transaction is not in the reported block.");
    const after = await snapshot(action.owner, receipt.blockNumber);
    if (after.blockHash !== receipt.blockHash)
      throw new Error("The receipt block was reorganized. Check again.");
    let effectVerified = false;
    if (receipt.status === "success") {
      const amount = BigInt(action.amountUnits);
      const tokenLogs = parseEventLogs({
        abi: tokenAbi,
        logs: receipt.logs.filter((l) => same(l.address, RESERVE.usdc)),
      });
      if (action.kind === "approve" || action.kind === "revoke") {
        effectVerified = tokenLogs.some(
          (l) =>
            l.eventName === "Approval" &&
            same(l.args.owner, action.owner) &&
            same(l.args.spender, RESERVE.pool) &&
            l.args.value === amount,
        );
      } else {
        const logs = parseEventLogs({
          abi: poolAbi,
          logs: receipt.logs.filter((l) => same(l.address, RESERVE.pool)),
        });
        const supply = action.kind === "supply";
        const protocolEvent = logs.some((l) =>
          supply
            ? l.eventName === "Supply" &&
              same(l.args.reserve, RESERVE.usdc) &&
              same(l.args.user, action.owner) &&
              same(l.args.onBehalfOf, action.owner) &&
              l.args.amount === amount
            : l.eventName === "Withdraw" &&
              same(l.args.reserve, RESERVE.usdc) &&
              same(l.args.user, action.owner) &&
              same(l.args.to, action.owner) &&
              l.args.amount === amount,
        );
        const transfer = tokenLogs.some(
          (l) =>
            l.eventName === "Transfer" &&
            same(l.args.from, supply ? action.owner : RESERVE.aUsdc) &&
            same(l.args.to, supply ? RESERVE.aUsdc : action.owner) &&
            l.args.value === amount,
        );
        effectVerified = protocolEvent && transfer;
      }
    }
    return {
      schemaVersion: "noria.privy.operation.v1" as const,
      action,
      hash,
      chainId: RESERVE.chainId,
      status:
        receipt.status === "reverted"
          ? ("reverted" as const)
          : effectVerified
            ? ("verified" as const)
            : ("effect-unverified" as const),
      checkedAt: new Date().toISOString(),
      after,
      networkFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
      transaction: {
        from: transaction.from,
        to: transaction.to,
        input: transaction.input,
        value: transaction.value.toString(),
        nonce: transaction.nonce,
      },
      receipt: {
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString(),
        logs: receipt.logs.map((l) => ({
          address: l.address,
          topics: l.topics,
          data: l.data,
          logIndex: l.logIndex,
        })),
      },
      finality:
        "Sequencer inclusion checked against current RPC; not Ethereum finality.",
    };
  }
  return { snapshot, prepare, verify };
}
export type ReserveVerification = Awaited<
  ReturnType<ReturnType<typeof createReserveService>["verify"]>
>;
