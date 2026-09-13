import { z } from "zod";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  type Address,
} from "viem";

/** Wallet transfers and savings use Arbitrum One and its native USDC deployment. */
export const RESERVE = {
  chainId: 42161,
  usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  aUsdc: "0x724dc807b04555b71ed48a6896b6f41593b8c637",
  pool: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
} as const;

export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function transfer(address,uint256) returns(bool)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export const poolAbi = parseAbi([
  "function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)",
  "function withdraw(address asset,uint256 amount,address to) returns(uint256)",
  "function getConfiguration(address asset) view returns((uint256 data))",
  "function getUserAccountData(address user) view returns(uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)",
  "event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)",
  "event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)",
]);
export const aTokenAbi = parseAbi([
  "function UNDERLYING_ASSET_ADDRESS() view returns(address)",
  "function POOL() view returns(address)",
]);

export const OwnerSchema = z
  .string()
  .refine(
    (v) => isAddress(v, { strict: true }),
    "Use a valid wallet address with a correct checksum.",
  )
  .transform((v) => getAddress(v))
  .refine((v) => BigInt(v) !== 0n, "A nonzero wallet is required.");
const SavingsActionSchema = z
  .object({
    owner: OwnerSchema,
    kind: z.enum(["approve", "supply", "withdraw", "revoke"]),
    // A fixed demo/product limit keeps the confirmation readable; never round a user's input.
    amountUnits: z
      .string()
      .regex(/^\d{1,12}$/)
      .refine(
        (v) => /^\d{1,12}$/.test(v) && BigInt(v) <= 1000_000_000n,
        "Use at most 1,000 USDC per operation.",
      )
      .transform((v) => BigInt(v).toString()),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!/^\d{1,12}$/.test(value.amountUnits)) return;
    if (
      value.kind === "revoke"
        ? BigInt(value.amountUnits) !== 0n
        : BigInt(value.amountUnits) === 0n
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Use zero only for revocation; all other amounts must be positive.",
      });
  });

/** Transfer caps are the EVM uint256 bound, not the separate 1,000 USDC savings cap.
 * The actual spendable maximum is the wallet balance, less ETH network fees. */
export const MAX_TRANSFER_UNITS = (1n << 256n) - 1n;
export type WalletAsset = "USDC" | "ETH";
const TransferUnitsSchema = z
  .string()
  .regex(/^\d{1,78}$/)
  .refine(
    (v) =>
      /^\d{1,78}$/.test(v) && BigInt(v) > 0n && BigInt(v) <= MAX_TRANSFER_UNITS,
    "Use a positive amount within the uint256 transfer limit.",
  )
  .transform((v) => BigInt(v).toString());
const TransferActionSchema = z
  .object({
    owner: OwnerSchema,
    kind: z.enum(["transfer-usdc", "transfer-eth"]),
    recipient: OwnerSchema,
    amountUnits: TransferUnitsSchema,
  })
  .strict();
export const ActionSchema = z.union([
  SavingsActionSchema,
  TransferActionSchema,
]);
export type SavingsAction = z.infer<typeof SavingsActionSchema>;
export type TransferAction = z.infer<typeof TransferActionSchema>;
export type ReserveAction = z.infer<typeof ActionSchema>;

export function isTransferAction(
  action: ReserveAction,
): action is TransferAction {
  return action.kind === "transfer-usdc" || action.kind === "transfer-eth";
}

export function reserveActionDetails(input: ReserveAction): {
  asset: WalletAsset;
  decimals: 6 | 18;
  recipient: Address;
} {
  const action = ActionSchema.parse(input);
  return {
    asset: action.kind === "transfer-eth" ? "ETH" : "USDC",
    decimals: action.kind === "transfer-eth" ? 18 : 6,
    recipient: isTransferAction(action) ? action.recipient : action.owner,
  };
}

/** Compare normalized strict actions, including the transfer recipient. */
export function sameReserveAction(a: ReserveAction, b: ReserveAction): boolean {
  return (
    JSON.stringify(ActionSchema.parse(a)) ===
    JSON.stringify(ActionSchema.parse(b))
  );
}
export const SnapshotSchema = z.object({
  owner: OwnerSchema,
  chainId: z.literal(42161),
  blockNumber: z.string().regex(/^\d+$/),
  blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  blockTimestamp: z.number().int(),
  usdcUnits: z.string().regex(/^\d+$/),
  aUsdcUnits: z.string().regex(/^\d+$/),
  nativeWei: z.string().regex(/^\d+$/),
  allowanceUnits: z.string().regex(/^\d+$/),
  debtBase: z.string().regex(/^\d+$/),
  supplyAvailable: z.boolean(),
  withdrawAvailable: z.boolean(),
});
export type ReserveSnapshot = z.infer<typeof SnapshotSchema>;

