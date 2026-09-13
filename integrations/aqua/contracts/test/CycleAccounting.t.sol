// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TestBase} from "./TestBase.sol";
import {CycleAccounting} from "../src/CycleAccounting.sol";

contract AccountingHarness {
    function calculate(CycleAccounting.Input calldata input) external pure returns (CycleAccounting.Result memory) {
        return CycleAccounting.calculate(input);
    }
}

contract CycleAccountingTest is TestBase {
    AccountingHarness internal harness;
    function setUp() public { harness = new AccountingHarness(); }

    function baseline(uint256 recovered, uint256 loss) internal pure returns (CycleAccounting.Input memory i) {
        i.principal = 8_000e6; i.recovered = recovered; i.debtCheckpoint = 8_000e6;
        i.debtNow = 8_080e6; i.provision = 20e6; i.lossCarry = loss; i.healthy = true;
    }

    function test_positiveCycleConservesCashAndReducesDebtPrincipal() public view {
        CycleAccounting.Result memory r = harness.calculate(baseline(8_200e6, 0));
        assertEq(r.interest, 80e6); assertEq(r.eligible, 100e6); assertEq(r.repayment, 130e6);
        assertEq(r.finalDebt, 7_950e6); assertEq(r.nextPrincipal, 8_050e6);
        assertEq(r.nextLossCarry, 0); assertEq(r.freeCash, 0);
    }

    function test_negativeCycleConsumesPrincipalAndCarriesLoss() public view {
        CycleAccounting.Result memory r = harness.calculate(baseline(7_800e6, 0));
        assertEq(r.resultAfterProvision, -300e6); assertEq(r.eligible, 0);
        assertEq(r.nextLossCarry, 300e6); assertEq(r.repayment, 80e6);
        assertEq(r.nextPrincipal, 7_700e6); assertEq(r.finalDebt, 8_000e6);
    }

    function test_lossesAreRecoveredBeforeAnySplit() public view {
        CycleAccounting.Result memory partiallyRecovered = harness.calculate(baseline(8_200e6, 150e6));
        assertEq(partiallyRecovered.eligible, 0); assertEq(partiallyRecovered.nextLossCarry, 50e6);
        assertEq(partiallyRecovered.repayment, 80e6); assertEq(partiallyRecovered.nextPrincipal, 8_100e6);
        CycleAccounting.Result memory recovered = harness.calculate(baseline(8_200e6, 50e6));
        assertEq(recovered.eligible, 50e6); assertEq(recovered.nextLossCarry, 0);
        assertEq(recovered.repayment, 105e6); assertEq(recovered.nextPrincipal, 8_075e6);
    }

    function test_attentionUsesAllEligibleResultForDebt() public view {
        CycleAccounting.Input memory i = baseline(8_200e6, 0); i.healthy = false;
        CycleAccounting.Result memory r = harness.calculate(i);
        assertEq(r.repayment, 180e6); assertEq(r.nextPrincipal, 8_000e6); assertEq(r.finalDebt, 7_900e6);
    }

    function test_terminalDebtNeverBecomesAutomaticLp() public view {
        CycleAccounting.Input memory i;
        i.principal = 100e6; i.recovered = 200e6; i.debtCheckpoint = 10e6; i.debtNow = 10e6; i.healthy = true;
        CycleAccounting.Result memory r = harness.calculate(i);
        assertEq(r.repayment, 10e6); assertEq(r.finalDebt, 0); assertEq(r.nextPrincipal, 0); assertEq(r.freeCash, 190e6);
    }

    function test_oneUnitRemainderDoesNotInventDebtReduction() public view {
        CycleAccounting.Input memory i;
        i.principal = 1_000; i.recovered = 1_001; i.debtCheckpoint = 1_000; i.debtNow = 1_000; i.healthy = true;
        CycleAccounting.Result memory r = harness.calculate(i);
        assertEq(r.eligible, 1); assertEq(r.repayment, 0); assertEq(r.nextPrincipal, 1_001);
    }

    function test_carriedInterestRemainsAnExpenseAfterExternalDebtReduction() public view {
        CycleAccounting.Input memory i = baseline(8_200e6, 0);
        i.debtCheckpoint = 7_900e6; i.debtNow = 7_930e6; i.carriedInterest = 50e6;
        CycleAccounting.Result memory r = harness.calculate(i);
        assertEq(r.interest, 80e6); assertEq(r.eligible, 100e6); assertEq(r.repayment, 130e6);
        assertEq(r.finalDebt, 7_800e6); assertEq(r.nextPrincipal, 8_050e6);
    }

    function test_unreconciledDebtReductionRejected() public {
        CycleAccounting.Input memory i = baseline(8_200e6, 0); i.debtNow = i.debtCheckpoint - 1;
        vm.expectRevert(CycleAccounting.ExternalDebtMovement.selector); harness.calculate(i);
    }

    function test_insufficientCashDoesNotSilentlySkipInterest() public {
        CycleAccounting.Input memory i = baseline(99e6, 0);
        vm.expectRevert(CycleAccounting.InsufficientCash.selector); harness.calculate(i);
    }

    function test_outOfDomainAmountRejectedBeforeSignedMath() public {
        CycleAccounting.Input memory i = baseline(8_200e6, 0); i.principal = uint256(type(uint128).max) + 1;
        vm.expectRevert(CycleAccounting.InvalidAccountingInput.selector); harness.calculate(i);
    }

    function testFuzz_conservationDebtCapAndLossExclusivity(
        uint64 capital, uint64 available, uint64 debt, uint32 interest, uint32 cost,
        uint32 carried, uint64 oldLoss, bool healthy
    ) public view {
        CycleAccounting.Input memory i;
        i.principal = capital; i.debtCheckpoint = debt; i.debtNow = uint256(debt) + interest;
        i.recovered = uint256(available) + interest + cost + carried; i.provision = cost; i.carriedInterest = carried;
        i.lossCarry = oldLoss; i.healthy = healthy;
        CycleAccounting.Result memory r = harness.calculate(i);
        assertEq(i.recovered, r.repayment + i.provision + r.nextPrincipal + r.freeCash);
        assertEq(i.debtNow, r.repayment + r.finalDebt);
        assertTrue(r.eligible == 0 || r.nextLossCarry == 0);
        assertTrue(r.finalDebt == 0 ? r.nextPrincipal == 0 : r.freeCash == 0);
        if (uint256(available) <= uint256(capital) + oldLoss) assertEq(r.eligible, 0);
        if (r.eligible == 0) assertTrue(r.repayment <= r.interest);
    }
}
