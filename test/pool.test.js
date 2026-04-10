import { utils } from "@aeternity/aeproject";
import * as chai from "chai";
import { assert } from "chai";
import chaiAsPromised from "chai-as-promised";
import { before, describe, it } from "mocha";
import { deploySophiaContract, deployToken, deployDexConfig } from "./shared/fixtures.js";
import { expectRevert, Q64 } from "./shared/utils.js";

chai.use(chaiAsPromised);

const TRADE_FEE_RATE = 2500;
const PROTOCOL_FEE_RATE = 120000;
const FUND_FEE_RATE = 40000;
const TICK_SPACING = 10;
const INITIAL_SUPPLY = 10n ** 24n;
const LIQ = 1_000_000_000n;
const SWAP_AMOUNT = 10_000_000n;
const MAX_AMOUNT = 10n ** 20n;

const MIN_SQRT_PRICE = 4295048016n;
const MAX_SQRT_PRICE = 79226673521066979257578248091n;

describe("Pool", () => {
  let aeSdk;
  let admin, otherAccount;
  let dexConfig, configIndex;
  let token0, token1, pool;
  let posId;

  before(async () => {
    aeSdk = utils.getSdk();
    const accounts = utils.getDefaultAccounts();
    admin = accounts[0];
    otherAccount = accounts[1];

    dexConfig = await deployDexConfig(aeSdk);
    const cfgResult = await dexConfig.create_amm_config(
      TRADE_FEE_RATE, PROTOCOL_FEE_RATE, FUND_FEE_RATE, 0, 0, TICK_SPACING,
    );
    configIndex = Number(cfgResult.decodedResult);

    const tokenA = await deployToken(aeSdk, "TokenA", "TKA", 18, INITIAL_SUPPLY);
    const tokenB = await deployToken(aeSdk, "TokenB", "TKB", 18, INITIAL_SUPPLY);

    if (tokenA.$options.address < tokenB.$options.address) {
      token0 = tokenA;
      token1 = tokenB;
    } else {
      token0 = tokenB;
      token1 = tokenA;
    }

    pool = await deploySophiaContract(aeSdk, "./contracts/clmm/Pool.aes", [
      dexConfig.$options.address,
      configIndex,
      token0.$options.address,
      token1.$options.address,
      TICK_SPACING,
      Q64,
      admin.address,
      0,
    ]);

    await token0.create_allowance(pool.$options.address, INITIAL_SUPPLY);
    await token1.create_allowance(pool.$options.address, INITIAL_SUPPLY);
  });

  describe("initialization", () => {
    it("has correct initial sqrt_price equal to Q64", async () => {
      const result = await pool.sqrt_price_x64();
      assert.equal(result.decodedResult, Q64);
    });

    it("has initial tick equal to 0", async () => {
      const result = await pool.tick_current();
      assert.equal(result.decodedResult, 0n);
    });

    it("has zero initial liquidity", async () => {
      const result = await pool.liquidity();
      assert.equal(result.decodedResult, 0n);
    });

    it("has correct token addresses", async () => {
      const t0 = await pool.token_0();
      const t1 = await pool.token_1();
      assert.equal(t0.decodedResult, token0.$options.address);
      assert.equal(t1.decodedResult, token1.$options.address);
    });

    it("has status 0 (all enabled)", async () => {
      const result = await pool.get_status();
      assert.equal(result.decodedResult, 0n);
    });

    it("has zero fee growth globals", async () => {
      const fg0 = await pool.fee_growth_global_0();
      const fg1 = await pool.fee_growth_global_1();
      assert.equal(fg0.decodedResult, 0n);
      assert.equal(fg1.decodedResult, 0n);
    });
  });

  describe("open_position", () => {
    let openResult;
    let balBefore0, balBefore1;

    before(async () => {
      balBefore0 = (await token0.balance(admin.address)).decodedResult;
      balBefore1 = (await token1.balance(admin.address)).decodedResult;
      openResult = await pool.open_position(-100, 100, LIQ, MAX_AMOUNT, MAX_AMOUNT);
      posId = openResult.decodedResult;
    });

    it("returns position id 0", () => {
      assert.equal(posId, 0n);
    });

    it("sets pool active liquidity", async () => {
      const liq = await pool.liquidity();
      assert.equal(liq.decodedResult, LIQ);
    });

    it("creates position with correct fields", async () => {
      const pos = (await pool.get_position(0)).decodedResult;
      assert.equal(pos.owner, admin.address);
      assert.equal(pos.tick_lower, -100n);
      assert.equal(pos.tick_upper, 100n);
      assert.equal(pos.liquidity, LIQ);
    });

    it("transfers tokens from user to pool", async () => {
      const balAfter0 = (await token0.balance(admin.address)).decodedResult;
      const balAfter1 = (await token1.balance(admin.address)).decodedResult;
      assert.isTrue(balAfter0 < balBefore0);
      assert.isTrue(balAfter1 < balBefore1);

      const poolBal0 = (await token0.balance(pool.$options.address)).decodedResult;
      const poolBal1 = (await token1.balance(pool.$options.address)).decodedResult;
      assert.isTrue(poolBal0 > 0n);
      assert.isTrue(poolBal1 > 0n);
    });

    it("emits PositionOpened event", () => {
      const events = openResult.decodedEvents.filter(e => e.name === "PositionOpened");
      assert.lengthOf(events, 1);
    });
  });

  describe("open_position validation", () => {
    it("reverts with invalid tick range (lower >= upper)", async () => {
      await expectRevert(
        pool.open_position(100, -100, LIQ, MAX_AMOUNT, MAX_AMOUNT),
        "INVALID_TICK_RANGE",
      );
    });

    it("reverts with ticks not aligned to spacing", async () => {
      await expectRevert(
        pool.open_position(-15, 100, LIQ, MAX_AMOUNT, MAX_AMOUNT),
        "TICK_LOWER_NOT_ALIGNED",
      );
    });

    it("reverts with zero liquidity", async () => {
      await expectRevert(
        pool.open_position(-100, 100, 0, MAX_AMOUNT, MAX_AMOUNT),
        "ZERO_LIQUIDITY",
      );
    });

    it("reverts when amount exceeds max", async () => {
      await expectRevert(
        pool.open_position(-100, 100, LIQ, 0, 0),
        "AMOUNT_0_EXCEEDED",
      );
    });
  });

  describe("increase_liquidity", () => {
    let increaseResult;

    before(async () => {
      increaseResult = await pool.increase_liquidity(0, LIQ, MAX_AMOUNT, MAX_AMOUNT);
    });

    it("doubles position liquidity", async () => {
      const pos = (await pool.get_position(0)).decodedResult;
      assert.equal(pos.liquidity, LIQ * 2n);
    });

    it("doubles pool active liquidity", async () => {
      const liq = await pool.liquidity();
      assert.equal(liq.decodedResult, LIQ * 2n);
    });

    it("returns amounts transferred", () => {
      const [a0, a1] = increaseResult.decodedResult;
      assert.isTrue(a0 > 0n);
      assert.isTrue(a1 > 0n);
    });

    it("emits IncreaseLiquidity event", () => {
      const events = increaseResult.decodedEvents.filter(e => e.name === "IncreaseLiquidity");
      assert.lengthOf(events, 1);
    });
  });

  describe("swap zero_for_one", () => {
    let swapResult;
    let priceBefore;

    before(async () => {
      priceBefore = (await pool.sqrt_price_x64()).decodedResult;
      swapResult = await pool.swap(true, SWAP_AMOUNT, MIN_SQRT_PRICE);
    });

    it("moves price down", async () => {
      const priceAfter = (await pool.sqrt_price_x64()).decodedResult;
      assert.isTrue(priceAfter < priceBefore);
    });

    it("returns positive amounts for both tokens", () => {
      const [a0, a1] = swapResult.decodedResult;
      assert.isTrue(a0 > 0n);
      assert.isTrue(a1 > 0n);
    });

    it("updates tick current to negative", async () => {
      const tick = (await pool.tick_current()).decodedResult;
      assert.isTrue(tick < 0n);
    });

    it("accrues fee growth for token0", async () => {
      const fg0 = (await pool.fee_growth_global_0()).decodedResult;
      assert.isTrue(fg0 > 0n);
    });

    it("emits Swap event", () => {
      const events = swapResult.decodedEvents.filter(e => e.name === "Swap");
      assert.lengthOf(events, 1);
    });
  });

  describe("swap one_for_zero", () => {
    let swapResult;
    let priceBefore;

    before(async () => {
      priceBefore = (await pool.sqrt_price_x64()).decodedResult;
      swapResult = await pool.swap(false, SWAP_AMOUNT, MAX_SQRT_PRICE);
    });

    it("moves price up", async () => {
      const priceAfter = (await pool.sqrt_price_x64()).decodedResult;
      assert.isTrue(priceAfter > priceBefore);
    });

    it("returns positive amounts for both tokens", () => {
      const [a0, a1] = swapResult.decodedResult;
      assert.isTrue(a0 > 0n);
      assert.isTrue(a1 > 0n);
    });

    it("accrues fee growth for token1", async () => {
      const fg1 = (await pool.fee_growth_global_1()).decodedResult;
      assert.isTrue(fg1 > 0n);
    });
  });

  describe("swap validation", () => {
    it("reverts when limit is above current for zero_for_one", async () => {
      const price = (await pool.sqrt_price_x64()).decodedResult;
      await expectRevert(
        pool.swap(true, SWAP_AMOUNT, price + 1n),
        "LIMIT_TOO_HIGH",
      );
    });

    it("reverts when limit is below current for one_for_zero", async () => {
      const price = (await pool.sqrt_price_x64()).decodedResult;
      await expectRevert(
        pool.swap(false, SWAP_AMOUNT, price - 1n),
        "LIMIT_TOO_LOW",
      );
    });

    it("reverts with zero amount", async () => {
      await expectRevert(
        pool.swap(true, 0, MIN_SQRT_PRICE),
        "ZERO_AMOUNT",
      );
    });
  });

  describe("collect_fees", () => {
    it("collects accrued trading fees for position", async () => {
      const result = await pool.collect_fees(0, MAX_AMOUNT, MAX_AMOUNT);
      const [f0, f1] = result.decodedResult;
      assert.isTrue(f0 > 0n || f1 > 0n);
    });

    it("emits CollectFee event", async () => {
      const result = await pool.collect_fees(0, MAX_AMOUNT, MAX_AMOUNT);
      const events = result.decodedEvents.filter(e => e.name === "CollectFee");
      assert.lengthOf(events, 1);
    });
  });

  describe("collect_protocol_fee", () => {
    it("protocol owner can collect accumulated fees", async () => {
      const result = await pool.collect_protocol_fee(MAX_AMOUNT, MAX_AMOUNT);
      const events = result.decodedEvents.filter(e => e.name === "CollectProtocolFee");
      assert.lengthOf(events, 1);
    });
  });

  describe("collect_fund_fee", () => {
    it("fund owner can collect accumulated fees", async () => {
      const result = await pool.collect_fund_fee(MAX_AMOUNT, MAX_AMOUNT);
      const events = result.decodedEvents.filter(e => e.name === "CollectFundFee");
      assert.lengthOf(events, 1);
    });
  });

  describe("decrease_liquidity", () => {
    let decreaseResult;

    before(async () => {
      decreaseResult = await pool.decrease_liquidity(0, LIQ, 0, 0);
    });

    it("decreases position liquidity by delta", async () => {
      const pos = (await pool.get_position(0)).decodedResult;
      assert.equal(pos.liquidity, LIQ);
    });

    it("decreases pool active liquidity", async () => {
      const liq = await pool.liquidity();
      assert.equal(liq.decodedResult, LIQ);
    });

    it("accrues tokens owed in position", async () => {
      const pos = (await pool.get_position(0)).decodedResult;
      assert.isTrue(pos.tokens_owed_0 > 0n || pos.tokens_owed_1 > 0n);
    });

    it("emits DecreaseLiquidity event", () => {
      const events = decreaseResult.decodedEvents.filter(e => e.name === "DecreaseLiquidity");
      assert.lengthOf(events, 1);
    });
  });

  describe("close_position", () => {
    let secondPosId;

    before(async () => {
      const result = await pool.open_position(-200, 200, LIQ / 2n, MAX_AMOUNT, MAX_AMOUNT);
      secondPosId = Number(result.decodedResult);
    });

    it("unauthorized user cannot close another's position", async () => {
      await expectRevert(
        pool.close_position(secondPosId, { onAccount: otherAccount }),
        "UNAUTHORIZED",
      );
    });

    it("owner can close and position is deleted", async () => {
      const result = await pool.close_position(secondPosId);
      const events = result.decodedEvents.filter(e => e.name === "PositionClosed");
      assert.lengthOf(events, 1);

      await expectRevert(
        pool.get_position(secondPosId),
        "POSITION_NOT_FOUND",
      );
    });
  });

  describe("update_pool_status", () => {
    it("admin can change pool status", async () => {
      const result = await pool.update_pool_status(4);
      const events = result.decodedEvents.filter(e => e.name === "UpdatePoolStatus");
      assert.lengthOf(events, 1);

      const status = (await pool.get_status()).decodedResult;
      assert.equal(status, 4n);
    });

    it("swap is disabled when status bit 2 is set", async () => {
      await expectRevert(
        pool.swap(true, SWAP_AMOUNT, MIN_SQRT_PRICE),
        "SWAP_DISABLED",
      );
    });

    it("position open is disabled when status bit 0 is set", async () => {
      await pool.update_pool_status(1);
      await expectRevert(
        pool.open_position(-100, 100, LIQ, MAX_AMOUNT, MAX_AMOUNT),
        "POSITION_DISABLED",
      );
    });

    it("re-enable all operations by setting status to 0", async () => {
      await pool.update_pool_status(0);
      const status = (await pool.get_status()).decodedResult;
      assert.equal(status, 0n);
    });
  });

  describe("multiple positions at different ranges", () => {
    it("can open position above current price (token0 only)", async () => {
      const result = await pool.open_position(100, 200, LIQ / 2n, MAX_AMOUNT, MAX_AMOUNT);
      const newPosId = Number(result.decodedResult);
      const pos = (await pool.get_position(newPosId)).decodedResult;
      assert.equal(pos.tick_lower, 100n);
      assert.equal(pos.tick_upper, 200n);
      assert.equal(pos.liquidity, LIQ / 2n);
    });

    it("can open position below current price (token1 only)", async () => {
      const result = await pool.open_position(-200, -100, LIQ / 2n, MAX_AMOUNT, MAX_AMOUNT);
      const newPosId = Number(result.decodedResult);
      const pos = (await pool.get_position(newPosId)).decodedResult;
      assert.equal(pos.tick_lower, -200n);
      assert.equal(pos.tick_upper, -100n);
    });

    it("swap still works with multiple positions providing liquidity", async () => {
      const result = await pool.swap(true, SWAP_AMOUNT / 2n, MIN_SQRT_PRICE);
      const [a0, a1] = result.decodedResult;
      assert.isTrue(a0 > 0n);
      assert.isTrue(a1 > 0n);
    });
  });

  describe("get_tick", () => {
    it("returns initialized tick data for active ticks", async () => {
      const tickData = (await pool.get_tick(100)).decodedResult;
      assert.isTrue(tickData.initialized);
      assert.isTrue(tickData.liquidity_gross > 0n);
    });

    it("returns default for uninitialized ticks", async () => {
      const tickData = (await pool.get_tick(50)).decodedResult;
      assert.isFalse(tickData.initialized);
      assert.equal(tickData.liquidity_gross, 0n);
    });
  });
});
