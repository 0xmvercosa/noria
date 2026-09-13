import { z } from "zod";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
} from "viem";
import { buildOfficialOrder, DEPLOYMENTS } from "@noria/aqua/official";
import { parseRehearsalPlan } from "@noria/aqua/rehearsal-plan";
import factoryArtifact from "../../../public/aqua/position-factory-artifact.json";

export const LAUNCH = {
  ...DEPLOYMENTS,
  aUsdc: "0x724dc807b04555b71ed48a6896b6f41593b8c637",
  adapterFee: 500,
  quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
} as const;
export const launchFactoryAbi = parseAbi([
  "function protocols() view returns ((address weth,address usdc,address aWeth,address aUsdc,address debtUSDC,address aave,address aqua,address swapVM,address adapter))",
  "function getPosition(address owner,bytes32 id) view returns(address)",
  "function latestPosition(address owner) view returns(address)",
  "function isPosition(address account) view returns(bool)",
  "function createPosition(bytes32 id,address collateral,uint256 safetyHF,uint256 comfortableHF,bytes32 manifestHash) returns(address)",
  "event PositionCreated(address indexed owner,address indexed account,bytes32 indexed id,address collateral,bytes32 manifestHash,uint256 safetyHF,uint256 comfortableHF)",
]);
export const launchAccountAbi = parseAbi([
  "function owner() view returns(address)",
  "function keeper() view returns(address)",
  "function weth() view returns(address)",
  "function usdc() view returns(address)",
  "function collateral() view returns(address)",
  "function debtToken() view returns(address)",
  "function receiptToken() view returns(address)",
  "function aave() view returns(address)",
  "function aqua() view returns(address)",
  "function swapVM() view returns(address)",
  "function adapter() view returns(address)",
  "function safetyHF() view returns(uint256)",
  "function comfortableHF() view returns(uint256)",
  "function manifestHash() view returns(bytes32)",
  "function phase() view returns(uint8)",
  "function healthFactor() view returns(uint256)",
  "function principal() view returns(uint256)",
  "function lpWeth() view returns(uint256)",
  "function lpUsdc() view returns(uint256)",
  "function cycleId() view returns(uint256)",
  "function nonce() view returns(uint256)",
  "function strategyHash() view returns(bytes32)",
  "function openPosition(uint256 collateralAmount,uint256 borrowUSDC)",
  "function swapInventory(bool wethIn,uint256 amount,uint256 minOut,uint256 deadline) returns(uint256 received)",
  "function shipCycle(bytes encodedOrder)",
  "function defend()",
  "function realizeDefense(uint256 minOut,uint256 deadline)",
  "function repayExternal(uint256 amount)",
  "function exit()",
  "event Opened(address indexed collateral,uint256 supplied,uint256 borrowed,uint256 healthFactor)",
  "event InventoryConverted(address indexed tokenIn,uint256 amountIn,uint256 amountOut)",
  "event CycleShipped(uint256 indexed cycleId,bytes32 indexed strategyHash,uint256 wethAmount,uint256 usdcAmount)",
  "event CycleDocked(uint256 indexed cycleId,uint256 nonce,bytes32 snapshotHash,uint256 wethAmount,uint256 usdcAmount)",
  "event Defended(uint256 indexed cycleId,uint256 repaid,uint256 residualDebt,uint256 residualWeth)",
  "event Closed(uint256 collateralReturned,uint256 usdcReturned,uint256 wethReturned)",
]);
export const launchTokenAbi = parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function deposit() payable",
  "function withdraw(uint256)",
  "function UNDERLYING_ASSET_ADDRESS() view returns(address)",
  "function POOL() view returns(address)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Deposit(address indexed dst,uint256 wad)",
  "event Withdrawal(address indexed src,uint256 wad)",
]);
export const launchPoolAbi = parseAbi([
  "event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)",
  "event Borrow(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint8 interestRateMode,uint256 borrowRate,uint16 indexed referralCode)",
  "event Repay(address indexed reserve,address indexed user,address indexed repayer,uint256 amount,bool useATokens)",
  "event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)",
]);

export class LaunchError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "LaunchError";
  }
}
export const LaunchAddressSchema = z
  .string()
  .refine(
    (v) => isAddress(v, { strict: true }) && BigInt(v) !== 0n,
    "Use a valid nonzero checksummed address.",
  )
  .transform((v) => getAddress(v));
