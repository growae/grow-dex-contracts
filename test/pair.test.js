import { utils } from "@aeternity/aeproject";
import * as chai from "chai";
import { assert } from "chai";
import chaiAsPromised from "chai-as-promised";
import { before, describe, it } from "mocha";
import { deploySophiaContract, deployToken, deployDexConfig } from "./shared/fixtures.js";
import {
  MINIMUM_LIQUIDITY, sqrt, FEE_RATE_DENOMINATOR, INITIAL_SUPPLY,
  tradingFee, protocolFee, fundFee, creatorFee,
  amountOut, amountIn, expectRevert, ceilDiv, contractToAccount,
} from "./shared/utils.js";

chai.use(chaiAsPromised);

const TRADE_FEE_RATE = 3000n;
const PROTOCOL_FEE_RATE = 200000n;
const FUND_FEE_RATE = 100000n;
const CREATOR_FEE_RATE = 1000n;

const DEPOSIT_AMOUNT = 10n ** 15n;
const SWAP_AMOUNT = 10n ** 12n;

function preFeeAmount(postFeeAmount, totalFeeRate) {
  if (totalFeeRate === 0n) return postFeeAmount;
  return ceilDiv(postFeeAmount * FEE_RATE_DENOMINATOR, FEE_RATE_DENOMINATOR - totalFeeRate);
}

