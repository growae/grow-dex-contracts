import { utils } from "@aeternity/aeproject";
import { assert } from "chai";
import { before, describe, it } from "mocha";
import { deploySophiaContract } from "./shared/fixtures.js";
import { expectRevert, Q64, approxEqual } from "./shared/utils.js";

describe("LiquidityMath", () => {
  let aeSdk;
  let lm;

  const price_low = Q64;
  const price_high = Q64 * 2n;
  const liquidity = 1000000n * Q64;

  before(async () => {
    aeSdk = utils.getSdk();
    lm = await deploySophiaContract(aeSdk, "./test/contracts/LiquidityMathTest.aes");
  });

  describe("get_delta_amount_0", () => {
    it("returns 0 when prices are equal", async () => {
      const result = await lm.get_delta_amount_0(price_low, price_low, liquidity, false);
      assert.equal(result.decodedResult, 0n);
    });

    it("computes correct amount with round_up=false", async () => {
      const result = await lm.get_delta_amount_0(price_low, price_high, liquidity, false);
      assert.isTrue(result.decodedResult > 0n);
      const expected = liquidity * Q64 * (price_high - price_low) / (price_high * price_low);
      assert.equal(result.decodedResult, expected);
    });

    it("round_up >= round_down", async () => {
      const down = await lm.get_delta_amount_0(price_low, price_high, liquidity, false);
      const up = await lm.get_delta_amount_0(price_low, price_high, liquidity, true);
      assert.isTrue(up.decodedResult >= down.decodedResult);
    });

    it("is symmetric in price argument order", async () => {
      const a = await lm.get_delta_amount_0(price_low, price_high, liquidity, false);
      const b = await lm.get_delta_amount_0(price_high, price_low, liquidity, false);
      assert.equal(a.decodedResult, b.decodedResult);
    });

    it("reverts when lower price is zero", async () => {
      await expectRevert(
        lm.get_delta_amount_0(0, price_high, liquidity, false),
        "ZERO_PRICE"
      );
    });
  });

  describe("get_delta_amount_1", () => {
    it("returns 0 when prices are equal", async () => {
      const result = await lm.get_delta_amount_1(price_low, price_low, liquidity, false);
      assert.equal(result.decodedResult, 0n);
    });

    it("computes correct amount with round_up=false", async () => {
      const result = await lm.get_delta_amount_1(price_low, price_high, liquidity, false);
      assert.isTrue(result.decodedResult > 0n);
      const expected = liquidity * (price_high - price_low) / Q64;
      assert.equal(result.decodedResult, expected);
    });

    it("round_up >= round_down", async () => {
      const down = await lm.get_delta_amount_1(price_low, price_high, liquidity, false);
      const up = await lm.get_delta_amount_1(price_low, price_high, liquidity, true);
      assert.isTrue(up.decodedResult >= down.decodedResult);
    });

    it("is symmetric in price argument order", async () => {
      const a = await lm.get_delta_amount_1(price_low, price_high, liquidity, false);
      const b = await lm.get_delta_amount_1(price_high, price_low, liquidity, false);
      assert.equal(a.decodedResult, b.decodedResult);
    });
  });

  describe("get_liquidity_from_amounts", () => {
    it("price below range uses only amount_0", async () => {
      const price_current = price_low / 2n;
      const liq = await lm.get_liquidity_from_amounts(
        price_current, price_low, price_high, 1000000n, 1000000n
      );
      const liq0 = await lm.get_liquidity_from_amount_0(price_low, price_high, 1000000n);
      assert.equal(liq.decodedResult, liq0.decodedResult);
    });

    it("price above range uses only amount_1", async () => {
      const price_current = price_high * 2n;
      const liq = await lm.get_liquidity_from_amounts(
        price_current, price_low, price_high, 1000000n, 1000000n
      );
      const liq1 = await lm.get_liquidity_from_amount_1(price_low, price_high, 1000000n);
      assert.equal(liq.decodedResult, liq1.decodedResult);
    });

    it("price in range uses min of both", async () => {
      const price_mid = price_low + (price_high - price_low) / 2n;
      const liq = await lm.get_liquidity_from_amounts(
        price_mid, price_low, price_high, 1000000n, 1000000n
      );
      const liq0 = await lm.get_liquidity_from_amount_0(price_mid, price_high, 1000000n);
      const liq1 = await lm.get_liquidity_from_amount_1(price_low, price_mid, 1000000n);
      const expectedMin = liq0.decodedResult < liq1.decodedResult ? liq0.decodedResult : liq1.decodedResult;
      assert.equal(liq.decodedResult, expectedMin);
    });

    it("reverts on identical prices for amount_0", async () => {
      await expectRevert(
        lm.get_liquidity_from_amount_0(price_low, price_low, 1000n),
        "IDENTICAL_PRICES"
      );
    });

    it("reverts on identical prices for amount_1", async () => {
      await expectRevert(
        lm.get_liquidity_from_amount_1(price_low, price_low, 1000n),
        "IDENTICAL_PRICES"
      );
    });
  });

  describe("add_delta", () => {
    it("adds positive delta", async () => {
      const result = await lm.add_delta(1000n, 500n);
      assert.equal(result.decodedResult, 1500n);
    });

    it("subtracts negative delta", async () => {
      const result = await lm.add_delta(1000n, -500n);
      assert.equal(result.decodedResult, 500n);
    });

    it("reverts on underflow", async () => {
      await expectRevert(
        lm.add_delta(100n, -200n),
        "LIQUIDITY_UNDERFLOW"
      );
    });

    it("allows zero result", async () => {
      const result = await lm.add_delta(100n, -100n);
      assert.equal(result.decodedResult, 0n);
    });
  });

  describe("get_next_sqrt_price_from_amount_0", () => {
    it("returns same price when amount is 0", async () => {
      const result = await lm.get_next_sqrt_price_from_amount_0(Q64, liquidity, 0n, true);
      assert.equal(result.decodedResult, Q64);
    });

    it("adding token0 decreases price", async () => {
      const result = await lm.get_next_sqrt_price_from_amount_0(Q64, liquidity, 10000n, true);
      assert.isTrue(result.decodedResult < Q64);
    });

    it("removing token0 increases price", async () => {
      const result = await lm.get_next_sqrt_price_from_amount_0(Q64, liquidity, 10000n, false);
      assert.isTrue(result.decodedResult > Q64);
    });
  });

  describe("get_next_sqrt_price_from_amount_1", () => {
    it("returns same price when amount is 0", async () => {
      const result = await lm.get_next_sqrt_price_from_amount_1(Q64, liquidity, 0n, true);
      assert.equal(result.decodedResult, Q64);
    });

    it("adding token1 increases price", async () => {
      const amount = 10000000000n;
      const result = await lm.get_next_sqrt_price_from_amount_1(Q64, liquidity, amount, true);
      assert.isTrue(result.decodedResult > Q64);
    });

    it("removing token1 decreases price", async () => {
      const amount = 10000000000n;
      const result = await lm.get_next_sqrt_price_from_amount_1(Q64, liquidity, amount, false);
      assert.isTrue(result.decodedResult < Q64);
    });
  });

  describe("round-trip: amounts → liquidity → amounts", () => {
    it("recovers approximate amounts from liquidity", async () => {
      const amount_0 = 1000000n;
      const amount_1 = 500000n;
      const price_mid = price_low + (price_high - price_low) / 2n;

      const liq = await lm.get_liquidity_from_amounts(
        price_mid, price_low, price_high, amount_0, amount_1
      );

      const recovered_0 = await lm.get_delta_amount_0(price_mid, price_high, liq.decodedResult, false);
      const recovered_1 = await lm.get_delta_amount_1(price_low, price_mid, liq.decodedResult, false);

      assert.isTrue(recovered_0.decodedResult <= amount_0, "recovered amount0 should not exceed input");
      assert.isTrue(recovered_1.decodedResult <= amount_1, "recovered amount1 should not exceed input");
    });
  });
});
