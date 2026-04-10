import { utils } from "@aeternity/aeproject";
import { assert } from "chai";
import { before, describe, it } from "mocha";
import { deploySophiaContract } from "./shared/fixtures.js";
import { expectRevert } from "./shared/utils.js";

const FEE_RATE_DENOMINATOR = 1_000_000n;

function ceilDiv(a, b) {
  if (a === 0n) return 0n;
  return (a + b - 1n) / b;
}

describe("FeeMath", () => {
  let aeSdk;
  let fm;

  before(async () => {
    aeSdk = utils.getSdk();
    fm = await deploySophiaContract(aeSdk, "./test/contracts/FeeMathTest.aes");
  });

  describe("trading_fee", () => {
    it("zero rate returns 0", async () => {
      const r = await fm.trading_fee(1_000_000, 0);
      assert.equal(r.decodedResult, 0n);
    });

    it("0.3% of 1_000_000 = 3000 (exact)", async () => {
      const rate = 3000n;
      const r = await fm.trading_fee(1_000_000, rate);
      assert.equal(r.decodedResult, 3000n);
    });

    it("rounds up when remainder exists", async () => {
      const rate = 3000n;
      const r = await fm.trading_fee(1_000_001, rate);
      const expected = ceilDiv(1_000_001n * rate, FEE_RATE_DENOMINATOR);
      assert.equal(r.decodedResult, expected);
      assert.isTrue(r.decodedResult > 3000n);
    });

    it("1% of 500_000", async () => {
      const rate = 10_000n;
      const r = await fm.trading_fee(500_000, rate);
      assert.equal(r.decodedResult, 5000n);
    });

    it("small amount with large rate", async () => {
      const rate = 100_000n;
      const r = await fm.trading_fee(7, rate);
      const expected = ceilDiv(7n * rate, FEE_RATE_DENOMINATOR);
      assert.equal(r.decodedResult, expected);
    });

    it("fee of 1 token with 0.3% rate rounds up to 1", async () => {
      const rate = 3000n;
      const r = await fm.trading_fee(1, rate);
      assert.equal(r.decodedResult, 1n);
    });
  });

  describe("protocol_fee", () => {
    it("12% of trade fee (floor)", async () => {
      const rate = 120_000n;
      const tradeFee = 3000n;
      const r = await fm.protocol_fee(tradeFee, rate);
      assert.equal(r.decodedResult, tradeFee * rate / FEE_RATE_DENOMINATOR);
    });

    it("zero trade fee returns 0", async () => {
      const r = await fm.protocol_fee(0, 120_000);
      assert.equal(r.decodedResult, 0n);
    });

    it("zero rate returns 0", async () => {
      const r = await fm.protocol_fee(3000, 0);
      assert.equal(r.decodedResult, 0n);
    });

    it("floors when remainder exists", async () => {
      const rate = 120_000n;
      const tradeFee = 3001n;
      const r = await fm.protocol_fee(tradeFee, rate);
      const expected = tradeFee * rate / FEE_RATE_DENOMINATOR;
      assert.equal(r.decodedResult, expected);
    });
  });

  describe("fund_fee", () => {
    it("same pattern as protocol_fee", async () => {
      const rate = 80_000n;
      const tradeFee = 3000n;
      const r = await fm.fund_fee(tradeFee, rate);
      assert.equal(r.decodedResult, tradeFee * rate / FEE_RATE_DENOMINATOR);
    });

    it("zero trade fee returns 0", async () => {
      const r = await fm.fund_fee(0, 80_000);
      assert.equal(r.decodedResult, 0n);
    });

    it("zero rate returns 0", async () => {
      const r = await fm.fund_fee(5000, 0);
      assert.equal(r.decodedResult, 0n);
    });
  });

  describe("creator_fee", () => {
    it("zero rate returns 0", async () => {
      const r = await fm.creator_fee(1_000_000, 0);
      assert.equal(r.decodedResult, 0n);
    });

    it("rounds up (ceil_div)", async () => {
      const rate = 5000n;
      const amount = 1_000_001n;
      const r = await fm.creator_fee(amount, rate);
      const expected = ceilDiv(amount * rate, FEE_RATE_DENOMINATOR);
      assert.equal(r.decodedResult, expected);
    });

    it("exact division", async () => {
      const rate = 10_000n;
      const r = await fm.creator_fee(1_000_000, rate);
      assert.equal(r.decodedResult, 10_000n);
    });
  });

  describe("pre_fee_amount", () => {
    it("zero rate returns same amount", async () => {
      const r = await fm.pre_fee_amount(1_000_000, 0);
      assert.equal(r.decodedResult, 1_000_000n);
    });

    it("inverse of trading_fee for 0.3% rate", async () => {
      const rate = 3000n;
      const postAmount = 997_000n;
      const pre = await fm.pre_fee_amount(postAmount, rate);
      const fee = await fm.trading_fee(pre.decodedResult, rate);
      assert.isTrue(pre.decodedResult - fee.decodedResult >= postAmount);
    });

    it("rounds up", async () => {
      const rate = 3000n;
      const postAmount = 1n;
      const r = await fm.pre_fee_amount(postAmount, rate);
      assert.isTrue(r.decodedResult >= postAmount);
    });

    it("pre_fee_amount with 1% rate", async () => {
      const rate = 10_000n;
      const postAmount = 990_000n;
      const pre = await fm.pre_fee_amount(postAmount, rate);
      const expected = ceilDiv(postAmount * FEE_RATE_DENOMINATOR, FEE_RATE_DENOMINATOR - rate);
      assert.equal(pre.decodedResult, expected);
    });
  });

  describe("cross-checks", () => {
    it("trading_fee(pre_fee_amount(X, rate), rate) >= X", async () => {
      const rate = 3000n;
      const X = 500_000n;
      const pre = await fm.pre_fee_amount(X, rate);
      const fee = await fm.trading_fee(pre.decodedResult, rate);
      assert.isTrue(fee.decodedResult >= ceilDiv(X * rate, FEE_RATE_DENOMINATOR - rate) * rate / FEE_RATE_DENOMINATOR);
    });

    it("pre - trading_fee(pre) >= post for various amounts", async () => {
      const rate = 3000n;
      for (const postAmount of [1000n, 50_000n, 1_000_000n]) {
        const pre = await fm.pre_fee_amount(postAmount, rate);
        const fee = await fm.trading_fee(pre.decodedResult, rate);
        assert.isTrue(pre.decodedResult - fee.decodedResult >= postAmount);
      }
    });
  });
});