export const LaunchUintSchema = z
  .string()
  .max(78)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((v) => /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n);
const positive = LaunchUintSchema.refine(
  (v) => /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) > 0n,
);
export const LaunchHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v.toLowerCase() as `0x${string}`);
const nonzeroHash = LaunchHashSchema.refine(
  (v) => /^0x[0-9a-fA-F]{64}$/.test(v) && BigInt(v) !== 0n,
);
export const LaunchIntentSchema = z
  .object({
    fundingAsset: z.enum(["ETH", "USDC"]),
    collateralAmountUnits: positive,
    safetyHFWad: positive,
    comfortableHFWad: positive,
    financingMode: z.literal("aave_collateral_then_borrow_usdc"),
  })
  .strict()
  .refine(
    (v) =>
      /^(0|[1-9][0-9]{0,77})$/.test(v.safetyHFWad) &&
      /^(0|[1-9][0-9]{0,77})$/.test(v.comfortableHFWad) &&
      BigInt(v.safetyHFWad) > 10n ** 18n &&
      BigInt(v.comfortableHFWad) > BigInt(v.safetyHFWad) &&
      BigInt(v.comfortableHFWad) <= 10n ** 19n,
    "Require 1 < safety HF < comfortable HF <= 10.",
  );
export type LaunchIntent = z.infer<typeof LaunchIntentSchema>;
const base = { owner: LaunchAddressSchema, account: LaunchAddressSchema };
export const LaunchRequestSchema = z.union([
  z
    .object({
      owner: LaunchAddressSchema,
      kind: z.literal("create"),
      id: nonzeroHash,
      intent: LaunchIntentSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.enum([
        "wrap",
        "unwrap",
        "approve-collateral",
        "approve-repayment",
        "repay",
      ]),
      amountUnits: positive,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.enum([
        "revoke-collateral",
        "revoke-repayment",
        "open",
        "convert",
        "ship",
        "defend",
        "realize-defense",
        "exit",
      ]),
    })
    .strict(),
]);
export type LaunchRequest = z.infer<typeof LaunchRequestSchema>;
export const LaunchPlanSummarySchema = z
  .object({
    intent: LaunchIntentSchema,
    loanUSDCUnits: positive,
    targetWethUnits: positive,
    targetUsdcUnits: positive,
    convertUsdcUnits: positive,
    lowerPriceE6: positive,
    upperPriceE6: positive,
    lpFeeBps: z.number().int().min(1).max(100),
    sourcePool: LaunchAddressSchema,
    sourceFeeTierPips: z.number().int(),
    graphResponseHash: LaunchHashSchema,
    graphIndexedBlock: positive,
    graphIndexedBlockHash: LaunchHashSchema,
    validUntil: z.string().datetime(),
    digest: LaunchHashSchema,
  })
  .strict();
export type LaunchPlanSummary = z.infer<typeof LaunchPlanSummarySchema>;
export function summarizeLaunchPlan(
  raw: unknown,
  now = Date.now(),
): LaunchPlanSummary {
  const p = parseRehearsalPlan(raw, now);
  const e = p.execution;
  return LaunchPlanSummarySchema.parse({
    intent: p.intent,
    loanUSDCUnits: p.financing.loanUSDCUnits,
    targetWethUnits: e.targetWethUnits,
    targetUsdcUnits: e.targetUsdcUnits,
    convertUsdcUnits: e.convertUsdcUnits,
    lowerPriceE6: e.lowerPriceE6,
    upperPriceE6: e.upperPriceE6,
    lpFeeBps: e.lpFeeBps,
    sourcePool: e.sourcePool,
    sourceFeeTierPips: e.sourceFeeTierPips,
    graphResponseHash: e.graphResponseHash,
    graphIndexedBlock: e.graphIndexedBlock,
    graphIndexedBlockHash: e.graphIndexedBlockHash,
    validUntil: p.validUntil,
    digest: keccak256(stringToHex(JSON.stringify(p))),
  });
}

