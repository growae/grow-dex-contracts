import { utils } from "@aeternity/aeproject";
import { assert } from "chai";
import { before, describe, it } from "mocha";
import { deploySophiaContract, deployToken, deployDexConfig, deployWAE } from "./shared/fixtures.js";
import { expectRevert, contractToAccount } from "./shared/utils.js";

describe("Router", () => {
  let aeSdk, accounts;
  let config, factory, router, wae;
  let tokenA, tokenB, tokenC;

  const SUPPLY = 10n ** 24n;
  const LIQUIDITY = 10n ** 18n;
  const SWAP_AMOUNT = 10n ** 15n;
  const FAR_DEADLINE = 9999999999999999n;

  before(async () => {
    aeSdk = utils.getSdk();
    accounts = utils.getDefaultAccounts();

    config = await deployDexConfig(aeSdk);
    // 0.3% trade fee, 20% protocol, 10% fund, 0% creator, 0 pool fee, 0 tick spacing
    await config.create_amm_config(3000, 200000, 100000, 0, 0, 0);

    tokenA = await deployToken(aeSdk, "TokenA", "TKA", 18, SUPPLY);
    tokenB = await deployToken(aeSdk, "TokenB", "TKB", 18, SUPPLY);
    tokenC = await deployToken(aeSdk, "TokenC", "TKC", 18, SUPPLY);

    wae = await deployWAE(aeSdk);

    const pairModel = await deploySophiaContract(
      aeSdk, "./contracts/cpmm/Pair.aes",
      [config.$options.address, 0, tokenA.$options.address, tokenB.$options.address, accounts[0].address, 0]
    );

    factory = await deploySophiaContract(
      aeSdk, "./contracts/cpmm/PairFactory.aes",
      [config.$options.address, 0, pairModel.$options.address, accounts[0].address]
    );

    // Create pair A/B with initial liquidity
    await tokenA.create_allowance(contractToAccount(factory.$options.address), LIQUIDITY);
    await tokenB.create_allowance(contractToAccount(factory.$options.address), LIQUIDITY);
    await factory.initialize(tokenA.$options.address, tokenB.$options.address, LIQUIDITY, LIQUIDITY, 0, { omitUnknown: true });

    // Create pair B/C with initial liquidity
    await tokenB.create_allowance(contractToAccount(factory.$options.address), LIQUIDITY);
    await tokenC.create_allowance(contractToAccount(factory.$options.address), LIQUIDITY);
    await factory.initialize(tokenB.$options.address, tokenC.$options.address, LIQUIDITY, LIQUIDITY, 0, { omitUnknown: true });

    router = await deploySophiaContract(
      aeSdk, "./contracts/Router.aes",
      [factory.$options.address, wae.$options.address]
    );
  });

  describe("swap_base_input", () => {
    it("swaps single hop A→B", async () => {
      const balBBefore = (await tokenB.balance(accounts[0].address)).decodedResult ?? 0n;

      await tokenA.create_allowance(contractToAccount(router.$options.address), SWAP_AMOUNT);
      const result = await router.swap_base_input(
        tokenA.$options.address, SWAP_AMOUNT, 1n,
        [tokenA.$options.address, tokenB.$options.address], FAR_DEADLINE,
        { omitUnknown: true },
      );
      const amountOut = result.decodedResult;

      assert.isTrue(amountOut > 0n, "output should be positive");
      assert.isTrue(amountOut < SWAP_AMOUNT, "output less than input due to fees");

      const balBAfter = (await tokenB.balance(accounts[0].address)).decodedResult ?? 0n;
      assert.equal(balBAfter - balBBefore, amountOut);
    });

    it("swaps multi-hop A→B→C", async () => {
      const balCBefore = (await tokenC.balance(accounts[0].address)).decodedResult ?? 0n;

      await tokenA.create_allowance(contractToAccount(router.$options.address), SWAP_AMOUNT);
      const result = await router.swap_base_input(
        tokenA.$options.address, SWAP_AMOUNT, 1n,
        [tokenA.$options.address, tokenB.$options.address, tokenC.$options.address], FAR_DEADLINE,
        { omitUnknown: true },
      );
      const amountOut = result.decodedResult;

      assert.isTrue(amountOut > 0n, "output should be positive");

      const balCAfter = (await tokenC.balance(accounts[0].address)).decodedResult ?? 0n;
      assert.equal(balCAfter - balCBefore, amountOut);
    });

    it("reverts on expired deadline", async () => {
      await tokenA.create_allowance(contractToAccount(router.$options.address), SWAP_AMOUNT);
      await expectRevert(
        router.swap_base_input(
          tokenA.$options.address, SWAP_AMOUNT, 1n,
          [tokenA.$options.address, tokenB.$options.address], 0
        ),
        "EXPIRED"
      );
    });

    it("reverts on zero input amount", async () => {
      await expectRevert(
        router.swap_base_input(
          tokenA.$options.address, 0, 0,
          [tokenA.$options.address, tokenB.$options.address], FAR_DEADLINE
        ),
        "ZERO_INPUT"
      );
    });

    it("reverts on single-token path", async () => {
      await tokenA.create_allowance(contractToAccount(router.$options.address), SWAP_AMOUNT);
      await expectRevert(
        router.swap_base_input(
          tokenA.$options.address, SWAP_AMOUNT, 1n,
          [tokenA.$options.address], FAR_DEADLINE
        ),
        "INVALID_PATH"
      );
    });

    it("reverts when minimum output exceeds actual output", async () => {
      await tokenA.create_allowance(contractToAccount(router.$options.address), SWAP_AMOUNT);
      await expectRevert(
        router.swap_base_input(
          tokenA.$options.address, SWAP_AMOUNT, SWAP_AMOUNT,
          [tokenA.$options.address, tokenB.$options.address], FAR_DEADLINE
        ),
        "SLIPPAGE_EXCEEDED"
      );
    });

    it("reverts when pair not found in path", async () => {
      const tokenD = await deployToken(aeSdk, "TokenD", "TKD", 18, SUPPLY);
      await tokenA.create_allowance(contractToAccount(router.$options.address), SWAP_AMOUNT);
      await expectRevert(
        router.swap_base_input(
          tokenA.$options.address, SWAP_AMOUNT, 1n,
          [tokenA.$options.address, tokenD.$options.address], FAR_DEADLINE
        ),
        "PAIR_NOT_FOUND"
      );
    });
  });

  describe("swap_base_output", () => {
    it("swaps with exact output A→B", async () => {
      const desiredOut = SWAP_AMOUNT / 2n;
      const balBBefore = (await tokenB.balance(accounts[0].address)).decodedResult ?? 0n;

      await tokenA.create_allowance(contractToAccount(router.$options.address), SWAP_AMOUNT);
      const result = await router.swap_base_output(
        tokenA.$options.address, SWAP_AMOUNT, desiredOut,
        [tokenA.$options.address, tokenB.$options.address], FAR_DEADLINE,
        { omitUnknown: true },
      );
      const amountSpent = result.decodedResult;

      assert.isTrue(amountSpent > 0n, "should spend some input");
      assert.isTrue(amountSpent <= SWAP_AMOUNT, "should not exceed max input");

      const balBAfter = (await tokenB.balance(accounts[0].address)).decodedResult ?? 0n;
      assert.equal(balBAfter - balBBefore, desiredOut);
    });

    it("refunds excess input tokens", async () => {
      const desiredOut = SWAP_AMOUNT / 10n;
      const balABefore = (await tokenA.balance(accounts[0].address)).decodedResult ?? 0n;

      await tokenA.create_allowance(contractToAccount(router.$options.address), SWAP_AMOUNT);
      const result = await router.swap_base_output(
        tokenA.$options.address, SWAP_AMOUNT, desiredOut,
        [tokenA.$options.address, tokenB.$options.address], FAR_DEADLINE,
        { omitUnknown: true },
      );
      const amountSpent = result.decodedResult;

      const balAAfter = (await tokenA.balance(accounts[0].address)).decodedResult ?? 0n;
      assert.equal(balABefore - balAAfter, amountSpent);
      assert.isTrue(amountSpent < SWAP_AMOUNT, "should spend less than max");
    });

    it("reverts on expired deadline", async () => {
      await tokenA.create_allowance(contractToAccount(router.$options.address), SWAP_AMOUNT);
      await expectRevert(
        router.swap_base_output(
          tokenA.$options.address, SWAP_AMOUNT, SWAP_AMOUNT / 2n,
          [tokenA.$options.address, tokenB.$options.address], 0
        ),
        "EXPIRED"
      );
    });

    it("reverts on zero output amount", async () => {
      await expectRevert(
        router.swap_base_output(
          tokenA.$options.address, SWAP_AMOUNT, 0,
          [tokenA.$options.address, tokenB.$options.address], FAR_DEADLINE
        ),
        "ZERO_OUTPUT"
      );
    });
  });
});