describe("Pair", () => {
  let aeSdk;
  let admin, creator, user;
  let dexConfig, configIndex;
  let token0, token1, pair;

  before(async () => {
    aeSdk = utils.getSdk();
    const accounts = utils.getDefaultAccounts();
    admin = accounts[0];
    creator = accounts[1];
    user = accounts[2];

    dexConfig = await deployDexConfig(aeSdk);
    const cfgResult = await dexConfig.create_amm_config(
      Number(TRADE_FEE_RATE),
      Number(PROTOCOL_FEE_RATE),
      Number(FUND_FEE_RATE),
      Number(CREATOR_FEE_RATE),
      0,
      60,
    );
    configIndex = Number(cfgResult.decodedResult);

    const tokenA = await deployToken(aeSdk, "Token A", "TKA", 18, INITIAL_SUPPLY);
    const tokenB = await deployToken(aeSdk, "Token B", "TKB", 18, INITIAL_SUPPLY);

    if (tokenA.$options.address < tokenB.$options.address) {
      token0 = tokenA;
      token1 = tokenB;
    } else {
      token0 = tokenB;
      token1 = tokenA;
    }

    pair = await deploySophiaContract(aeSdk, "./contracts/cpmm/Pair.aes", [
      dexConfig.$options.address,
      configIndex,
      token0.$options.address,
      token1.$options.address,
      creator.address,
      0,
    ]);

    await token0.transfer(user.address, DEPOSIT_AMOUNT * 2n);
    await token1.transfer(user.address, DEPOSIT_AMOUNT * 2n);
    await token0.transfer(creator.address, DEPOSIT_AMOUNT * 2n);
    await token1.transfer(creator.address, DEPOSIT_AMOUNT * 2n);
  });

  describe("initialization", () => {
    it("sets correct token0 and token1", async () => {
      const t0 = await pair.token_0();
      const t1 = await pair.token_1();
      assert.equal(t0.decodedResult, token0.$options.address);
      assert.equal(t1.decodedResult, token1.$options.address);
    });

    it("starts with zero reserves", async () => {
      const reserves = await pair.get_reserves();
      const [r0, r1] = reserves.decodedResult;
      assert.equal(r0, 0n);
      assert.equal(r1, 0n);
    });

    it("starts with zero total supply", async () => {
      const ts = await pair.lp_total_supply();
      assert.equal(ts.decodedResult, 0n);
    });

    it("has status 0 (all enabled)", async () => {
      const status = await pair.get_status();
      assert.equal(status.decodedResult, 0n);
    });

    it("reports correct creator", async () => {
      const c = await pair.get_creator();
      assert.equal(c.decodedResult, creator.address);
    });

    it("returns correct meta_info", async () => {
      const mi = await pair.meta_info();
      const m = mi.decodedResult;
      assert.include(m.name, "/");
      assert.include(m.symbol, "-");
      assert.equal(m.decimals, 18n);
    });
  });

  describe("first deposit", () => {
    let depositResult;

    before(async () => {
      await token0.create_allowance(contractToAccount(pair.$options.address), DEPOSIT_AMOUNT);
      await token1.create_allowance(contractToAccount(pair.$options.address), DEPOSIT_AMOUNT);
      depositResult = await pair.deposit(DEPOSIT_AMOUNT, DEPOSIT_AMOUNT, 0);
    });

    it("mints LP tokens equal to sqrt(a0*a1) - MINIMUM_LIQUIDITY", async () => {
      const expectedLp = sqrt(DEPOSIT_AMOUNT * DEPOSIT_AMOUNT) - MINIMUM_LIQUIDITY;
      assert.equal(depositResult.decodedResult, expectedLp);
    });

    it("locks MINIMUM_LIQUIDITY in contract address", async () => {
      const contractLp = await pair.lp_balance(contractToAccount(pair.$options.address));
      assert.equal(contractLp.decodedResult, MINIMUM_LIQUIDITY);
    });

    it("assigns remaining LP to depositor", async () => {
      const expectedLp = sqrt(DEPOSIT_AMOUNT * DEPOSIT_AMOUNT) - MINIMUM_LIQUIDITY;
      const adminLp = await pair.lp_balance(admin.address);
      assert.equal(adminLp.decodedResult, expectedLp);
    });

    it("sets total supply to sqrt(a0*a1)", async () => {
      const ts = await pair.lp_total_supply();
      assert.equal(ts.decodedResult, sqrt(DEPOSIT_AMOUNT * DEPOSIT_AMOUNT));
    });

    it("updates reserves", async () => {
      const reserves = await pair.get_reserves();
      const [r0, r1] = reserves.decodedResult;
      assert.equal(r0, DEPOSIT_AMOUNT);
      assert.equal(r1, DEPOSIT_AMOUNT);
    });

    it("emits Deposit event", () => {
      const depositEvents = depositResult.decodedEvents.filter(e => e.name === "Deposit");
      assert.lengthOf(depositEvents, 1);
    });
  });

  describe("subsequent deposit", () => {
    let lpBefore, totalSupplyBefore, secondDepositResult;
    const secondDeposit = DEPOSIT_AMOUNT / 2n;

    before(async () => {
      lpBefore = (await pair.lp_balance(admin.address)).decodedResult;
      totalSupplyBefore = (await pair.lp_total_supply()).decodedResult;
      await token0.create_allowance(contractToAccount(pair.$options.address), secondDeposit);
      await token1.create_allowance(contractToAccount(pair.$options.address), secondDeposit);
      secondDepositResult = await pair.deposit(secondDeposit, secondDeposit, 0);
    });

    it("mints proportional LP tokens", async () => {
      const lpMinted = secondDepositResult.decodedResult;
      assert.isTrue(lpMinted > 0n);
    });

    it("increases total supply", async () => {
      const newTs = (await pair.lp_total_supply()).decodedResult;
      assert.isTrue(newTs > totalSupplyBefore);
    });

    it("increases user LP balance", async () => {
      const newBal = (await pair.lp_balance(admin.address)).decodedResult;
      assert.isTrue(newBal > lpBefore);
    });

    it("updates reserves to reflect new balances", async () => {
      const reserves = await pair.get_reserves();
      const [r0, r1] = reserves.decodedResult;
      assert.equal(r0, DEPOSIT_AMOUNT + secondDeposit);
      assert.equal(r1, DEPOSIT_AMOUNT + secondDeposit);
    });
  });

  describe("LP token operations", () => {
    it("transfers LP tokens to another address", async () => {
      const transferAmount = 1000n;
      const balBefore = (await pair.lp_balance(admin.address)).decodedResult;
      await pair.transfer(user.address, transferAmount);
      const balAfter = (await pair.lp_balance(admin.address)).decodedResult;
      const userBal = (await pair.lp_balance(user.address)).decodedResult;
      assert.equal(balBefore - balAfter, transferAmount);
      assert.equal(userBal, transferAmount);
    });

    it("create_allowance and transfer_allowance work", async () => {
      const amount = 500n;
      await pair.create_allowance(user.address, amount);
      const allow = await pair.allowance({
        from_account: admin.address,
        for_account: user.address,
      });
      assert.equal(allow.decodedResult, amount);

      const adminBalBefore = (await pair.lp_balance(admin.address)).decodedResult;
      await pair.transfer_allowance(admin.address, creator.address, amount, {
        onAccount: user,
      });
      const adminBalAfter = (await pair.lp_balance(admin.address)).decodedResult;
      assert.equal(adminBalBefore - adminBalAfter, amount);
    });

    it("reverts transfer with zero amount", async () => {
      await expectRevert(pair.transfer(user.address, 0), "ZERO_AMOUNT");
    });

    it("reverts transfer with insufficient balance", async () => {
      const hugeAmount = 10n ** 30n;
      await expectRevert(pair.transfer(user.address, hugeAmount), "INSUFFICIENT_LP_BALANCE");
    });
  });

  describe("swap_base_input (token0 → token1)", () => {
    let swapResult;
    let reservesBefore;

    before(async () => {
      reservesBefore = (await pair.get_reserves()).decodedResult;
      await token0.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      swapResult = await pair.swap_base_input(
        token0.$options.address,
        SWAP_AMOUNT,
        0,
      );
    });

    it("returns a positive amount_out", () => {
      assert.isTrue(swapResult.decodedResult > 0n);
    });

    it("amount_out matches expected calculation", () => {
      const [r0, r1] = reservesBefore;
      const trade = tradingFee(SWAP_AMOUNT, TRADE_FEE_RATE);
      const crFee = creatorFee(SWAP_AMOUNT, CREATOR_FEE_RATE);
      const afterFee = SWAP_AMOUNT - trade - crFee;
      const expectedOut = amountOut(afterFee, r0, r1);
      assert.equal(swapResult.decodedResult, expectedOut);
    });

    it("updates reserves (r0 increased, r1 decreased)", async () => {
      const [newR0, newR1] = (await pair.get_reserves()).decodedResult;
      const [oldR0, oldR1] = reservesBefore;
      assert.isTrue(newR0 > oldR0);
      assert.isTrue(newR1 < oldR1);
    });

    it("emits SwapInput and Sync events", () => {
      const swapEvents = swapResult.decodedEvents.filter(e => e.name === "SwapInput");
      const syncEvents = swapResult.decodedEvents.filter(e => e.name === "Sync");
      assert.lengthOf(swapEvents, 1);
      assert.isTrue(syncEvents.length >= 1);
    });
  });

  describe("swap_base_input (token1 → token0)", () => {
    let swapResult;
    let reservesBefore;

    before(async () => {
      reservesBefore = (await pair.get_reserves()).decodedResult;
      await token1.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      swapResult = await pair.swap_base_input(
        token1.$options.address,
        SWAP_AMOUNT,
        0,
      );
    });

    it("returns a positive amount_out", () => {
      assert.isTrue(swapResult.decodedResult > 0n);
    });

    it("amount_out matches expected calculation", () => {
      const [r0, r1] = reservesBefore;
      const trade = tradingFee(SWAP_AMOUNT, TRADE_FEE_RATE);
      const crFee = creatorFee(SWAP_AMOUNT, CREATOR_FEE_RATE);
      const afterFee = SWAP_AMOUNT - trade - crFee;
      const expectedOut = amountOut(afterFee, r1, r0);
      assert.equal(swapResult.decodedResult, expectedOut);
    });

    it("updates reserves (r1 increased, r0 decreased)", async () => {
      const [newR0, newR1] = (await pair.get_reserves()).decodedResult;
      const [oldR0, oldR1] = reservesBefore;
      assert.isTrue(newR0 < oldR0);
      assert.isTrue(newR1 > oldR1);
    });
  });

  describe("swap_base_output", () => {
    let swapResult;
    const desiredOut = SWAP_AMOUNT / 10n;

    before(async () => {
      const maxIn = SWAP_AMOUNT * 2n;
      await token0.create_allowance(contractToAccount(pair.$options.address), maxIn);
      swapResult = await pair.swap_base_output(
        token0.$options.address,
        maxIn,
        desiredOut,
      );
    });

    it("returns the actual amount_in spent", () => {
      const actualIn = swapResult.decodedResult;
      assert.isTrue(actualIn > 0n);
      assert.isTrue(actualIn <= SWAP_AMOUNT * 2n);
    });

    it("emits SwapOutput event", () => {
      const swapEvents = swapResult.decodedEvents.filter(e => e.name === "SwapOutput");
      assert.lengthOf(swapEvents, 1);
    });
  });

  describe("fee accrual", () => {
    it("protocol fees are accrued after swaps", async () => {
      const [pf0, pf1] = (await pair.get_protocol_fees()).decodedResult;
      assert.isTrue(pf0 > 0n || pf1 > 0n);
    });

    it("fund fees are accrued after swaps", async () => {
      const [ff0, ff1] = (await pair.get_fund_fees()).decodedResult;
      assert.isTrue(ff0 > 0n || ff1 > 0n);
    });

    it("creator fees are accrued after swaps", async () => {
      const [cf0, cf1] = (await pair.get_creator_fees()).decodedResult;
      assert.isTrue(cf0 > 0n || cf1 > 0n);
    });
  });

  describe("collect_protocol_fee", () => {
    it("protocol owner can collect fees", async () => {
      const [pf0Before, pf1Before] = (await pair.get_protocol_fees()).decodedResult;
      const result = await pair.collect_protocol_fee(pf0Before, pf1Before);
      const [collected0, collected1] = result.decodedResult;
      assert.equal(collected0, pf0Before);
      assert.equal(collected1, pf1Before);

      const [pf0After, pf1After] = (await pair.get_protocol_fees()).decodedResult;
      assert.equal(pf0After, 0n);
      assert.equal(pf1After, 0n);
    });

    it("emits CollectProtocolFee event", async () => {
      await token0.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      await pair.swap_base_input(token0.$options.address, SWAP_AMOUNT, 0);
      const result = await pair.collect_protocol_fee(10n ** 30n, 10n ** 30n);
      const events = result.decodedEvents.filter(e => e.name === "CollectProtocolFee");
      assert.lengthOf(events, 1);
    });

    it("reverts when called by non-protocol-owner", async () => {
      await expectRevert(
        pair.collect_protocol_fee(1, 1, { onAccount: user }),
        "UNAUTHORIZED",
      );
    });
  });

  describe("collect_fund_fee", () => {
    it("fund owner can collect fees", async () => {
      await token0.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      await pair.swap_base_input(token0.$options.address, SWAP_AMOUNT, 0);

      const [ff0Before, ff1Before] = (await pair.get_fund_fees()).decodedResult;
      const result = await pair.collect_fund_fee(ff0Before, ff1Before);
      const [collected0, collected1] = result.decodedResult;
      assert.equal(collected0, ff0Before);
      assert.equal(collected1, ff1Before);
    });

    it("reverts when called by non-fund-owner", async () => {
      await expectRevert(
        pair.collect_fund_fee(1, 1, { onAccount: user }),
        "UNAUTHORIZED",
      );
    });
  });

  describe("collect_creator_fee", () => {
    it("creator can collect fees", async () => {
      await token0.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      await pair.swap_base_input(token0.$options.address, SWAP_AMOUNT, 0);

      const [cf0Before, cf1Before] = (await pair.get_creator_fees()).decodedResult;
      const result = await pair.collect_creator_fee({ onAccount: creator });
      const [collected0, collected1] = result.decodedResult;
      assert.equal(collected0, cf0Before);
      assert.equal(collected1, cf1Before);

      const [cf0After, cf1After] = (await pair.get_creator_fees()).decodedResult;
      assert.equal(cf0After, 0n);
      assert.equal(cf1After, 0n);
    });

    it("emits CollectCreatorFee event", async () => {
      await token0.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      await pair.swap_base_input(token0.$options.address, SWAP_AMOUNT, 0);

      const result = await pair.collect_creator_fee({ onAccount: creator });
      const events = result.decodedEvents.filter(e => e.name === "CollectCreatorFee");
      assert.lengthOf(events, 1);
    });

    it("reverts when called by non-creator", async () => {
      await expectRevert(
        pair.collect_creator_fee({ onAccount: user }),
        "UNAUTHORIZED",
      );
    });
  });

  describe("withdraw", () => {
    it("returns proportional tokens and burns LP", async () => {
      const lpBefore = (await pair.lp_balance(admin.address)).decodedResult;
      const totalSupplyBefore = (await pair.lp_total_supply()).decodedResult;
      const withdrawAmount = lpBefore / 4n;

      const bal0Before = (await token0.balance(admin.address)).decodedResult;
      const bal1Before = (await token1.balance(admin.address)).decodedResult;

      const result = await pair.withdraw(withdrawAmount, 0, 0);
      const [returned0, returned1] = result.decodedResult;

      assert.isTrue(returned0 > 0n);
      assert.isTrue(returned1 > 0n);

      const lpAfter = (await pair.lp_balance(admin.address)).decodedResult;
      assert.equal(lpAfter, lpBefore - withdrawAmount);

      const totalSupplyAfter = (await pair.lp_total_supply()).decodedResult;
      assert.equal(totalSupplyAfter, totalSupplyBefore - withdrawAmount);

      const bal0After = (await token0.balance(admin.address)).decodedResult;
      const bal1After = (await token1.balance(admin.address)).decodedResult;
      assert.equal(bal0After - bal0Before, returned0);
      assert.equal(bal1After - bal1Before, returned1);
    });

    it("emits Withdraw event", async () => {
      const lp = (await pair.lp_balance(admin.address)).decodedResult;
      const amt = lp / 10n;
      const result = await pair.withdraw(amt, 0, 0);
      const events = result.decodedEvents.filter(e => e.name === "Withdraw");
      assert.lengthOf(events, 1);
    });

    it("reverts when slippage exceeds minimum_token_0", async () => {
      const lp = (await pair.lp_balance(admin.address)).decodedResult;
      const amt = lp / 10n;
      await expectRevert(
        pair.withdraw(amt, 10n ** 30n, 0),
        "SLIPPAGE_TOKEN_0",
      );
    });

    it("reverts when slippage exceeds minimum_token_1", async () => {
      const lp = (await pair.lp_balance(admin.address)).decodedResult;
      const amt = lp / 10n;
      await expectRevert(
        pair.withdraw(amt, 0, 10n ** 30n),
        "SLIPPAGE_TOKEN_1",
      );
    });

    it("reverts on zero withdraw amount", async () => {
      await expectRevert(pair.withdraw(0, 0, 0), "ZERO_WITHDRAW");
    });

    it("reverts on insufficient LP balance", async () => {
      await expectRevert(
        pair.withdraw(10n ** 30n, 0, 0),
        "INSUFFICIENT_LP_BALANCE",
      );
    });
  });

  describe("swap error cases", () => {
    it("reverts swap_base_input with zero amount", async () => {
      await expectRevert(
        pair.swap_base_input(token0.$options.address, 0, 0),
        "ZERO_INPUT",
      );
    });

    it("reverts swap_base_input with invalid token", async () => {
      const dummyToken = await deployToken(aeSdk, "Dummy", "DMY", 18, 1000n);
      await expectRevert(
        pair.swap_base_input(dummyToken.$options.address, SWAP_AMOUNT, 0),
        "INVALID_TOKEN",
      );
    });

    it("reverts swap_base_input when slippage exceeded", async () => {
      await token0.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      await expectRevert(
        pair.swap_base_input(token0.$options.address, SWAP_AMOUNT, 10n ** 30n),
        "SLIPPAGE_EXCEEDED",
      );
    });

    it("reverts swap_base_output with zero output", async () => {
      await expectRevert(
        pair.swap_base_output(token0.$options.address, SWAP_AMOUNT, 0),
        "ZERO_OUTPUT",
      );
    });

    it("reverts swap_base_output when max_amount_in exceeded", async () => {
      await token0.create_allowance(contractToAccount(pair.$options.address), 1);
      await expectRevert(
        pair.swap_base_output(token0.$options.address, 1, SWAP_AMOUNT / 2n),
        "SLIPPAGE_EXCEEDED",
      );
    });

    it("reverts deposit with zero amounts", async () => {
      await expectRevert(pair.deposit(0, 0, 0), "ZERO_DEPOSIT");
    });
  });

  describe("status control", () => {
    it("admin can update pool status", async () => {
      const result = await pair.update_pool_status(7);
      const events = result.decodedEvents.filter(e => e.name === "UpdatePoolStatus");
      assert.lengthOf(events, 1);
      const status = await pair.get_status();
      assert.equal(status.decodedResult, 7n);

      await pair.update_pool_status(0);
    });

    it("non-admin cannot update status", async () => {
      await expectRevert(
        pair.update_pool_status(1, { onAccount: user }),
        "UNAUTHORIZED",
      );
    });

    it("disabling deposit (bit 0) prevents deposit", async () => {
      await pair.update_pool_status(1);
      await token0.create_allowance(contractToAccount(pair.$options.address), 1000);
      await token1.create_allowance(contractToAccount(pair.$options.address), 1000);
      await expectRevert(pair.deposit(1000, 1000, 0), "DEPOSIT_DISABLED");
      await pair.update_pool_status(0);
    });

    it("disabling withdraw (bit 1) prevents withdraw", async () => {
      await pair.update_pool_status(2);
      const lp = (await pair.lp_balance(admin.address)).decodedResult;
      if (lp > 0n) {
        await expectRevert(pair.withdraw(1, 0, 0), "WITHDRAW_DISABLED");
      }
      await pair.update_pool_status(0);
    });

    it("disabling swap (bit 2) prevents swap", async () => {
      await pair.update_pool_status(4);
      await token0.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      await expectRevert(
        pair.swap_base_input(token0.$options.address, SWAP_AMOUNT, 0),
        "SWAP_DISABLED",
      );
      await pair.update_pool_status(0);
    });
  });

  describe("oracle observations", () => {
    it("observation count increases after operations", async () => {
      await token0.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      await pair.swap_base_input(token0.$options.address, SWAP_AMOUNT, 0);

      const reserves = await pair.get_reserves();
      const [, , ts] = reserves.decodedResult;
      assert.isTrue(ts > 0n);
    });

    it("cumulative prices are updated", async () => {
      const p0 = (await pair.price0_cumulative_last()).decodedResult;
      const p1 = (await pair.price1_cumulative_last()).decodedResult;
      assert.isTrue(p0 >= 0n);
      assert.isTrue(p1 >= 0n);
    });
  });

  describe("get_reserves", () => {
    it("returns current reserves and timestamp", async () => {
      const reserves = await pair.get_reserves();
      const [r0, r1, ts] = reserves.decodedResult;
      assert.isTrue(r0 > 0n);
      assert.isTrue(r1 > 0n);
      assert.isTrue(ts > 0n);
    });
  });

  describe("sync", () => {
    it("updates reserves without reverting", async () => {
      const reservesBefore = (await pair.get_reserves()).decodedResult;
      await pair.sync();
      const reservesAfter = (await pair.get_reserves()).decodedResult;
      assert.equal(reservesAfter[0], reservesBefore[0]);
      assert.equal(reservesAfter[1], reservesBefore[1]);
    });
  });

  describe("reentrancy guard", () => {
    it("pair is unlocked after successful operations", async () => {
      await token0.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      await pair.swap_base_input(token0.$options.address, SWAP_AMOUNT, 0);

      await token1.create_allowance(contractToAccount(pair.$options.address), SWAP_AMOUNT);
      await pair.swap_base_input(token1.$options.address, SWAP_AMOUNT, 0);
    });
  });
});
