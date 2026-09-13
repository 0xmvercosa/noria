import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { Order, HexString } from '@1inch/swap-vm-sdk';
import { buildOfficialOrder, DEPLOYMENTS } from '../src/official.js';

test('official order encodes the correct maker, Aqua hash and deterministic program',()=>{
  const built=buildOfficialOrder({maker:'0x0000000000000000000000000000000000000011',
    lowerPriceE6:2500_000000n,upperPriceE6:3500_000000n,lpFeeBps:30,salt:1n});
  assert.equal(keccak256(built.bytes),built.strategyHash);
  assert.equal(Order.decode(new HexString(built.bytes)).build().maker.toLowerCase(),'0x0000000000000000000000000000000000000011');
  assert.ok(built.bytes.toLowerCase().includes(DEPLOYMENTS.kycNft.slice(2)));
  assert.equal(built.order.traits.useAquaInsteadOfSignature,true);
});
test('invalid range and fee fail before calldata is produced',()=>{
  assert.throws(()=>buildOfficialOrder({maker:DEPLOYMENTS.aqua,lowerPriceE6:1n,upperPriceE6:1n,lpFeeBps:30,salt:1n}),/range/);
  assert.throws(()=>buildOfficialOrder({maker:DEPLOYMENTS.aqua,lowerPriceE6:1n,upperPriceE6:2n,lpFeeBps:1000,salt:1n}),/fee/);
});

