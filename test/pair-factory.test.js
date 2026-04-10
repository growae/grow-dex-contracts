import { utils } from "@aeternity/aeproject";
import * as chai from "chai";
import { assert } from "chai";
import chaiAsPromised from "chai-as-promised";
import { before, describe, it } from "mocha";
import { deploySophiaContract, deployToken, deployDexConfig } from "./shared/fixtures.js";
import { expectRevert, INITIAL_SUPPLY, contractToAccount } from "./shared/utils.js";

chai.use(chaiAsPromised);

const TRADE_FEE_RATE = 3000;
const PROTOCOL_FEE_RATE = 200000;
const FUND_FEE_RATE = 100000;
const CREATOR_FEE_RATE = 1000;
const SEED_AMOUNT = 10n ** 12n;

describe("PairFactory", () => {
  let aeSdk;
  let admin, otherAccount;
  let dexConfig, configIndex;
  let pairModel, factory;
  let token0, token1;

  before(async () => {
    aeSdk = utils.getSdk();
    const accounts = utils.getDefaultAccounts();
    admin = accounts[0];
    otherAccount = accounts[1];

    dexConfig = await deployDexConfig(aeSdk);
    const cfgResult = await dexConfig.create_amm_config(
      TRADE_FEE_RATE,
      PROTOCOL_FEE_RATE,
      FUND_FEE_RATE,
      CREATOR_FEE_RATE,
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

    pairModel = await deploySophiaContract(aeSdk, "./contracts/cpmm/Pair.aes", [
      dexConfig.$options.address,
      configIndex,
      token0.$options.address,
      token1.$options.address,
      admin.address,
      0,
    ]);

    factory = await deploySophiaContract(aeSdk, "./contracts/cpmm/PairFactory.aes", [
      dexConfig.$options.address,
      configIndex,
      pairModel.$options.address,
      admin.address,
    ]);
  });

  describe("initialize", () => {
    let createResult;

    before(async () => {
      await token0.create_allowance(contractToAccount(factory.$options.address), SEED_AMOUNT);
      await token1.create_allowance(contractToAccount(factory.$options.address), SEED_AMOUNT);
      createResult = await factory.initialize(
        token0.$options.address,
        token1.$options.address,
        SEED_AMOUNT,
        SEED_AMOUNT,
        0,
        { omitUnknown: true },
      );
    });

    it("returns a valid pair address", () => {
      const pairAddress = createResult.decodedResult;
      assert.isTrue(typeof pairAddress === "string");
      assert.isTrue(pairAddress.startsWith("ct_"));
    });

    it("emits PairCreated event", () => {
      const events = createResult.decodedEvents.filter(e => e.name === "PairCreated");
      assert.lengthOf(events, 1);
    });

    it("transfers tokens to the pair", async () => {
      const pairAddress = contractToAccount(createResult.decodedResult);
      const bal0 = (await token0.balance(pairAddress)).decodedResult;
      const bal1 = (await token1.balance(pairAddress)).decodedResult;
      assert.equal(bal0, SEED_AMOUNT);
      assert.equal(bal1, SEED_AMOUNT);
    });
  });

  describe("get_pair", () => {
    it("returns the pair for existing token combination", async () => {
      const result = await factory.get_pair(
        token0.$options.address,
        token1.$options.address,
      );
      assert.isDefined(result.decodedResult);
    });

    it("returns the pair regardless of token order", async () => {
      const result = await factory.get_pair(
        token1.$options.address,
        token0.$options.address,
      );
      assert.isDefined(result.decodedResult);
    });

    it("returns undefined for non-existent pair", async () => {
      const dummyToken = await deployToken(aeSdk, "Dummy", "DUM", 18, INITIAL_SUPPLY);
      const result = await factory.get_pair(
        token0.$options.address,
        dummyToken.$options.address,
      );
      assert.isUndefined(result.decodedResult);
    });
  });

  describe("pair_count and pagination", () => {
    it("pair_count returns correct count", async () => {
      const result = await factory.pair_count();
      assert.equal(result.decodedResult, 1n);
    });

    it("get_pair_at returns pair by index", async () => {
      const result = await factory.get_pair_at(0);
      assert.isTrue(typeof result.decodedResult === "string");
      assert.isTrue(result.decodedResult.startsWith("ct_"));
    });

    it("get_pair_at reverts on out-of-bounds index", async () => {
      await expectRevert(factory.get_pair_at(999), "INDEX_OUT_OF_BOUNDS");
    });

    it("get_pairs returns paginated list", async () => {
      const result = await factory.get_pairs(0, 10);
      assert.isArray(result.decodedResult);
      assert.lengthOf(result.decodedResult, 1);
    });

    it("get_pairs with offset beyond count returns empty", async () => {
      const result = await factory.get_pairs(100, 10);
      assert.isArray(result.decodedResult);
      assert.lengthOf(result.decodedResult, 0);
    });

    it("get_pairs reverts on negative offset", async () => {
      await expectRevert(factory.get_pairs(-1, 10), "NEGATIVE_OFFSET");
    });

    it("get_pairs reverts on zero limit", async () => {
      await expectRevert(factory.get_pairs(0, 0), "ZERO_LIMIT");
    });
  });

  describe("error cases", () => {
    it("reverts with identical tokens", async () => {
      await expectRevert(
        factory.initialize(
          token0.$options.address,
          token0.$options.address,
          SEED_AMOUNT,
          SEED_AMOUNT,
          0,
        ),
        "IDENTICAL_TOKENS",
      );
    });

    it("reverts when pair already exists", async () => {
      await token0.create_allowance(contractToAccount(factory.$options.address), SEED_AMOUNT);
      await token1.create_allowance(contractToAccount(factory.$options.address), SEED_AMOUNT);
      await expectRevert(
        factory.initialize(
          token0.$options.address,
          token1.$options.address,
          SEED_AMOUNT,
          SEED_AMOUNT,
          0,
        ),
        "PAIR_EXISTS",
      );
    });

    it("reverts when config is disabled", async () => {
      const disabledCfgResult = await dexConfig.create_amm_config(
        TRADE_FEE_RATE,
        PROTOCOL_FEE_RATE,
        FUND_FEE_RATE,
        CREATOR_FEE_RATE,
        0,
        60,
      );
      const disabledIdx = Number(disabledCfgResult.decodedResult);
      await dexConfig.update_amm_config(disabledIdx, 6, 1);

      const disabledFactory = await deploySophiaContract(
        aeSdk,
        "./contracts/cpmm/PairFactory.aes",
        [
          dexConfig.$options.address,
          disabledIdx,
          pairModel.$options.address,
          admin.address,
        ],
      );

      const newTokenA = await deployToken(aeSdk, "New A", "NTA", 18, INITIAL_SUPPLY);
      const newTokenB = await deployToken(aeSdk, "New B", "NTB", 18, INITIAL_SUPPLY);

      await newTokenA.create_allowance(contractToAccount(disabledFactory.$options.address), SEED_AMOUNT);
      await newTokenB.create_allowance(contractToAccount(disabledFactory.$options.address), SEED_AMOUNT);

      await expectRevert(
        disabledFactory.initialize(
          newTokenA.$options.address,
          newTokenB.$options.address,
          SEED_AMOUNT,
          SEED_AMOUNT,
          0,
        ),
        "CONFIG_DISABLED",
      );
    });
  });

  describe("multiple pairs", () => {
    it("can create a second pair with different tokens", async () => {
      const tokenC = await deployToken(aeSdk, "Token C", "TKC", 18, INITIAL_SUPPLY);
      await tokenC.create_allowance(contractToAccount(factory.$options.address), SEED_AMOUNT);
      await token0.create_allowance(contractToAccount(factory.$options.address), SEED_AMOUNT);

      const result = await factory.initialize(
        token0.$options.address,
        tokenC.$options.address,
        SEED_AMOUNT,
        SEED_AMOUNT,
        0,
        { omitUnknown: true },
      );

      const pairAddress = result.decodedResult;
      assert.isTrue(pairAddress.startsWith("ct_"));

      const count = await factory.pair_count();
      assert.equal(count.decodedResult, 2n);

      const allPairs = await factory.get_pairs(0, 100);
      assert.lengthOf(allPairs.decodedResult, 2);
    });
  });
});
