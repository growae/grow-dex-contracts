import { utils } from "@aeternity/aeproject";
import { assert } from "chai";
import { before, describe, it } from "mocha";
import { deploySophiaContract } from "./shared/fixtures.js";
import { expectRevert } from "./shared/utils.js";

describe("Math", () => {
  let aeSdk;
  let math;

  before(async () => {
    aeSdk = utils.getSdk();
    math = await deploySophiaContract(aeSdk, "./test/contracts/MathTest.aes");
  });

  describe("min", () => {
    it("returns the smaller of two positive values", async () => {
      const r = await math.min(3, 7);
      assert.equal(r.decodedResult, 3n);
    });

    it("returns the smaller when first arg is larger", async () => {
      const r = await math.min(10, 2);
      assert.equal(r.decodedResult, 2n);
    });

    it("returns the value when both are equal", async () => {
      const r = await math.min(5, 5);
      assert.equal(r.decodedResult, 5n);
    });

    it("handles negative values", async () => {
      const r = await math.min(-3, 2);
      assert.equal(r.decodedResult, -3n);
    });

    it("handles two negative values", async () => {
      const r = await math.min(-10, -1);
      assert.equal(r.decodedResult, -10n);
    });
  });

  describe("max", () => {
    it("returns the larger of two positive values", async () => {
      const r = await math.max(3, 7);
      assert.equal(r.decodedResult, 7n);
    });

    it("returns the larger when first arg is larger", async () => {
      const r = await math.max(10, 2);
      assert.equal(r.decodedResult, 10n);
    });

    it("returns the value when both are equal", async () => {
      const r = await math.max(5, 5);
      assert.equal(r.decodedResult, 5n);
    });

    it("handles negative values", async () => {
      const r = await math.max(-3, 2);
      assert.equal(r.decodedResult, 2n);
    });

    it("handles two negative values", async () => {
      const r = await math.max(-10, -1);
      assert.equal(r.decodedResult, -1n);
    });
  });

  describe("abs", () => {
    it("positive stays positive", async () => {
      const r = await math.abs(42);
      assert.equal(r.decodedResult, 42n);
    });

    it("negative becomes positive", async () => {
      const r = await math.abs(-42);
      assert.equal(r.decodedResult, 42n);
    });

    it("zero stays zero", async () => {
      const r = await math.abs(0);
      assert.equal(r.decodedResult, 0n);
    });
  });

  describe("ceil_div", () => {
    it("exact division", async () => {
      const r = await math.ceil_div(10, 5);
      assert.equal(r.decodedResult, 2n);
    });

    it("rounds up when there is a remainder", async () => {
      const r = await math.ceil_div(7, 3);
      assert.equal(r.decodedResult, 3n);
    });

    it("rounds up 11 / 4 = 3", async () => {
      const r = await math.ceil_div(11, 4);
      assert.equal(r.decodedResult, 3n);
    });

    it("returns 0 when a is 0", async () => {
      const r = await math.ceil_div(0, 5);
      assert.equal(r.decodedResult, 0n);
    });

    it("reverts on zero divisor", async () => {
      await expectRevert(math.ceil_div(10, 0), "MATH_DIV_ZERO");
    });
  });

  describe("mul_div", () => {
    it("basic multiplication and division", async () => {
      const r = await math.mul_div(10, 3, 5);
      assert.equal(r.decodedResult, 6n);
    });

    it("floors the result", async () => {
      const r = await math.mul_div(10, 3, 4);
      assert.equal(r.decodedResult, 7n);
    });

    it("handles large numbers", async () => {
      const r = await math.mul_div(10n ** 18n, 10n ** 18n, 10n ** 18n);
      assert.equal(r.decodedResult, 10n ** 18n);
    });

    it("reverts on zero denom", async () => {
      await expectRevert(math.mul_div(10, 3, 0), "MATH_DIV_ZERO");
    });
  });

  describe("mul_div_ceil", () => {
    it("exact result matches mul_div", async () => {
      const floor = await math.mul_div(10, 3, 5);
      const ceil = await math.mul_div_ceil(10, 3, 5);
      assert.equal(floor.decodedResult, ceil.decodedResult);
    });

    it("rounds up when there is a remainder", async () => {
      const floor = await math.mul_div(10, 3, 4);
      const ceil = await math.mul_div_ceil(10, 3, 4);
      assert.equal(floor.decodedResult, 7n);
      assert.equal(ceil.decodedResult, 8n);
    });

    it("reverts on zero denom", async () => {
      await expectRevert(math.mul_div_ceil(10, 3, 0), "MATH_DIV_ZERO");
    });
  });

  describe("sqrt", () => {
    it("sqrt(0) = 0", async () => {
      const r = await math.sqrt(0);
      assert.equal(r.decodedResult, 0n);
    });

    it("sqrt(1) = 1", async () => {
      const r = await math.sqrt(1);
      assert.equal(r.decodedResult, 1n);
    });

    it("sqrt(4) = 2", async () => {
      const r = await math.sqrt(4);
      assert.equal(r.decodedResult, 2n);
    });

    it("sqrt(9) = 3", async () => {
      const r = await math.sqrt(9);
      assert.equal(r.decodedResult, 3n);
    });

    it("sqrt(100) = 10", async () => {
      const r = await math.sqrt(100);
      assert.equal(r.decodedResult, 10n);
    });

    it("sqrt(8) rounds down to 2", async () => {
      const r = await math.sqrt(8);
      assert.equal(r.decodedResult, 2n);
    });

    it("sqrt(2) rounds down to 1", async () => {
      const r = await math.sqrt(2);
      assert.equal(r.decodedResult, 1n);
    });

    it("sqrt(3) rounds down to 1", async () => {
      const r = await math.sqrt(3);
      assert.equal(r.decodedResult, 1n);
    });

    it("handles large perfect square (10^18)", async () => {
      const r = await math.sqrt(10n ** 18n);
      assert.equal(r.decodedResult, 10n ** 9n);
    });

    it("reverts on negative input", async () => {
      await expectRevert(math.sqrt(-1), "MATH_NEGATIVE_SQRT");
    });
  });
});
