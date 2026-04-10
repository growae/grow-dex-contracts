import { utils } from "@aeternity/aeproject";
import { assert } from "chai";
import { before, describe, it } from "mocha";
import { deploySophiaContract } from "./shared/fixtures.js";
import { expectRevert } from "./shared/utils.js";

describe("BitMap", () => {
  let aeSdk;
  let bm;

  before(async () => {
    aeSdk = utils.getSdk();
    bm = await deploySophiaContract(aeSdk, "./test/contracts/BitMapTest.aes");
  });

  describe("flip_bit and is_initialized", () => {
    it("flipping a bit sets it", async () => {
      let bitmap = 0n;
      const flipped = await bm.flip_bit(bitmap, 5);
      const initialized = await bm.is_initialized(flipped.decodedResult, 5);
      assert.isTrue(initialized.decodedResult);
    });

    it("unset bits return false", async () => {
      const bitmap = 1n << 5n;
      const initialized = await bm.is_initialized(bitmap, 3);
      assert.isFalse(initialized.decodedResult);
    });

    it("double flip returns to 0", async () => {
      let bitmap = 0n;
      const first = await bm.flip_bit(bitmap, 10);
      const second = await bm.flip_bit(first.decodedResult, 10);
      assert.equal(second.decodedResult, 0n);
    });

    it("flipping multiple bits works", async () => {
      let bitmap = 0n;
      const r1 = await bm.flip_bit(bitmap, 0);
      const r2 = await bm.flip_bit(r1.decodedResult, 3);
      const r3 = await bm.flip_bit(r2.decodedResult, 7);

      const expected = (1n << 0n) | (1n << 3n) | (1n << 7n);
      assert.equal(r3.decodedResult, expected);

      const i0 = await bm.is_initialized(r3.decodedResult, 0);
      const i3 = await bm.is_initialized(r3.decodedResult, 3);
      const i7 = await bm.is_initialized(r3.decodedResult, 7);
      const i1 = await bm.is_initialized(r3.decodedResult, 1);
      assert.isTrue(i0.decodedResult);
      assert.isTrue(i3.decodedResult);
      assert.isTrue(i7.decodedResult);
      assert.isFalse(i1.decodedResult);
    });
  });

  describe("next_initialized_bit_lte", () => {
    it("finds the bit at the exact position", async () => {
      const bitmap = 1n << 5n;
      const result = await bm.next_initialized_bit_lte(bitmap, 5);
      assert.equal(result.decodedResult, 5n);
    });

    it("finds the nearest lower set bit", async () => {
      const bitmap = (1n << 3n) | (1n << 7n);
      const result = await bm.next_initialized_bit_lte(bitmap, 5);
      assert.equal(result.decodedResult, 3n);
    });

    it("returns None when no bits set below position", async () => {
      const bitmap = 1n << 10n;
      const result = await bm.next_initialized_bit_lte(bitmap, 5);
      assert.isUndefined(result.decodedResult);
    });

    it("returns None for empty bitmap", async () => {
      const result = await bm.next_initialized_bit_lte(0, 100);
      assert.isUndefined(result.decodedResult);
    });

    it("returns None for negative bit_pos", async () => {
      const bitmap = 1n << 0n;
      const result = await bm.next_initialized_bit_lte(bitmap, -1);
      assert.isUndefined(result.decodedResult);
    });
  });

  describe("next_initialized_bit_gte", () => {
    it("finds the bit at the exact position", async () => {
      const bitmap = 1n << 5n;
      const result = await bm.next_initialized_bit_gte(bitmap, 5);
      assert.equal(result.decodedResult, 5n);
    });

    it("finds the nearest higher set bit", async () => {
      const bitmap = (1n << 3n) | (1n << 7n);
      const result = await bm.next_initialized_bit_gte(bitmap, 5);
      assert.equal(result.decodedResult, 7n);
    });

    it("returns None when no bits set above position", async () => {
      const bitmap = 1n << 3n;
      const result = await bm.next_initialized_bit_gte(bitmap, 5);
      assert.isUndefined(result.decodedResult);
    });

    it("returns None for empty bitmap", async () => {
      const result = await bm.next_initialized_bit_gte(0, 0);
      assert.isUndefined(result.decodedResult);
    });

    it("finds bit 0 from position 0", async () => {
      const bitmap = 1n;
      const result = await bm.next_initialized_bit_gte(bitmap, 0);
      assert.equal(result.decodedResult, 0n);
    });
  });

  describe("large bitmaps", () => {
    it("handles bit at position 500", async () => {
      const bitmap = 1n << 500n;
      const init = await bm.is_initialized(bitmap, 500);
      assert.isTrue(init.decodedResult);

      const notInit = await bm.is_initialized(bitmap, 499);
      assert.isFalse(notInit.decodedResult);
    });

    it("finds large bit with next_initialized_bit_lte", async () => {
      const bitmap = 1n << 500n;
      const result = await bm.next_initialized_bit_lte(bitmap, 600);
      assert.equal(result.decodedResult, 500n);
    });

    it("finds large bit with next_initialized_bit_gte", async () => {
      const bitmap = 1n << 500n;
      const result = await bm.next_initialized_bit_gte(bitmap, 400);
      assert.equal(result.decodedResult, 500n);
    });

    it("double flip at position 1000 returns to 0", async () => {
      const first = await bm.flip_bit(0, 1000);
      const second = await bm.flip_bit(first.decodedResult, 1000);
      assert.equal(second.decodedResult, 0n);
    });
  });

  describe("msb", () => {
    it("msb(1) = 0", async () => {
      const result = await bm.msb(1);
      assert.equal(result.decodedResult, 0n);
    });

    it("msb(2) = 1", async () => {
      const result = await bm.msb(2);
      assert.equal(result.decodedResult, 1n);
    });

    it("msb(8) = 3", async () => {
      const result = await bm.msb(8);
      assert.equal(result.decodedResult, 3n);
    });

    it("msb(255) = 7", async () => {
      const result = await bm.msb(255);
      assert.equal(result.decodedResult, 7n);
    });

    it("msb(256) = 8", async () => {
      const result = await bm.msb(256);
      assert.equal(result.decodedResult, 8n);
    });

    it("msb of large number (2^100) = 100", async () => {
      const result = await bm.msb(1n << 100n);
      assert.equal(result.decodedResult, 100n);
    });

    it("reverts on 0", async () => {
      await expectRevert(bm.msb(0), "MSB_OF_ZERO");
    });
  });

  describe("lsb", () => {
    it("lsb(1) = 0", async () => {
      const result = await bm.lsb(1);
      assert.equal(result.decodedResult, 0n);
    });

    it("lsb(2) = 1", async () => {
      const result = await bm.lsb(2);
      assert.equal(result.decodedResult, 1n);
    });

    it("lsb(12) = 2", async () => {
      const result = await bm.lsb(12);
      assert.equal(result.decodedResult, 2n);
    });

    it("lsb(256) = 8", async () => {
      const result = await bm.lsb(256);
      assert.equal(result.decodedResult, 8n);
    });

    it("lsb of large number (3 × 2^100) = 100", async () => {
      const result = await bm.lsb(3n * (1n << 100n));
      assert.equal(result.decodedResult, 100n);
    });

    it("reverts on 0", async () => {
      await expectRevert(bm.lsb(0), "LSB_OF_ZERO");
    });
  });
});