export const LaunchPositionSchema = z
  .object({
    address: LaunchAddressSchema,
    owner: LaunchAddressSchema,
    keeper: LaunchAddressSchema,
    collateral: LaunchAddressSchema,
    receiptToken: LaunchAddressSchema,
    phase: z.number().int().min(0).max(6),
    healthFactor: LaunchUintSchema.nullable(),
    safetyHF: positive,
    comfortableHF: positive,
    manifestHash: nonzeroHash,
    principal: LaunchUintSchema,
    debtUSDCUnits: LaunchUintSchema,
    receiptUnits: LaunchUintSchema,
    wethUnits: LaunchUintSchema,
    usdcUnits: LaunchUintSchema,
    lpWethUnits: LaunchUintSchema,
    lpUsdcUnits: LaunchUintSchema,
    cycleId: LaunchUintSchema,
    nonce: LaunchUintSchema,
    strategyHash: LaunchHashSchema,
    collateralAllowanceUnits: LaunchUintSchema,
    repaymentAllowanceUnits: LaunchUintSchema,
    virtualWethUnits: LaunchUintSchema.nullable(),
    virtualUsdcUnits: LaunchUintSchema.nullable(),
  })
  .strict();
export type LaunchPosition = z.infer<typeof LaunchPositionSchema>;
export const LaunchReadySnapshotSchema = z
  .object({
    schemaVersion: z.literal("noria.aqua.launch.snapshot.v1"),
    status: z.literal("ready"),
    chainId: z.literal(42161),
    owner: LaunchAddressSchema,
    blockNumber: positive,
    blockHash: LaunchHashSchema,
    blockTimestamp: z.number().int().positive(),
    deployment: z
      .object({
        factory: LaunchAddressSchema,
        factoryRuntimeHash: z.literal(factoryArtifact.runtimeCodeHash),
        adapter: LaunchAddressSchema,
        adapterRuntimeHash: LaunchHashSchema,
      })
      .strict(),
    wallet: z
      .object({
        nativeWei: LaunchUintSchema,
        wethUnits: LaunchUintSchema,
        usdcUnits: LaunchUintSchema,
        aUsdcUnits: LaunchUintSchema,
      })
      .strict(),
    position: LaunchPositionSchema.nullable(),
  })
  .strict();
export const LaunchSnapshotSchema = z.union([
  LaunchReadySnapshotSchema,
  z
    .object({
      schemaVersion: z.literal("noria.aqua.launch.snapshot.v1"),
      status: z.literal("deployment-required"),
      chainId: z.literal(42161),
      owner: LaunchAddressSchema,
      message: z.string(),
    })
    .strict(),
]);
export type LaunchSnapshot = z.infer<typeof LaunchSnapshotSchema>;
export type LaunchReadySnapshot = z.infer<typeof LaunchReadySnapshotSchema>;
const QuoteSchema = z
  .object({
    amountUnits: positive,
    quotedOutUnits: positive,
    minOutUnits: positive,
    deadline: positive,
  })
  .strict();
export const LaunchPreparedSchema = z
  .object({
    schemaVersion: z.literal("noria.aqua.launch.prepared.v1"),
    request: LaunchRequestSchema,
    before: LaunchReadySnapshotSchema,
    plan: LaunchPlanSummarySchema.nullable(),
    quote: QuoteSchema.nullable(),
    expiresAt: z.number().int().positive(),
    estimatedGasWei: positive,
  })
  .strict();
