import test from "node:test";
import assert from "node:assert/strict";
import { getContractAddress, type Address, type Hex } from "viem";
import { assertDeploymentReceipt } from "../../scripts/lib/aqua-deployment";

test("deployment receipt binds exact creation, sender, nonce, chain and canonical block", () => {
  const owner = "0xc365B6795443380eb76516dA0Cedd5a00B349d66" as Address;
  const block = `0x${"1".repeat(64)}` as Hex;
  const expectedAddress = getContractAddress({ from: owner, nonce: 42n });
  const review: Parameters<typeof assertDeploymentReceipt>[0] = {
    owner,
    nonce: 42,
    data: "0x6000",
    expectedAddress,
  };
  const tx: Parameters<typeof assertDeploymentReceipt>[1] = {
    from: owner,
    to: null,
    input: "0x6000",
    value: 0n,
    nonce: 42,
    chainId: 42161,
    blockHash: block,
  };
  const receipt: Parameters<typeof assertDeploymentReceipt>[2] = {
    status: "success",
    contractAddress: expectedAddress,
    blockHash: block,
  };
  assert.doesNotThrow(() => assertDeploymentReceipt(review, tx, receipt));
  for (const change of [
    { from: "0x0000000000000000000000000000000000000001" },
    { to: owner },
    { input: "0x6001" },
    { value: 1n },
    { nonce: 43 },
    { chainId: 1 },
    { blockHash: `0x${"2".repeat(64)}` },
  ]) {
    assert.throws(
      () =>
        assertDeploymentReceipt(
          review,
          { ...tx, ...change } as typeof tx,
          receipt,
        ),
      /does not match/,
    );
  }
  assert.throws(
    () =>
      assertDeploymentReceipt(review, tx, {
        ...receipt,
        contractAddress: owner,
      }),
    /Unexpected deployed/,
  );
  // Reverted receipts still need identity checks and remain recordable as failures.
  assert.doesNotThrow(() =>
    assertDeploymentReceipt(review, tx, {
      ...receipt,
      status: "reverted",
      contractAddress: null,
    }),
  );
  assert.throws(
    () =>
      assertDeploymentReceipt(
        review,
        { ...tx, nonce: 43 },
        { ...receipt, status: "reverted", contractAddress: null },
      ),
    /does not match/,
  );
});
