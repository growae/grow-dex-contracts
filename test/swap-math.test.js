import { utils } from "@aeternity/aeproject";
import { assert } from "chai";
import { before, describe, it } from "mocha";
import { deploySophiaContract } from "./shared/fixtures.js";
import { expectRevert } from "./shared/utils.js";

describe("SwapMath", () => {
  let aeSdk;
  let sm;

  before(async () => {
    aeSdk = utils.getSdk();
    sm = await deploySophiaContract(aeSdk, "./test/contracts/SwapMathTest.aes");
  });

  describe("amount_out", () => {
    it("basic swap (1000 in with 10000/10000 reserves)", async () => {
      const r = await sm.amount_out(1000, 10000, 10000);
      const expected = 1000n * 10000n / (10000n + 1000n);
      assert.equal(r.decodedResult, expected);
    });

    it("larger input amount", async () => {
      const r = await sm.amount_out(5000, 10000, 10000);
      const expected = 5000n * 10000n / (10000n + 5000n);
      assert.equal(r.decodedResult, expected);
    });

    it("asymmetric reserves", async () => {
      const r = await sm.amount_out(1000, 5000, 20000);
      const expected = 1000n * 20000n / (5000n + 1000n);
      assert.equal(r.decodedResult, expected);
    });

    it("large amounts (10^18 scale)", async () => {
      const reserveIn = 10n ** 18n;
      const reserveOut = 10n ** 18n;
      const amtIn = 10n ** 15n;
      const r = await sm.amount_out(amtIn, reserveIn, reserveOut);
      const expected = amtIn * reserveOut / (reserveIn + amtIn);
      assert.equal(r.decodedResult, expected);
    });

    it("reverts on zero input amount", async () => {
      await expectRevert(sm.amount_out(0, 10000, 10000), "SWAP_INSUFFICIENT_INPUT");
    });

    it("reverts on zero reserve_in", async () => {
      await expectRevert(sm.amount_out(1000, 0, 10000), "SWAP_INSUFFICIENT_LIQUIDITY");
    });

    it("reverts on zero reserve_out", async () => {
      await expectRevert(sm.amount_out(1000, 10000, 0), "SWAP_INSUFFICIENT_LIQUIDITY");
    });
  });

  describe("amount_in", () => {
    it("basic inverse calculation", async () => {
      const r = await sm.amount_in(500, 10000, 10000);
      const expected = 10000n * 500n / (10000n - 500n) + 1n;
      assert.equal(r.decodedResult, expected);
    });

    it("rounds up (+1)", async () => {
      const r = await sm.amount_in(1, 10000, 10000);
      const expected = 10000n * 1n / (10000n - 1n) + 1n;
      assert.equal(r.decodedResult, expected);
      assert.isTrue(r.decodedResult >= 2n);
    });

    it("reverts on zero output amount", async () => {
      await expectRevert(sm.amount_in(0, 10000, 10000), "SWAP_INSUFFICIENT_OUTPUT");
    });

    it("reverts on zero reserves", async () => {
      await expectRevert(sm.amount_in(500, 0, 10000), "SWAP_INSUFFICIENT_LIQUIDITY");
    });

    it("reverts when amount_out equals reserve_out", async () => {
      await expectRevert(sm.amount_in(10000, 10000, 10000), "SWAP_EXCEEDS_RESERVES");
    });

    it("reverts when amount_out exceeds reserve_out", async () => {
      await expectRevert(sm.amount_in(15000, 10000, 10000), "SWAP_EXCEEDS_RESERVES");
    });
  });

  describe("quote", () => {
    it("proportional pricing (equal reserves)", async () => {
      const r = await sm.quote(1000, 10000, 10000);
      assert.equal(r.decodedResult, 1000n);
    });

    it("proportional pricing (2:1 ratio)", async () => {
      const r = await sm.quote(1000, 5000, 10000);
      assert.equal(r.decodedResult, 2000n);
    });

    it("proportional pricing (1:2 ratio)", async () => {
      const r = await sm.quote(1000, 10000, 5000);
      assert.equal(r.decodedResult, 500n);
    });

    it("reverts on zero amount", async () => {
      await expectRevert(sm.quote(0, 10000, 10000), "SWAP_INSUFFICIENT_AMOUNT");
    });

    it("reverts on zero reserve_a", async () => {
      await expectRevert(sm.quote(1000, 0, 10000), "SWAP_INSUFFICIENT_LIQUIDITY");
    });

    it("reverts on zero reserve_b", async () => {
      await expectRevert(sm.quote(1000, 10000, 0), "SWAP_INSUFFICIENT_LIQUIDITY");
    });
  });

  describe("round-trip", () => {
    it("amount_in(amount_out(X)) approximates X", async () => {
      const X = 1000n;
      const rIn = 10000n;
      const rOut = 10000n;

      const out = await sm.amount_out(X, rIn, rOut);
      const outVal = out.decodedResult;

      const newReserveIn = rIn + X;
      const newReserveOut = rOut - outVal;

      const backIn = await sm.amount_in(outVal, newReserveIn, newReserveOut);
      const diff = backIn.decodedResult > X ? backIn.decodedResult - X : X - backIn.decodedResult;
      assert.isTrue(diff <= 2n);
    });
  });
});
