import { utils } from "@aeternity/aeproject";
import { assert } from "chai";
import { before, describe, it } from "mocha";
import { deploySophiaContract } from "./shared/fixtures.js";
import { expectRevert } from "./shared/utils.js";

const EMPTY = new Map();

describe("BitMap", () => {
  let aeSdk;
  let bm;

  before(async () => {
    aeSdk = utils.getSdk();
    bm = await deploySophiaContract(aeSdk, "./test/contracts/BitMapTest.aes");
  });

  describe("flip_bit and is_initialized", () => {
    it("flipping a bit sets it", async () => {
      const flipped = await bm.flip_bit(EMPTY, 5);
      const initialized = await bm.is_initialized(flipped.decodedResult, 5);
      assert.isTrue(initialized.decodedResult);
    });

    it("unset bits return false", async () => {
      const flipped = await bm.flip_bit(EMPTY, 5);
      const initialized = await bm.is_initialized(flipped.decodedResult, 3);
      assert.isFalse(initialized.decodedResult);
    });

    it("double flip returns to empty", async () => {
      const first = await bm.flip_bit(EMPTY, 10);
      const second = await bm.flip_bit(first.decodedResult, 10);
      assert.equal(second.decodedResult.size, 0);
    });

    it("flipping multiple bits works", async () => {
      const r1 = await bm.flip_bit(EMPTY, 0);
      const r2 = await bm.flip_bit(r1.decodedResult, 3);
      const r3 = await bm.flip_bit(r2.decodedResult, 7);

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

  describe("negative bit positions", () => {
    it("flipping a negative bit sets it", async () => {
      const flipped = await bm.flip_bit(EMPTY, -10);
      const initialized = await bm.is_initialized(flipped.decodedResult, -10);
      assert.isTrue(initialized.decodedResult);
    });

    it("negative and positive bits coexist", async () => {
      const r1 = await bm.flip_bit(EMPTY, -5);
      const r2 = await bm.flip_bit(r1.decodedResult, 5);
      const iNeg = await bm.is_initialized(r2.decodedResult, -5);
      const iPos = await bm.is_initialized(r2.decodedResult, 5);
      assert.isTrue(iNeg.decodedResult);
      assert.isTrue(iPos.decodedResult);
    });

    it("double flip negative bit returns to empty", async () => {
      const first = await bm.flip_bit(EMPTY, -100);
      const second = await bm.flip_bit(first.decodedResult, -100);
      assert.equal(second.decodedResult.size, 0);
    });
  });

  describe("next_initialized_bit_lte", () => {
    it("finds the bit at the exact position", async () => {
      const bmap = await bm.flip_bit(EMPTY, 5);
      const result = await bm.next_initialized_bit_lte(bmap.decodedResult, 5);
      assert.equal(result.decodedResult, 5n);
    });

    it("finds the nearest lower set bit", async () => {
      let bmap = await bm.flip_bit(EMPTY, 3);
      bmap = await bm.flip_bit(bmap.decodedResult, 7);
      const result = await bm.next_initialized_bit_lte(bmap.decodedResult, 5);
      assert.equal(result.decodedResult, 3n);
    });

    it("returns None when no bits set below position", async () => {
      const bmap = await bm.flip_bit(EMPTY, 10);
      const result = await bm.next_initialized_bit_lte(bmap.decodedResult, 5);
      assert.isUndefined(result.decodedResult);
    });

    it("returns None for empty bitmap", async () => {
      const result = await bm.next_initialized_bit_lte(EMPTY, 100);
      assert.isUndefined(result.decodedResult);
    });

    it("finds negative bits", async () => {
      const bmap = await bm.flip_bit(EMPTY, -10);
      const result = await bm.next_initialized_bit_lte(bmap.decodedResult, -5);
      assert.equal(result.decodedResult, -10n);
    });
  });

  describe("next_initialized_bit_gte", () => {
    it("finds the bit at the exact position", async () => {
      const bmap = await bm.flip_bit(EMPTY, 5);
      const result = await bm.next_initialized_bit_gte(bmap.decodedResult, 5);
      assert.equal(result.decodedResult, 5n);
    });

    it("finds the nearest higher set bit", async () => {
      let bmap = await bm.flip_bit(EMPTY, 3);
      bmap = await bm.flip_bit(bmap.decodedResult, 7);
      const result = await bm.next_initialized_bit_gte(bmap.decodedResult, 5);
      assert.equal(result.decodedResult, 7n);
    });

    it("returns None when no bits set above position", async () => {
      const bmap = await bm.flip_bit(EMPTY, 3);
      const result = await bm.next_initialized_bit_gte(bmap.decodedResult, 5);
      assert.isUndefined(result.decodedResult);
    });

    it("returns None for empty bitmap", async () => {
      const result = await bm.next_initialized_bit_gte(EMPTY, 0);
      assert.isUndefined(result.decodedResult);
    });

    it("finds bit 0 from position 0", async () => {
      const bmap = await bm.flip_bit(EMPTY, 0);
      const result = await bm.next_initialized_bit_gte(bmap.decodedResult, 0);
      assert.equal(result.decodedResult, 0n);
    });

    it("finds negative bit from lower negative", async () => {
      const bmap = await bm.flip_bit(EMPTY, -5);
      const result = await bm.next_initialized_bit_gte(bmap.decodedResult, -10);
      assert.equal(result.decodedResult, -5n);
    });
  });

  describe("cross-word boundaries", () => {
    it("handles bit at position 300 (word index 1)", async () => {
      const bmap = await bm.flip_bit(EMPTY, 300);
      const init = await bm.is_initialized(bmap.decodedResult, 300);
      assert.isTrue(init.decodedResult);

      const notInit = await bm.is_initialized(bmap.decodedResult, 299);
      assert.isFalse(notInit.decodedResult);
    });

    it("finds bit across word boundary with lte", async () => {
      const bmap = await bm.flip_bit(EMPTY, 100);
      const result = await bm.next_initialized_bit_lte(bmap.decodedResult, 300);
      assert.equal(result.decodedResult, 100n);
    });

    it("finds bit across word boundary with gte", async () => {
      const bmap = await bm.flip_bit(EMPTY, 300);
      const result = await bm.next_initialized_bit_gte(bmap.decodedResult, 100);
      assert.equal(result.decodedResult, 300n);
    });

    it("double flip at position 500 returns to empty", async () => {
      const first = await bm.flip_bit(EMPTY, 500);
      const second = await bm.flip_bit(first.decodedResult, 500);
      assert.equal(second.decodedResult.size, 0);
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
