import {
  LAUNCH,
  launchRepaymentLimit,
  type LaunchIntent,
  type LaunchPosition,
  type LaunchReadySnapshot,
} from "../integrations/aqua/launch-contract";

type Position = Pick<
  LaunchPosition,
  | "phase"
  | "collateral"
  | "collateralAllowanceUnits"
  | "principal"
  | "debtUSDCUnits"
  | "wethUnits"
  | "usdcUnits"
  | "lpWethUnits"
  | "lpUsdcUnits"
  | "healthFactor"
  | "safetyHF"
  | "comfortableHF"
>;
export type JourneyNext =
  | "wrap"
  | "approve-collateral"
  | "open"
  | "convert"
  | "ship"
  | "defend"
  | "realize-defense"
  | "repayment"
  | "exit"
  | "unwrap"
  | null;
type Step = { label: string; status: "complete" | "current" | "pending" };
export type LaunchJourney = {
  title: string;
  description: string;
  next: JourneyNext;
  amountUnits?: string;
  canRefreshResearch: boolean;
  canStop: boolean;
  closing: boolean;
  steps: Step[];
};

/** Presentation only. Every requested transaction still goes through the launch preflight. */
export function describeLaunchJourney(
  position: Position,
  wallet: Pick<LaunchReadySnapshot["wallet"], "wethUnits">,
  intent?: LaunchIntent,
): LaunchJourney {
  const debt = BigInt(position.debtUSDCUnits);
  const healthUnavailable = position.healthFactor === null;
  const safetyReached =
    debt > 0n &&
    position.healthFactor !== null &&
    BigInt(position.healthFactor) <= BigInt(position.safetyHF);
  const inventoryShortfall =
    [1, 4].includes(position.phase) &&
    BigInt(position.lpWethUnits) === 0n &&
    BigInt(position.lpUsdcUnits) < BigInt(position.principal);
  const closing =
    (healthUnavailable && [1, 2, 4].includes(position.phase)) ||
    [3, 5, 6].includes(position.phase) ||
    ([1, 4].includes(position.phase) &&
      (debt === 0n ||
        safetyReached ||
        BigInt(position.principal) === 0n ||
        inventoryShortfall));
  let next: JourneyNext;
  let amountUnits: string | undefined;
  let title: string;
  let description: string;

  if (position.phase === 6) {
    next = BigInt(wallet.wethUnits) > 0n ? "unwrap" : null;
    title = "Position closed";
    description =
      "The position has no debt or Aave collateral. Collateral and remaining inventory were returned to your wallet. Unwrapping wallet WETH to ETH is optional.";
  } else if ([4, 5].includes(position.phase) && debt === 0n) {
    next = "exit";
    title = "Debt cleared — return your collateral";
    description =
      "Trading is stopped and the debt is zero. Return collateral and any remaining inventory to your wallet; remaining WETH does not need to be sold.";
  } else if (position.phase === 5) {
    next =
      BigInt(position.usdcUnits) > 0n
        ? "defend"
        : BigInt(position.wethUnits) > 0n
          ? "realize-defense"
          : "repayment";
    title = "Trading stopped — repayment remains";
    description =
      "Your collateral remains in Aave while debt remains. Apply available position USDC first, then sell remaining WETH or use wallet USDC to repay. Borrowing interest continues until the debt is cleared.";
  } else if (position.phase === 3 || (debt === 0n && position.phase !== 0)) {
    next = "defend";
    title = "Finish stopping this position";
    description =
      "Apply available position USDC to repayment and finish stopping before returning collateral.";
  } else if (healthUnavailable) {
    next = position.phase === 0 ? null : "defend";
    title = "Health factor unavailable — refresh or review recovery";
    description =
      "Aave health could not be read. Opening, converting and launching are blocked. For an opened position, you can still review stopping and repayment; each transaction must pass simulation.";
  } else if (position.phase === 0) {
    title = "Account created — collateral is still in your wallet";
    description =
      "Prepare and approve collateral first. Only the later supply-and-borrow transaction moves collateral into Aave and creates debt.";
    if (!intent) next = null;
    else if (
      position.collateral.toLowerCase() === LAUNCH.weth.toLowerCase() &&
      BigInt(wallet.wethUnits) < BigInt(intent.collateralAmountUnits)
    ) {
      next = "wrap";
      amountUnits = String(
        BigInt(intent.collateralAmountUnits) - BigInt(wallet.wethUnits),
      );
    } else if (
      position.collateralAllowanceUnits !== intent.collateralAmountUnits
    ) {
      next = "approve-collateral";
      amountUnits = intent.collateralAmountUnits;
    } else next = "open";
  } else if (safetyReached) {
    next = "defend";
    title = "Safety threshold reached — review stopping";
    description =
      "The current health factor is at or below your safety threshold. Further launch steps are unavailable; review stopping and repayment.";
  } else if (position.phase === 2) {
    next = "defend";
    title = "Strategy live — monitor your debt";
    description =
      "The strategy is available for eligible trades in Aqua. Borrowing interest continues even without fills. You decide when to stop and close.";
  } else if (BigInt(position.principal) === 0n) {
    next = "defend";
    title = "Finish repayment before closing";
    description =
      "There is no remaining launch principal, but debt remains. Stop and use available position USDC before repaying the remainder.";
  } else if (inventoryShortfall) {
    next = "defend";
    title = "Inventory shortfall — review closing";
    description =
      "The available USDC inventory no longer covers the launch principal. Stop and use available position USDC before repaying the remainder.";
  } else if (BigInt(position.lpWethUnits) === 0n) {
    next = "convert";
    title = "USDC borrowed — prepare the trading inventory";
    description =
      "Collateral is in Aave and the borrowed USDC is in your position. Interest is already accruing; the strategy is not live yet.";
  } else {
    next = "ship";
    title = "Inventory prepared — ready for a launch review";
    description =
      "WETH and USDC are in your position. Review the current range and health factor before making this inventory available in Aqua.";
  }

  const setupIndex =
    position.phase === 0
      ? next === "open"
        ? 2
        : 1
      : next === "convert"
        ? 3
        : 4;
  const stopped =
    position.phase === 5 ||
    position.phase === 6 ||
    (position.phase === 4 && debt === 0n);
  const steps: Step[] = closing
    ? [
        {
          label: "Stop and use available position USDC",
          status: stopped ? "complete" : "current",
        },
        {
          label: "Clear the remaining debt",
          status: debt === 0n ? "complete" : stopped ? "current" : "pending",
        },
        {
          label: "Return collateral and remaining inventory",
          status:
            position.phase === 6
              ? "complete"
              : stopped && debt === 0n
                ? "current"
                : "pending",
        },
      ]
    : [
        "Create position account",
        "Prepare and approve collateral",
        "Supply collateral and borrow USDC",
        "Prepare WETH / USDC inventory",
        "Launch strategy in Aqua",
      ].map((label, index) => ({
        label,
        status:
          position.phase === 2 || index < setupIndex
            ? "complete"
            : index === setupIndex
              ? "current"
              : "pending",
      }));
  return {
    title,
    description,
    next,
    amountUnits,
    closing,
    steps,
    canRefreshResearch:
      !healthUnavailable &&
      [0, 1, 4].includes(position.phase) &&
      (position.phase === 0 || (debt > 0n && BigInt(position.principal) > 0n)),
    canStop: [1, 2, 3, 4].includes(position.phase),
  };
}

export function describeRepayment(debtUnits: string, walletUnits: string) {
  const debt = BigInt(debtUnits),
    balance = BigInt(walletUnits);
  const limit = debt > 0n ? BigInt(launchRepaymentLimit(debtUnits)) : 0n;
  return {
    limitUnits: String(limit),
    availableUnits: String(balance < limit ? balance : limit),
    shortfallUnits: String(balance < limit ? limit - balance : 0n),
    fullyFunded: balance >= limit,
  };
}

/** An editable suggestion after an exact verified exit, never a claim about profit. */
export function newWalletWeth(beforeUnits: string, afterUnits: string): string {
  const before = BigInt(beforeUnits),
    after = BigInt(afterUnits);
  return after > before ? String(after - before) : "0";
}
