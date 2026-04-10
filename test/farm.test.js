import { utils } from "@aeternity/aeproject";
import { assert } from "chai";
import { before, describe, it } from "mocha";
import { deploySophiaContract, deployToken } from "./shared/fixtures.js";
import { expectRevert } from "./shared/utils.js";

const INITIAL_SUPPLY = 10n ** 24n;
const STAKE_AMOUNT = 10n ** 18n;
const REWARD_RATE = 10n ** 12n;
const END_TIME = 9999999999999n;

describe("Farm", () => {
  let aeSdk;
  let admin, user1, user2;
  let farm, lpToken, rewardToken;
  let farmId;

  before(async () => {
    aeSdk = utils.getSdk();
    const accounts = utils.getDefaultAccounts();
    admin = accounts[0];
    user1 = accounts[1];
    user2 = accounts[2];

    lpToken = await deployToken(aeSdk, "LP Token", "LP", 18, INITIAL_SUPPLY);
    rewardToken = await deployToken(aeSdk, "Reward Token", "RWD", 18, INITIAL_SUPPLY);
    farm = await deploySophiaContract(aeSdk, "./contracts/Farm.aes", []);

    await lpToken.transfer(user1.address, STAKE_AMOUNT * 10n);
    await lpToken.transfer(user2.address, STAKE_AMOUNT * 10n);
  });

  describe("initialization", () => {
    it("sets admin to deployer", async () => {
      const result = await farm.admin();
      assert.equal(result.decodedResult, admin.address);
    });
  });

  describe("create_farm", () => {
    let createResult;

    before(async () => {
      createResult = await farm.create_farm(
        lpToken.$options.address,
        rewardToken.$options.address,
        REWARD_RATE,
        0n,
        END_TIME,
      );
      farmId = Number(createResult.decodedResult);
    });

    it("returns farm id 0 for first farm", () => {
      assert.equal(farmId, 0);
    });

    it("stores correct farm pool data", async () => {
      const f = (await farm.get_farm(farmId)).decodedResult;
      assert.equal(f.lp_token, lpToken.$options.address);
      assert.equal(f.reward_token, rewardToken.$options.address);
      assert.equal(f.reward_per_second, REWARD_RATE);
      assert.equal(f.total_staked, 0n);
    });

    it("emits FarmCreated event", () => {
      const events = createResult.decodedEvents.filter(e => e.name === "FarmCreated");
      assert.lengthOf(events, 1);
    });

    it("increments farm id for second farm", async () => {
      const result = await farm.create_farm(
        lpToken.$options.address,
        rewardToken.$options.address,
        REWARD_RATE,
        0n,
        END_TIME,
      );
      assert.equal(Number(result.decodedResult), 1);
    });

    it("reverts for non-admin caller", async () => {
      await expectRevert(
        farm.create_farm(
          lpToken.$options.address,
          rewardToken.$options.address,
          REWARD_RATE,
          0n,
          END_TIME,
          { onAccount: user1 },
        ),
        "UNAUTHORIZED",
      );
    });

    it("reverts with invalid time range", async () => {
      await expectRevert(
        farm.create_farm(
          lpToken.$options.address,
          rewardToken.$options.address,
          REWARD_RATE,
          1000n,
          500n,
        ),
        "INVALID_TIME_RANGE",
      );
    });

    it("reverts with zero reward rate", async () => {
      await expectRevert(
        farm.create_farm(
          lpToken.$options.address,
          rewardToken.$options.address,
          0n,
          0n,
          END_TIME,
        ),
        "ZERO_REWARD_RATE",
      );
    });
  });

  describe("fund_farm", () => {
    const FUND_AMOUNT = INITIAL_SUPPLY / 2n;
    let fundResult;
    let balBefore;

    before(async () => {
      balBefore = (await rewardToken.balance(farm.$options.address)).decodedResult ?? 0n;
      await rewardToken.create_allowance(farm.$options.address, FUND_AMOUNT);
      fundResult = await farm.fund_farm(farmId, FUND_AMOUNT);
    });

    it("transfers reward tokens to farm", async () => {
      const balAfter = (await rewardToken.balance(farm.$options.address)).decodedResult;
      assert.equal(balAfter - balBefore, FUND_AMOUNT);
    });

    it("emits FarmFunded event", () => {
      const events = fundResult.decodedEvents.filter(e => e.name === "FarmFunded");
      assert.lengthOf(events, 1);
    });

    it("reverts for non-existent farm", async () => {
      await expectRevert(farm.fund_farm(999, 1000n), "FARM_NOT_FOUND");
    });

    it("reverts with zero amount", async () => {
      await expectRevert(farm.fund_farm(farmId, 0n), "ZERO_AMOUNT");
    });
  });

  describe("deposit", () => {
    let depositResult;

    before(async () => {
      await lpToken.create_allowance(farm.$options.address, STAKE_AMOUNT, { onAccount: user1 });
      depositResult = await farm.deposit(farmId, STAKE_AMOUNT, { onAccount: user1 });
    });

    it("updates user staked amount", async () => {
      const ui = (await farm.get_user_info(farmId, user1.address)).decodedResult;
      assert.equal(ui.staked_amount, STAKE_AMOUNT);
    });

    it("updates total_staked in farm pool", async () => {
      const f = (await farm.get_farm(farmId)).decodedResult;
      assert.equal(f.total_staked, STAKE_AMOUNT);
    });

    it("emits Deposited event", () => {
      const events = depositResult.decodedEvents.filter(e => e.name === "Deposited");
      assert.lengthOf(events, 1);
    });

    it("reverts for non-existent farm", async () => {
      await expectRevert(
        farm.deposit(999, STAKE_AMOUNT, { onAccount: user1 }),
        "FARM_NOT_FOUND",
      );
    });

    it("reverts with zero amount", async () => {
      await expectRevert(
        farm.deposit(farmId, 0n, { onAccount: user1 }),
        "ZERO_AMOUNT",
      );
    });
  });

  describe("pending_reward", () => {
    it("returns 0 for non-staker", async () => {
      const pending = (await farm.pending_reward(farmId, user2.address)).decodedResult;
      assert.equal(pending, 0n);
    });

    it("returns positive amount for staker", async () => {
      const pending = (await farm.pending_reward(farmId, user1.address)).decodedResult;
      assert.isTrue(pending > 0n);
    });

    it("reverts for non-existent farm", async () => {
      await expectRevert(farm.pending_reward(999, admin.address), "FARM_NOT_FOUND");
    });
  });

  describe("claim", () => {
    let claimResult;
    let rewardBalBefore;

    before(async () => {
      rewardBalBefore = (await rewardToken.balance(user1.address)).decodedResult ?? 0n;
      claimResult = await farm.claim(farmId, { onAccount: user1 });
    });

    it("transfers reward tokens to user", async () => {
      const rewardBalAfter = (await rewardToken.balance(user1.address)).decodedResult;
      assert.isTrue(rewardBalAfter > rewardBalBefore);
    });

    it("returns positive claimed amount", () => {
      assert.isTrue(claimResult.decodedResult > 0n);
    });

    it("emits RewardClaimed event", () => {
      const events = claimResult.decodedEvents.filter(e => e.name === "RewardClaimed");
      assert.lengthOf(events, 1);
    });

    it("reverts for user with no stake", async () => {
      await expectRevert(
        farm.claim(farmId, { onAccount: user2 }),
        "NO_STAKE",
      );
    });

    it("reverts for non-existent farm", async () => {
      await expectRevert(farm.claim(999, { onAccount: user1 }), "FARM_NOT_FOUND");
    });
  });

  describe("withdraw", () => {
    let withdrawResult;
    let lpBalBefore, rewardBalBefore;
    const withdrawAmount = STAKE_AMOUNT / 2n;

    before(async () => {
      lpBalBefore = (await lpToken.balance(user1.address)).decodedResult;
      rewardBalBefore = (await rewardToken.balance(user1.address)).decodedResult ?? 0n;
      withdrawResult = await farm.withdraw(farmId, withdrawAmount, { onAccount: user1 });
    });

    it("returns LP tokens to user", async () => {
      const lpBalAfter = (await lpToken.balance(user1.address)).decodedResult;
      assert.equal(lpBalAfter - lpBalBefore, withdrawAmount);
    });

    it("decreases total_staked", async () => {
      const f = (await farm.get_farm(farmId)).decodedResult;
      assert.equal(f.total_staked, STAKE_AMOUNT - withdrawAmount);
    });

    it("updates user staked amount", async () => {
      const ui = (await farm.get_user_info(farmId, user1.address)).decodedResult;
      assert.equal(ui.staked_amount, STAKE_AMOUNT - withdrawAmount);
    });

    it("auto-claims pending rewards", async () => {
      const rewardBalAfter = (await rewardToken.balance(user1.address)).decodedResult ?? 0n;
      assert.isTrue(rewardBalAfter > rewardBalBefore);
    });

    it("emits Withdrawn event", () => {
      const events = withdrawResult.decodedEvents.filter(e => e.name === "Withdrawn");
      assert.lengthOf(events, 1);
    });

    it("emits RewardClaimed on withdraw", () => {
      const events = withdrawResult.decodedEvents.filter(e => e.name === "RewardClaimed");
      assert.isTrue(events.length >= 1);
    });

    it("reverts with insufficient stake", async () => {
      await expectRevert(
        farm.withdraw(farmId, STAKE_AMOUNT * 100n, { onAccount: user1 }),
        "INSUFFICIENT_STAKE",
      );
    });

    it("reverts with zero amount", async () => {
      await expectRevert(
        farm.withdraw(farmId, 0n, { onAccount: user1 }),
        "ZERO_AMOUNT",
      );
    });
  });

  describe("multiple stakers", () => {
    before(async () => {
      const ui = (await farm.get_user_info(farmId, user1.address)).decodedResult;
      if (ui.staked_amount > 0n) {
        await farm.withdraw(farmId, ui.staked_amount, { onAccount: user1 });
      }

      await lpToken.create_allowance(farm.$options.address, STAKE_AMOUNT, { onAccount: user1 });
      await farm.deposit(farmId, STAKE_AMOUNT, { onAccount: user1 });

      await lpToken.create_allowance(farm.$options.address, STAKE_AMOUNT, { onAccount: user2 });
      await farm.deposit(farmId, STAKE_AMOUNT, { onAccount: user2 });
    });

    it("total_staked reflects both deposits", async () => {
      const f = (await farm.get_farm(farmId)).decodedResult;
      assert.equal(f.total_staked, STAKE_AMOUNT * 2n);
    });

    it("both stakers accumulate rewards", async () => {
      const p1 = (await farm.pending_reward(farmId, user1.address)).decodedResult;
      const p2 = (await farm.pending_reward(farmId, user2.address)).decodedResult;
      assert.isTrue(p1 > 0n);
      assert.isTrue(p2 > 0n);
    });

    it("earlier staker earns at least as much", async () => {
      const p1 = (await farm.pending_reward(farmId, user1.address)).decodedResult;
      const p2 = (await farm.pending_reward(farmId, user2.address)).decodedResult;
      assert.isTrue(p1 >= p2);
    });
  });

  describe("edge cases", () => {
    it("get_farm reverts for non-existent farm", async () => {
      await expectRevert(farm.get_farm(999), "FARM_NOT_FOUND");
    });

    it("returns default user_info for unknown user", async () => {
      const ui = (await farm.get_user_info(farmId, admin.address)).decodedResult;
      assert.equal(ui.staked_amount, 0n);
      assert.equal(ui.reward_debt, 0n);
    });
  });
});
