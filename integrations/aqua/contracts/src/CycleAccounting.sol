// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Closed-cycle USDC accounting. Reserve provisions are not realized expenses.
/// @dev Caller authenticates inventory provenance and verifies unchanged scaled debt.
library CycleAccounting {
    struct Input {
        uint256 principal;
        uint256 recovered;
        uint256 debtCheckpoint;
        uint256 debtNow;
        uint256 provision;
        uint256 lossCarry;
        bool healthy;
        uint256 carriedInterest;
    }

    struct Result {
        uint256 interest;
        int256 resultAfterProvision;
        uint256 eligible;
        uint256 nextLossCarry;
        uint256 repayment;
        uint256 nextPrincipal;
        uint256 freeCash;
        uint256 finalDebt;
    }

    error InvalidAccountingInput();
    error ExternalDebtMovement();
    error InsufficientCash();

    function calculate(Input memory i) internal pure returns (Result memory r) {
        uint256 max = type(uint128).max;
        if (
            i.principal > max || i.recovered > max || i.debtCheckpoint > max || i.debtNow > max || i.provision > max
                || i.lossCarry > max || i.carriedInterest > max
        ) revert InvalidAccountingInput();
        if (i.debtNow < i.debtCheckpoint) revert ExternalDebtMovement();
        r.interest = i.debtNow - i.debtCheckpoint + i.carriedInterest;
        if (i.recovered < r.interest + i.provision) revert InsufficientCash();
        r.resultAfterProvision = int256(i.recovered) - int256(i.principal + r.interest + i.provision);
        if (r.resultAfterProvision >= 0) {
            uint256 positive = uint256(r.resultAfterProvision);
            if (positive > i.lossCarry) r.eligible = positive - i.lossCarry;
            else r.nextLossCarry = i.lossCarry - positive;
        } else {
            r.nextLossCarry = i.lossCarry + uint256(-r.resultAfterProvision);
        }
        r.repayment = r.interest + (i.healthy ? r.eligible / 2 : r.eligible);
        if (r.repayment > i.debtNow) r.repayment = i.debtNow;
        r.finalDebt = i.debtNow - r.repayment;
        uint256 remainder = i.recovered - r.repayment - i.provision;
        if (r.finalDebt == 0) r.freeCash = remainder;
        else r.nextPrincipal = remainder;
    }
}