export function parseUsdc(value: string): string | null {
  if (!/^\d{1,4}(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return units > 0n && units <= 1000_000_000n ? units.toString() : null;
}

/** Exact decimal parsing: never round, accept exponents, or apply the savings cap. */
export function parseTransferAmount(
  value: string,
  asset: WalletAsset,
): string | null {
  const decimals = asset === "ETH" ? 18 : 6;
  if (!new RegExp(`^\\d{1,78}(\\.\\d{1,${decimals}})?$`).test(value))
    return null;
  const [whole, fraction = ""] = value.split(".");
  const units =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  return units > 0n && units <= MAX_TRANSFER_UNITS ? units.toString() : null;
}

/** Reconstructed in the browser too: the server never supplies arbitrary executable calldata. */
export function reserveTransaction(input: ReserveAction) {
  const action = ActionSchema.parse(input);
  const amount = BigInt(action.amountUnits);
  if (isTransferAction(action)) {
    const native = action.kind === "transfer-eth";
    return {
      chainId: RESERVE.chainId,
      to: native ? action.recipient : RESERVE.usdc,
      data: native
        ? ("0x" as const)
        : encodeFunctionData({
            abi: tokenAbi,
            functionName: "transfer",
            args: [action.recipient, amount],
          }),
      value: native ? amount : 0n,
    };
  }
  const approval = action.kind === "approve" || action.kind === "revoke";
  return {
    chainId: RESERVE.chainId,
    to: (approval ? RESERVE.usdc : RESERVE.pool) as Address,
    data: approval
      ? encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [RESERVE.pool, amount],
        })
      : action.kind === "supply"
        ? encodeFunctionData({
            abi: poolAbi,
            functionName: "supply",
            args: [RESERVE.usdc, amount, action.owner, 0],
          })
        : encodeFunctionData({
            abi: poolAbi,
            functionName: "withdraw",
            args: [RESERVE.usdc, amount, action.owner],
          }),
    value: 0n,
  };
}

/** Savings uses the Privy EOA; Aqua's separate PositionAccount is never implied here. */
export function assertReserveAction(
  input: ReserveAction,
  state: ReserveSnapshot,
) {
  const action = ActionSchema.parse(input);
  SnapshotSchema.parse(state);
  if (action.owner.toLowerCase() !== state.owner.toLowerCase())
    throw new Error("The wallet changed. Refresh the reserve.");
  if (isTransferAction(action)) {
    const balance =
      action.kind === "transfer-eth" ? state.nativeWei : state.usdcUnits;
    if (BigInt(action.amountUnits) > BigInt(balance))
      throw new Error(
        `The amount exceeds your ${action.kind === "transfer-eth" ? "ETH" : "USDC"} wallet balance.`,
      );
    return;
  }
  if (action.kind === "revoke") return;
  if (BigInt(state.debtBase) !== 0n)
    throw new Error(
      "This savings flow requires an Aave account without debt. Manage existing loans in Aave.",
    );
  const amount = BigInt(action.amountUnits);
  if (action.kind === "withdraw") {
    if (!state.withdrawAvailable)
      throw new Error("Aave withdrawals are currently unavailable.");
    if (amount > BigInt(state.aUsdcUnits))
      throw new Error("The amount exceeds your supplied USDC balance.");
  } else {
    if (!state.supplyAvailable)
      throw new Error("Aave USDC supply is currently unavailable.");
    if (amount > BigInt(state.usdcUnits))
      throw new Error("Add enough native USDC on Arbitrum before depositing.");
    if (action.kind === "supply" && BigInt(state.allowanceUnits) !== amount)
      throw new Error(
        "Approve exactly this deposit amount first. Refresh after confirmation.",
      );
  }
}

/** Called by both preflight and the browser review before opening the wallet. */
export function assertReserveGas(
  input: ReserveAction,
  state: ReserveSnapshot,
  estimatedGasWei: string,
) {
  const action = ActionSchema.parse(input);
  SnapshotSchema.parse(state);
  if (
    !/^\d{1,78}$/.test(estimatedGasWei) ||
    BigInt(estimatedGasWei) <= 0n ||
    BigInt(estimatedGasWei) > MAX_TRANSFER_UNITS
  )
    throw new Error(
      "The network fee estimate is invalid. Refresh before continuing.",
    );
  const value =
    action.kind === "transfer-eth" ? BigInt(action.amountUnits) : 0n;
  if (BigInt(state.nativeWei) < value + BigInt(estimatedGasWei))
    throw new Error(
      action.kind === "transfer-eth"
        ? "Leave enough ETH on Arbitrum for the transfer and network fees. Reduce the amount."
        : "Add ETH on Arbitrum for network fees before continuing.",
    );
}

export const PreparedSchema = z.object({
  action: ActionSchema,
  before: SnapshotSchema,
  expiresAt: z.number().int(),
  estimatedGasWei: z.string().regex(/^\d+$/),
});
export type PreparedReserveAction = z.infer<typeof PreparedSchema>;
