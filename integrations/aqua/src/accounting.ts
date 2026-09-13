/** All amounts are integer USDC base units. No floating point enters allocation. */
export type CycleInput = {
  principal: bigint;
  recovered: bigint;
  debtCheckpoint: bigint;
  debtNow: bigint;
  provision: bigint;
  lossCarry: bigint;
  healthy: boolean;
  carriedInterest?: bigint;
};
export function allocate(input: CycleInput) {
  const {
    principal,
    recovered,
    debtCheckpoint,
    debtNow,
    provision,
    lossCarry,
    healthy,
    carriedInterest = 0n,
  } = input;
  if (Object.values(input).some((v) => typeof v === "bigint" && v < 0n))
    throw new Error("negative_input");
  if (debtNow < debtCheckpoint)
    throw new Error("external_debt_movement_requires_reconciliation");
  const interest = debtNow - debtCheckpoint + carriedInterest;
  if (recovered < interest + provision)
    throw new Error("insufficient_cash_use_defense");
  const afterProvision = recovered - principal - interest - provision;
  const eligible = afterProvision > lossCarry ? afterProvision - lossCarry : 0n;
  const nextLossCarry =
    afterProvision < lossCarry ? lossCarry - afterProvision : 0n;
  const requestedPrincipalAmortization = healthy ? eligible / 2n : eligible;
  const desiredRepayment = interest + requestedPrincipalAmortization;
  const repayment = desiredRepayment > debtNow ? debtNow : desiredRepayment;
  const principalAmortization =
    repayment > interest ? repayment - interest : 0n;
  const finalDebt = debtNow - repayment;
  const residual = recovered - repayment - provision;
  const freeCash = finalDebt === 0n ? residual : 0n;
  const nextPrincipal = finalDebt === 0n ? 0n : residual;
  const growthFromEligible =
    healthy && finalDebt > 0n ? eligible - principalAmortization : 0n;
  if (recovered !== repayment + provision + nextPrincipal + freeCash)
    throw new Error("conservation_failed");
  return {
    interest,
    afterProvision,
    eligible,
    nextLossCarry,
    principalAmortization,
    requestedPrincipalAmortization,
    repayment,
    finalDebt,
    nextPrincipal,
    freeCash,
    growthFromEligible,
    provision,
  };
}

/** Converts WETH base units to USDC base units at USDC-per-whole-WETH (6 decimals). */
export function valueWeth(wethUnits: bigint, priceE6: bigint) {
  if (wethUnits < 0n || priceE6 <= 0n)
    throw new Error("invalid_valuation_input");
  return (wethUnits * priceE6) / 10n ** 18n;
}

/** Native-token gas is already included in the payer's equity delta: do not deduct it twice. */
export function groupProfit(
  actors: readonly {
    initialEquity: bigint;
    finalEquity: bigint;
    externalCapital: bigint;
  }[],
) {
  return actors.reduce(
    (sum, a) => sum + a.finalEquity - a.initialEquity - a.externalCapital,
    0n,
  );
}