export type PreparedLaunchAction = z.infer<typeof LaunchPreparedSchema>;
export type LaunchPrepared = PreparedLaunchAction;
export const launchPhases = [
  "Unfunded",
  "Ready",
  "Active",
  "Closing",
  "Allocated",
  "Defended",
  "Closed",
] as const;
export function launchManifestHash(
  owner: string,
  raw: LaunchIntent,
): `0x${string}` {
  const intent = LaunchIntentSchema.parse(raw);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        keccak256(stringToHex("noria.aqua.owner-intent.v1")),
        42161n,
        LaunchAddressSchema.parse(owner),
        intent.fundingAsset === "ETH" ? LAUNCH.weth : LAUNCH.usdc,
        BigInt(intent.collateralAmountUnits),
        BigInt(intent.safetyHFWad),
        BigInt(intent.comfortableHFWad),
      ],
    ),
  );
}
export function launchOrder(prepared: PreparedLaunchAction) {
  const { request, before, plan } = prepared;
  if (request.kind !== "ship" || !plan || !before.position)
    throw new LaunchError(
      "invalid-request",
      "An owned position and reviewed range are required.",
    );
  const salt =
    BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }],
          [
            before.position.manifestHash,
            BigInt(before.position.cycleId) + 1n,
            plan.digest,
          ],
        ),
      ),
    ) &
    ((1n << 64n) - 1n);
  return buildOfficialOrder({
    maker: request.account,
    lowerPriceE6: BigInt(plan.lowerPriceE6),
    upperPriceE6: BigInt(plan.upperPriceE6),
    lpFeeBps: plan.lpFeeBps,
    salt,
  });
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function withinLaunchTarget(actual: bigint, target: bigint): boolean {
  return actual * 100n >= target * 99n && actual * 100n <= target * 101n;
}
/** Explicit 0.1% interest headroom plus one base unit; any unused USDC stays in the position until exit. */
export function launchRepaymentLimit(debtUSDCUnits: string): string {
  const debt = BigInt(LaunchUintSchema.parse(debtUSDCUnits));
  return ((debt * 1001n + 999n) / 1000n + 1n).toString();
}
export function assertLaunchState(
  request: LaunchRequest,
  before: LaunchReadySnapshot,
  plan: LaunchPlanSummary | null,
) {
  if (!same(request.owner, before.owner))
    throw new LaunchError(
      "invalid-owner",
      "The wallet changed. Refresh the position.",
    );
  if (request.kind === "create") return;
  const p = before.position;
  if (
    !p ||
    !same(p.address, request.account) ||
    !same(p.owner, request.owner) ||
    !same(p.keeper, request.owner)
  )
    throw new LaunchError(
      "invalid-owner",
      "This account is not a registered position owned by this wallet.",
    );
  const need = (condition: boolean, message: string) => {
    if (!condition) throw new LaunchError("invalid-state", message);
  };
  if (["open", "convert", "ship"].includes(request.kind)) {
    need(
      p.healthFactor !== null,
      "Health factor is unavailable. Refresh before opening, converting or launching. Owner stop and repayment actions remain available for review.",
    );
    need(!!plan, "Request a fresh position plan before continuing.");
    if (!plan) return;
    need(
      p.manifestHash === launchManifestHash(request.owner, plan.intent),
      "This plan changes the position's original collateral intent or health policy. Use the original intent or create a new position.",
    );
    need(
      p.safetyHF === plan.intent.safetyHFWad &&
        p.comfortableHF === plan.intent.comfortableHFWad,
      "The plan health policy does not match this position.",
    );
    need(
      same(
        p.collateral,
        plan.intent.fundingAsset === "ETH" ? LAUNCH.weth : LAUNCH.usdc,
      ),
      "The plan collateral does not match this position.",
    );
    if (request.kind !== "open")
      need(
        p.principal === plan.loanUSDCUnits,
        `Request fresh research for this position's existing ${p.principal} USDC base-unit inventory budget; the current plan has a different loan.`,
      );
  }
  const walletCollateral = same(p.collateral, LAUNCH.weth)
    ? before.wallet.wethUnits
    : before.wallet.usdcUnits;
  switch (request.kind) {
    case "wrap":
      need(
        p.phase === 0 && same(p.collateral, LAUNCH.weth),
        "Wrap ETH only for an unfunded WETH-collateral position.",
      );
      break;
    case "unwrap":
      need(
        p.phase === 6 &&
          BigInt(request.amountUnits) <= BigInt(before.wallet.wethUnits),
        "Unwrap only available wallet WETH after closing the position.",
      );
      break;
    case "approve-collateral":
      need(
        p.phase === 0 &&
          BigInt(request.amountUnits) <= BigInt(walletCollateral),
        "Approve only available collateral for an unfunded position.",
      );
      break;
    case "approve-repayment":
    case "repay":
      need(
        p.phase === 5 && BigInt(p.debtUSDCUnits) > 0n,
        "External repayment requires a defended position with remaining debt.",
      );
      need(
        BigInt(request.amountUnits) <= BigInt(before.wallet.usdcUnits) &&
          BigInt(request.amountUnits) <=
            BigInt(launchRepaymentLimit(p.debtUSDCUnits)),
        "Repayment must fit the wallet's USDC balance and current debt plus at most 0.1% interest headroom and one base unit. Unused USDC stays in the position until exit.",
      );
      if (request.kind === "repay")
        need(
          p.repaymentAllowanceUnits === request.amountUnits,
          "Approve exactly this external repayment amount first.",
        );
      break;
    case "open":
      need(
        p.phase === 0 && BigInt(p.debtUSDCUnits) === 0n,
        "Only an unfunded position without debt can be opened.",
      );
      need(
        BigInt(walletCollateral) >= BigInt(plan!.intent.collateralAmountUnits),
        "Add enough collateral to this wallet before opening.",
      );
      need(
        p.collateralAllowanceUnits === plan!.intent.collateralAmountUnits,
        "Approve exactly the planned collateral amount first.",
      );
      break;
    case "convert":
      need(
        [1, 4].includes(p.phase) &&
          BigInt(p.lpWethUnits) === 0n &&
          BigInt(p.lpUsdcUnits) >= BigInt(plan!.loanUSDCUnits),
        "Inventory conversion requires a funded, stopped position with its USDC loan still available.",
      );
      need(
        BigInt(p.debtUSDCUnits) > 0n &&
          p.healthFactor !== null &&
          BigInt(p.healthFactor) > BigInt(p.safetyHF),
        "The position must be above its safety health factor with outstanding debt.",
      );
      break;
    case "ship":
      need(
        [1, 4].includes(p.phase) &&
          BigInt(p.debtUSDCUnits) > 0n &&
          p.healthFactor !== null &&
          BigInt(p.healthFactor) >= BigInt(p.comfortableHF),
        "Launching requires a ready position at or above its comfortable health factor.",
      );
      need(
        withinLaunchTarget(
          BigInt(p.lpWethUnits),
          BigInt(plan!.targetWethUnits),
        ) &&
          withinLaunchTarget(
            BigInt(p.lpUsdcUnits),
            BigInt(plan!.targetUsdcUnits),
          ),
        "Actual inventory differs from the Graph targets by more than 1%. Refresh the plan before launch.",
      );
      break;
    case "defend":
      need(
        p.phase !== 0 && p.phase !== 6,
        "Only an opened, unclosed position can stop and repay.",
      );
      break;
    case "realize-defense":
      need(
        p.phase === 5 && BigInt(p.wethUnits) > 0n,
        "There is no defended WETH inventory to sell.",
      );
      break;
    case "exit":
      need(
        [4, 5].includes(p.phase) && BigInt(p.debtUSDCUnits) === 0n,
        "Repay all remaining debt and stop the position before returning collateral.",
      );
      break;
  }
}
/** Locally reconstructed calls only; neither requests nor prepared data contain executable calldata. */
export function launchTransaction(input: PreparedLaunchAction) {
  const p = LaunchPreparedSchema.parse(input),
    r = p.request;
  assertLaunchState(r, p.before, p.plan);
  let to: Address = p.before.deployment.factory,
    data: `0x${string}`,
    value = 0n;
  if (r.kind === "create")
    data = encodeFunctionData({
      abi: launchFactoryAbi,
      functionName: "createPosition",
      args: [
        r.id,
        r.intent.fundingAsset === "ETH" ? LAUNCH.weth : LAUNCH.usdc,
        BigInt(r.intent.safetyHFWad),
        BigInt(r.intent.comfortableHFWad),
        launchManifestHash(r.owner, r.intent),
      ],
    });
  else {
    to = r.account;
    const account = p.before.position!;
    switch (r.kind) {
      case "wrap":
        to = LAUNCH.weth;
        value = BigInt(r.amountUnits);
        data = encodeFunctionData({
          abi: launchTokenAbi,
          functionName: "deposit",
        });
        break;
      case "unwrap":
        to = LAUNCH.weth;
        data = encodeFunctionData({
          abi: launchTokenAbi,
          functionName: "withdraw",
          args: [BigInt(r.amountUnits)],
        });
        break;
      case "approve-collateral":
      case "revoke-collateral":
      case "approve-repayment":
      case "revoke-repayment":
        to = r.kind.includes("collateral") ? account.collateral : LAUNCH.usdc;
        data = encodeFunctionData({
          abi: launchTokenAbi,
          functionName: "approve",
          args: [r.account, "amountUnits" in r ? BigInt(r.amountUnits) : 0n],
        });
        break;
      case "open":
        data = encodeFunctionData({
          abi: launchAccountAbi,
          functionName: "openPosition",
          args: [
            BigInt(p.plan!.intent.collateralAmountUnits),
            BigInt(p.plan!.loanUSDCUnits),
          ],
        });
        break;
      case "convert":
      case "realize-defense": {
        const q = p.quote;
        if (
          !q ||
          BigInt(q.minOutUnits) * 10000n < BigInt(q.quotedOutUnits) * 9950n ||
          BigInt(q.minOutUnits) > BigInt(q.quotedOutUnits) ||
          BigInt(q.deadline) > BigInt(p.before.blockTimestamp + 300) ||
          BigInt(q.deadline) <= BigInt(p.before.blockTimestamp)
        )
          throw new LaunchError(
            "invalid-quote",
            "The swap quote or 0.5% slippage bound is invalid.",
          );
        if (r.kind === "convert") {
          if (
            q.amountUnits !== p.plan!.convertUsdcUnits ||
            !withinLaunchTarget(
              BigInt(q.quotedOutUnits),
              BigInt(p.plan!.targetWethUnits),
            ) ||
            BigInt(q.minOutUnits) * 100n < BigInt(p.plan!.targetWethUnits) * 99n
          )
            throw new LaunchError(
              "invalid-quote",
              "The quoted inventory does not match the Graph target.",
            );
          data = encodeFunctionData({
            abi: launchAccountAbi,
            functionName: "swapInventory",
            args: [
              false,
              BigInt(q.amountUnits),
              BigInt(q.minOutUnits),
              BigInt(q.deadline),
            ],
          });
        } else {
          if (q.amountUnits !== account.wethUnits)
            throw new LaunchError(
              "invalid-quote",
              "The defense quote does not match current WETH inventory.",
            );
          data = encodeFunctionData({
            abi: launchAccountAbi,
            functionName: "realizeDefense",
            args: [BigInt(q.minOutUnits), BigInt(q.deadline)],
          });
        }
        break;
      }
      case "ship":
        data = encodeFunctionData({
          abi: launchAccountAbi,
          functionName: "shipCycle",
          args: [launchOrder(p).bytes],
        });
        break;
      case "defend":
        data = encodeFunctionData({
          abi: launchAccountAbi,
          functionName: "defend",
        });
        break;
      case "repay":
        data = encodeFunctionData({
          abi: launchAccountAbi,
          functionName: "repayExternal",
          args: [BigInt(r.amountUnits)],
        });
        break;
      case "exit":
        data = encodeFunctionData({
          abi: launchAccountAbi,
          functionName: "exit",
        });
        break;
    }
  }
  return { chainId: 42161 as const, to, data, value };
}
export function assertPreparedLaunch(
  input: PreparedLaunchAction,
  request: LaunchRequest,
  rawPlan?: unknown,
  now = Date.now(),
) {
  const p = LaunchPreparedSchema.parse(input),
    expected = LaunchRequestSchema.parse(request);
  if (JSON.stringify(p.request) !== JSON.stringify(expected))
    throw new LaunchError(
      "review-mismatch",
      "The review does not match the requested operation.",
    );
  const needsPlan = ["open", "convert", "ship"].includes(request.kind);
  if (
    needsPlan &&
    (!p.plan ||
      JSON.stringify(p.plan) !==
        JSON.stringify(summarizeLaunchPlan(rawPlan, now)))
  )
    throw new LaunchError(
      "review-mismatch",
      "The review does not match the selected position plan.",
    );
  if (!needsPlan && p.plan !== null)
    throw new LaunchError(
      "review-mismatch",
      "Unexpected plan in this operation.",
    );
  if (
    !["convert", "realize-defense"].includes(request.kind) &&
    p.quote !== null
  )
    throw new LaunchError(
      "review-mismatch",
      "Unexpected swap quote in this operation.",
    );
  if (
    now >= p.expiresAt ||
    p.expiresAt > now + 61_000 ||
    Math.abs(now / 1000 - p.before.blockTimestamp) > 90 ||
    (p.plan && now >= Date.parse(p.plan.validUntil)) ||
    (p.quote && now >= Number(p.quote.deadline) * 1000)
  )
    throw new LaunchError(
      "stale-review",
      "This position review expired. Refresh before signing.",
    );
  const tx = launchTransaction(p);
  if (BigInt(p.before.wallet.nativeWei) < tx.value + BigInt(p.estimatedGasWei))
    throw new LaunchError(
      "insufficient-balance",
      "Leave enough ETH in the wallet for this operation and network fees.",
    );
  return p;
}
