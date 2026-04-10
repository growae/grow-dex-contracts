import { utils } from "@aeternity/aeproject";
import { assert } from "chai";
import { before, describe, it } from "mocha";
import { deploySophiaContract } from "./shared/fixtures.js";
import { expectRevert, Q64 } from "./shared/utils.js";

describe("TickMath", () => {
  let aeSdk;
  let tickMath;

  const MIN_TICK = -443636n;
  const MAX_TICK = 443636n;
  const MIN_SQRT_PRICE = 4295048016n;
  const MAX_SQRT_PRICE = 79226673521066979257578248091n;

  before(async () => {
    aeSdk = utils.getSdk();
    tickMath = await deploySophiaContract(aeSdk, "./test/contracts/TickMathTest.aes");
  });

  describe("constants", () => {
    it("returns correct MIN_TICK", async () => {
      const result = await tickMath.min_tick();
      assert.equal(result.decodedResult, MIN_TICK);
    });

    it("returns correct MAX_TICK", async () => {
      const result = await tickMath.max_tick();
      assert.equal(result.decodedResult, MAX_TICK);
    });

    it("returns correct MIN_SQRT_PRICE", async () => {
      const result = await tickMath.min_sqrt_price();
      assert.equal(result.decodedResult, MIN_SQRT_PRICE);
    });

    it("returns correct MAX_SQRT_PRICE", async () => {
      const result = await tickMath.max_sqrt_price();
      assert.equal(result.decodedResult, MAX_SQRT_PRICE);
    });
  });

  describe("get_sqrt_price_at_tick", () => {
    it("tick 0 returns Q64", async () => {
      const result = await tickMath.get_sqrt_price_at_tick(0);
      assert.equal(result.decodedResult, Q64);
    });

    it("tick 1 returns slightly above Q64", async () => {
      const result = await tickMath.get_sqrt_price_at_tick(1);
      assert.isTrue(result.decodedResult > Q64);
      const diff = result.decodedResult - Q64;
      const tolerance = Q64 / 10000n;
      assert.isTrue(diff < tolerance, "tick 1 price should be close to Q64");
    });

    it("tick -1 returns slightly below Q64", async () => {
      const result = await tickMath.get_sqrt_price_at_tick(-1);
      assert.isTrue(result.decodedResult < Q64);
      const diff = Q64 - result.decodedResult;
      const tolerance = Q64 / 10000n;
      assert.isTrue(diff < tolerance, "tick -1 price should be close to Q64");
    });

    it("MIN_TICK returns MIN_SQRT_PRICE", async () => {
      const result = await tickMath.get_sqrt_price_at_tick(Number(MIN_TICK));
      assert.equal(result.decodedResult, MIN_SQRT_PRICE);
    });

    it("MAX_TICK returns MAX_SQRT_PRICE", async () => {
      const result = await tickMath.get_sqrt_price_at_tick(Number(MAX_TICK));
      assert.equal(result.decodedResult, MAX_SQRT_PRICE);
    });

    it("reverts on tick below MIN_TICK", async () => {
      await expectRevert(
        tickMath.get_sqrt_price_at_tick(Number(MIN_TICK) - 1),
        "TICK_OOB"
      );
    });

    it("reverts on tick above MAX_TICK", async () => {
      await expectRevert(
        tickMath.get_sqrt_price_at_tick(Number(MAX_TICK) + 1),
        "TICK_OOB"
      );
    });

    it("positive tick gives higher price than negative tick", async () => {
      const pos = await tickMath.get_sqrt_price_at_tick(100);
      const neg = await tickMath.get_sqrt_price_at_tick(-100);
      assert.isTrue(pos.decodedResult > neg.decodedResult);
    });

    it("prices increase monotonically with tick", async () => {
      const ticks = [-1000, -100, -10, 0, 10, 100, 1000];
      const prices = [];
      for (const t of ticks) {
        const r = await tickMath.get_sqrt_price_at_tick(t);
        prices.push(r.decodedResult);
      }
      for (let i = 1; i < prices.length; i++) {
        assert.isTrue(prices[i] > prices[i - 1], `price at tick ${ticks[i]} should be > price at tick ${ticks[i - 1]}`);
      }
    });
  });

  describe("get_tick_at_sqrt_price", () => {
    it("Q64 returns tick 0", async () => {
      const result = await tickMath.get_tick_at_sqrt_price(Q64);
      assert.equal(result.decodedResult, 0n);
    });

    it("MIN_SQRT_PRICE returns MIN_TICK", async () => {
      const result = await tickMath.get_tick_at_sqrt_price(MIN_SQRT_PRICE);
      assert.equal(result.decodedResult, MIN_TICK);
    });

    it("MAX_SQRT_PRICE returns MAX_TICK", async () => {
      const result = await tickMath.get_tick_at_sqrt_price(MAX_SQRT_PRICE);
      assert.equal(result.decodedResult, MAX_TICK);
    });

    it("reverts on price below MIN_SQRT_PRICE", async () => {
      await expectRevert(
        tickMath.get_tick_at_sqrt_price(MIN_SQRT_PRICE - 1n),
        "PRICE_OOB"
      );
    });

    it("reverts on price above MAX_SQRT_PRICE", async () => {
      await expectRevert(
        tickMath.get_tick_at_sqrt_price(MAX_SQRT_PRICE + 1n),
        "PRICE_OOB"
      );
    });
  });

  describe("round-trip", () => {
    const testTicks = [0, 1, -1, 100, -100, 887, -887, 10000, -10000, 50000, -50000];

    for (const tick of testTicks) {
      it(`tick ${tick} → price → tick recovers original tick`, async () => {
        const priceResult = await tickMath.get_sqrt_price_at_tick(tick);
        const tickResult = await tickMath.get_tick_at_sqrt_price(priceResult.decodedResult);
        assert.equal(tickResult.decodedResult, BigInt(tick));
      });
    }
  });

  describe("symmetry", () => {
    const testTicks = [1, 10, 100, 1000, 10000];

    for (const tick of testTicks) {
      it(`price(${tick}) × price(${-tick}) ≈ Q64²`, async () => {
        const posResult = await tickMath.get_sqrt_price_at_tick(tick);
        const negResult = await tickMath.get_sqrt_price_at_tick(-tick);
        const product = posResult.decodedResult * negResult.decodedResult;
        const q64Squared = Q64 * Q64;
        const diff = product > q64Squared ? product - q64Squared : q64Squared - product;
        const tolerance = q64Squared / 1000000n;
        assert.isTrue(diff < tolerance, `product ${product} should be close to Q64² ${q64Squared}`);
      });
    }
  });
});
