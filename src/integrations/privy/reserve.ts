import { z } from "zod";
import { encodeFunctionData, getAddress, parseAbi, type Address } from "viem";

/** The public wallet flow has one chain, one asset and one protocol destination. */
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
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => getAddress(v))
  .refine((v) => BigInt(v) !== 0n, "A nonzero wallet is required.");
export const ActionSchema = z
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
      ),
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
export type ReserveAction = z.infer<typeof ActionSchema>;
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

/** Reconstructed in the browser too: the server never supplies arbitrary executable calldata. */
export function reserveTransaction(input: ReserveAction) {
  const action = ActionSchema.parse(input);
  const amount = BigInt(action.amountUnits);
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

export const PreparedSchema = z.object({
  action: ActionSchema,
  before: SnapshotSchema,
  expiresAt: z.number().int(),
  estimatedGasWei: z.string().regex(/^\d+$/),
});
export type PreparedReserveAction = z.infer<typeof PreparedSchema>;
