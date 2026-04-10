import { utils } from "@aeternity/aeproject";
import * as chai from "chai";
import { assert } from "chai";
import chaiAsPromised from "chai-as-promised";
import { before, describe, it } from "mocha";
import { deployDexConfig } from "./shared/fixtures.js";
import { expectRevert, FEE_RATE_DENOMINATOR } from "./shared/utils.js";

chai.use(chaiAsPromised);

describe("DexConfig", () => {
  let aeSdk;
  let config;
  let admin;
  let otherAccount;

  before(async () => {
    aeSdk = utils.getSdk();
    admin = utils.getDefaultAccounts()[0];
    otherAccount = utils.getDefaultAccounts()[1];
    config = await deployDexConfig(aeSdk);
  });

  describe("initialization", () => {
    it("sets deployer as admin", async () => {
      const result = await config.admin();
      assert.equal(result.decodedResult, admin.address);
    });

    it("sets deployer as protocol_owner", async () => {
      const result = await config.protocol_owner();
      assert.equal(result.decodedResult, admin.address);
    });

    it("sets deployer as fund_owner", async () => {
      const result = await config.fund_owner();
      assert.equal(result.decodedResult, admin.address);
    });

    it("starts with next_index = 0", async () => {
      const result = await config.next_index();
      assert.equal(result.decodedResult, 0n);
    });
  });

  describe("create_amm_config", () => {
    it("creates a config with valid params", async () => {
      const result = await config.create_amm_config(
        3000,  // trade_fee_rate
        200000, // protocol_fee_rate
        100000, // fund_fee_rate
        1000,  // creator_fee_rate
        0,     // create_pool_fee
        60     // tick_spacing
      );
      assert.equal(result.decodedResult, 0n);

      const cfg = await config.get_config(0);
      assert.equal(cfg.decodedResult.index, 0n);
      assert.equal(cfg.decodedResult.trade_fee_rate, 3000n);
      assert.equal(cfg.decodedResult.protocol_fee_rate, 200000n);
      assert.equal(cfg.decodedResult.fund_fee_rate, 100000n);
      assert.equal(cfg.decodedResult.creator_fee_rate, 1000n);
      assert.equal(cfg.decodedResult.create_pool_fee, 0n);
      assert.equal(cfg.decodedResult.tick_spacing, 60n);
      assert.equal(cfg.decodedResult.disabled, false);
    });

    it("increments next_index after creation", async () => {
      const idx = await config.next_index();
      const prevIndex = idx.decodedResult;

      await config.create_amm_config(5000, 100000, 50000, 2000, 0, 10);

      const newIdx = await config.next_index();
      assert.equal(newIdx.decodedResult, prevIndex + 1n);
    });

    it("emits ConfigCreated event", async () => {
      const result = await config.create_amm_config(
        10000, 300000, 200000, 5000, 0, 200
      );
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "ConfigCreated");
    });

    it("reverts when trade + creator fee >= FEE_RATE_DENOMINATOR", async () => {
      await expectRevert(
        config.create_amm_config(999999, 0, 0, 1, 0, 10),
        "FEE_TOO_HIGH"
      );
    });

    it("reverts when protocol_fee_rate > FEE_RATE_DENOMINATOR", async () => {
      await expectRevert(
        config.create_amm_config(1000, 1000001, 0, 0, 0, 10),
        "PROTOCOL_FEE_TOO_HIGH"
      );
    });

    it("reverts when fund_fee_rate > FEE_RATE_DENOMINATOR", async () => {
      await expectRevert(
        config.create_amm_config(1000, 0, 1000001, 0, 0, 10),
        "FUND_FEE_TOO_HIGH"
      );
    });

    it("reverts when protocol + fund > FEE_RATE_DENOMINATOR", async () => {
      await expectRevert(
        config.create_amm_config(1000, 500001, 500001, 0, 0, 10),
        "COMBINED_FEE_TOO_HIGH"
      );
    });

    it("reverts when called by non-admin", async () => {
      await expectRevert(
        config.create_amm_config(3000, 200000, 100000, 1000, 0, 60, {
          onAccount: otherAccount,
        }),
        "UNAUTHORIZED"
      );
    });
  });

  describe("update_amm_config", () => {
    let cfgIndex;

    before(async () => {
      const result = await config.create_amm_config(
        3000, 200000, 100000, 1000, 0, 60
      );
      cfgIndex = Number(result.decodedResult);
    });

    it("updates trade_fee_rate (param 0)", async () => {
      await config.update_amm_config(cfgIndex, 0, 5000);
      const cfg = await config.get_config(cfgIndex);
      assert.equal(cfg.decodedResult.trade_fee_rate, 5000n);
    });

    it("updates protocol_fee_rate (param 1)", async () => {
      await config.update_amm_config(cfgIndex, 1, 300000);
      const cfg = await config.get_config(cfgIndex);
      assert.equal(cfg.decodedResult.protocol_fee_rate, 300000n);
    });

    it("updates fund_fee_rate (param 2)", async () => {
      await config.update_amm_config(cfgIndex, 2, 150000);
      const cfg = await config.get_config(cfgIndex);
      assert.equal(cfg.decodedResult.fund_fee_rate, 150000n);
    });

    it("updates creator_fee_rate (param 3)", async () => {
      await config.update_amm_config(cfgIndex, 3, 2000);
      const cfg = await config.get_config(cfgIndex);
      assert.equal(cfg.decodedResult.creator_fee_rate, 2000n);
    });

    it("updates create_pool_fee (param 4)", async () => {
      await config.update_amm_config(cfgIndex, 4, 500);
      const cfg = await config.get_config(cfgIndex);
      assert.equal(cfg.decodedResult.create_pool_fee, 500n);
    });

    it("updates tick_spacing (param 5)", async () => {
      await config.update_amm_config(cfgIndex, 5, 120);
      const cfg = await config.get_config(cfgIndex);
      assert.equal(cfg.decodedResult.tick_spacing, 120n);
    });

    it("updates disabled flag (param 6)", async () => {
      await config.update_amm_config(cfgIndex, 6, 1);
      const cfg = await config.get_config(cfgIndex);
      assert.equal(cfg.decodedResult.disabled, true);

      await config.update_amm_config(cfgIndex, 6, 0);
      const cfg2 = await config.get_config(cfgIndex);
      assert.equal(cfg2.decodedResult.disabled, false);
    });

    it("emits ConfigUpdated event", async () => {
      const result = await config.update_amm_config(cfgIndex, 0, 4000);
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "ConfigUpdated");
    });

    it("reverts with invalid param index", async () => {
      await expectRevert(
        config.update_amm_config(cfgIndex, 7, 100),
        "INVALID_PARAM"
      );
    });

    it("reverts when fee validation fails after update", async () => {
      await expectRevert(
        config.update_amm_config(cfgIndex, 0, 999999),
        "FEE_TOO_HIGH"
      );
    });

    it("reverts when called by non-admin", async () => {
      await expectRevert(
        config.update_amm_config(cfgIndex, 0, 5000, {
          onAccount: otherAccount,
        }),
        "UNAUTHORIZED"
      );
    });

    it("reverts for non-existent config index", async () => {
      await expectRevert(
        config.update_amm_config(9999, 0, 5000),
        "CONFIG_NOT_FOUND"
      );
    });
  });

  describe("get_config", () => {
    it("returns correct config for existing index", async () => {
      const cfg = await config.get_config(0);
      assert.isDefined(cfg.decodedResult);
      assert.equal(cfg.decodedResult.index, 0n);
    });

    it("reverts for non-existent index", async () => {
      await expectRevert(config.get_config(9999), "CONFIG_NOT_FOUND");
    });
  });

  describe("all_configs", () => {
    it("returns all configs as a map", async () => {
      const result = await config.all_configs();
      const configs = result.decodedResult;
      assert.isTrue(configs instanceof Map);
      assert.isTrue(configs.size > 0);
    });
  });

  describe("set_protocol_owner", () => {
    it("changes protocol owner", async () => {
      await config.set_protocol_owner(otherAccount.address);
      const result = await config.protocol_owner();
      assert.equal(result.decodedResult, otherAccount.address);
    });

    it("emits ProtocolOwnerChanged event", async () => {
      const result = await config.set_protocol_owner(admin.address);
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "ProtocolOwnerChanged");
    });

    it("reverts when called by non-admin", async () => {
      await expectRevert(
        config.set_protocol_owner(otherAccount.address, {
          onAccount: otherAccount,
        }),
        "UNAUTHORIZED"
      );
    });
  });

  describe("set_fund_owner", () => {
    it("changes fund owner", async () => {
      await config.set_fund_owner(otherAccount.address);
      const result = await config.fund_owner();
      assert.equal(result.decodedResult, otherAccount.address);
    });

    it("emits FundOwnerChanged event", async () => {
      const result = await config.set_fund_owner(admin.address);
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "FundOwnerChanged");
    });

    it("reverts when called by non-admin", async () => {
      await expectRevert(
        config.set_fund_owner(otherAccount.address, {
          onAccount: otherAccount,
        }),
        "UNAUTHORIZED"
      );
    });
  });

  describe("set_admin", () => {
    it("transfers admin role", async () => {
      const freshConfig = await deployDexConfig(aeSdk);

      await freshConfig.set_admin(otherAccount.address);
      const result = await freshConfig.admin();
      assert.equal(result.decodedResult, otherAccount.address);
    });

    it("old admin loses access after transfer", async () => {
      const freshConfig = await deployDexConfig(aeSdk);

      await freshConfig.set_admin(otherAccount.address);

      await expectRevert(
        freshConfig.set_admin(admin.address),
        "UNAUTHORIZED"
      );
    });

    it("new admin can perform admin actions", async () => {
      const freshConfig = await deployDexConfig(aeSdk);

      await freshConfig.set_admin(otherAccount.address);

      const result = await freshConfig.create_amm_config(
        3000, 200000, 100000, 1000, 0, 60,
        { onAccount: otherAccount }
      );
      assert.equal(result.decodedResult, 0n);
    });

    it("emits AdminChanged event", async () => {
      const freshConfig = await deployDexConfig(aeSdk);
      const result = await freshConfig.set_admin(otherAccount.address);
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "AdminChanged");
    });
  });
});
