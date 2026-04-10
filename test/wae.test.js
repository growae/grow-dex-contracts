import { utils } from "@aeternity/aeproject";
import * as chai from "chai";
import { assert } from "chai";
import chaiAsPromised from "chai-as-promised";
import { before, describe, it } from "mocha";
import { deployWAE } from "./shared/fixtures.js";
import { expectRevert } from "./shared/utils.js";

chai.use(chaiAsPromised);

describe("WAE", () => {
  let aeSdk;
  let wae;
  let account1;
  let account2;

  before(async () => {
    aeSdk = utils.getSdk();
    account1 = utils.getDefaultAccounts()[0];
    account2 = utils.getDefaultAccounts()[1];
    wae = await deployWAE(aeSdk);
  });

  describe("meta_info", () => {
    it("returns correct name, symbol, and decimals", async () => {
      const result = await wae.meta_info();
      const info = result.decodedResult;
      assert.equal(info.name, "Wrapped AE");
      assert.equal(info.symbol, "WAE");
      assert.equal(info.decimals, 18n);
    });
  });

  describe("deposit", () => {
    it("increases caller balance on deposit", async () => {
      const amount = 1000000n;
      await wae.deposit({ amount: Number(amount) });

      const bal = await wae.balance(account1.address);
      assert.equal(bal.decodedResult, amount);
    });

    it("emits Deposit event", async () => {
      const result = await wae.deposit({ amount: 500000 });
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "Deposit");
    });

    it("reverts on zero deposit", async () => {
      await expectRevert(wae.deposit({ amount: 0 }), "WAE_ZERO_DEPOSIT");
    });

    it("accumulates multiple deposits", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 100 });
      await freshWae.deposit({ amount: 200 });

      const bal = await freshWae.balance(account1.address);
      assert.equal(bal.decodedResult, 300n);
    });
  });

  describe("deposit_to", () => {
    it("credits recipient balance", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit_to(account2.address, { amount: 750000 });

      const bal = await freshWae.balance(account2.address);
      assert.equal(bal.decodedResult, 750000n);

      const callerBal = await freshWae.balance(account1.address);
      assert.isUndefined(callerBal.decodedResult);
    });

    it("emits Deposit event for recipient", async () => {
      const freshWae = await deployWAE(aeSdk);
      const result = await freshWae.deposit_to(account2.address, {
        amount: 100,
      });
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "Deposit");
    });

    it("reverts on zero deposit", async () => {
      await expectRevert(
        wae.deposit_to(account2.address, { amount: 0 }),
        "WAE_ZERO_DEPOSIT"
      );
    });
  });

  describe("withdraw", () => {
    it("decreases balance and returns AE", async () => {
      const freshWae = await deployWAE(aeSdk);
      const depositAmount = 1000000;
      await freshWae.deposit({ amount: depositAmount });

      const withdrawAmount = 400000;
      await freshWae.withdraw(withdrawAmount);

      const bal = await freshWae.balance(account1.address);
      assert.equal(bal.decodedResult, BigInt(depositAmount - withdrawAmount));
    });

    it("emits Withdrawal event", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 1000 });
      const result = await freshWae.withdraw(500);
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "Withdrawal");
    });

    it("reverts on zero withdraw", async () => {
      await expectRevert(wae.withdraw(0), "WAE_ZERO_WITHDRAW");
    });

    it("reverts when withdrawing more than balance", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 100 });
      await expectRevert(
        freshWae.withdraw(200),
        "WAE_INSUFFICIENT_BALANCE"
      );
    });

    it("allows full withdrawal", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 5000 });
      await freshWae.withdraw(5000);

      const bal = await freshWae.balance(account1.address);
      assert.equal(bal.decodedResult, 0n);
    });
  });

  describe("total_supply", () => {
    it("equals Contract.balance after deposits", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 2000 });
      await freshWae.deposit({ amount: 3000 });

      const supply = await freshWae.total_supply();
      assert.equal(supply.decodedResult, 5000n);
    });

    it("decreases after withdrawal", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 5000 });
      await freshWae.withdraw(2000);

      const supply = await freshWae.total_supply();
      assert.equal(supply.decodedResult, 3000n);
    });
  });

  describe("transfer", () => {
    it("updates both balances", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 10000 });

      await freshWae.transfer(account2.address, 4000);

      const bal1 = await freshWae.balance(account1.address);
      assert.equal(bal1.decodedResult, 6000n);

      const bal2 = await freshWae.balance(account2.address);
      assert.equal(bal2.decodedResult, 4000n);
    });

    it("emits Transfer event", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 1000 });
      const result = await freshWae.transfer(account2.address, 500);
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "Transfer");
    });

    it("reverts when transferring more than balance", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 100 });
      await expectRevert(
        freshWae.transfer(account2.address, 200),
        "INSUFFICIENT_BALANCE"
      );
    });

    it("reverts on zero amount", async () => {
      await expectRevert(
        wae.transfer(account2.address, 0),
        "NEGATIVE_AMOUNT"
      );
    });
  });

  describe("allowance flow", () => {
    it("create_allowance sets allowance", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.create_allowance(account2.address, 5000);

      const allowance = await freshWae.allowance({
        from_account: account1.address,
        for_account: account2.address,
      });
      assert.equal(allowance.decodedResult, 5000n);
    });

    it("emits Approval event on create_allowance", async () => {
      const freshWae = await deployWAE(aeSdk);
      const result = await freshWae.create_allowance(account2.address, 1000);
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "Approval");
    });

    it("change_allowance increases allowance", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.create_allowance(account2.address, 1000);
      await freshWae.change_allowance(account2.address, 500);

      const allowance = await freshWae.allowance({
        from_account: account1.address,
        for_account: account2.address,
      });
      assert.equal(allowance.decodedResult, 1500n);
    });

    it("change_allowance decreases allowance", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.create_allowance(account2.address, 1000);
      await freshWae.change_allowance(account2.address, -400);

      const allowance = await freshWae.allowance({
        from_account: account1.address,
        for_account: account2.address,
      });
      assert.equal(allowance.decodedResult, 600n);
    });

    it("change_allowance reverts if result would be negative", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.create_allowance(account2.address, 100);
      await expectRevert(
        freshWae.change_allowance(account2.address, -200),
        "NEGATIVE_ALLOWANCE"
      );
    });

    it("transfer_allowance moves tokens on behalf of owner", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 10000 });
      await freshWae.create_allowance(account2.address, 5000);

      const account3 = utils.getDefaultAccounts()[2];

      await freshWae.transfer_allowance(
        account1.address,
        account3.address,
        3000,
        { onAccount: account2 }
      );

      const ownerBal = await freshWae.balance(account1.address);
      assert.equal(ownerBal.decodedResult, 7000n);

      const recipientBal = await freshWae.balance(account3.address);
      assert.equal(recipientBal.decodedResult, 3000n);

      const remaining = await freshWae.allowance({
        from_account: account1.address,
        for_account: account2.address,
      });
      assert.equal(remaining.decodedResult, 2000n);
    });

    it("transfer_allowance reverts with insufficient allowance", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 10000 });
      await freshWae.create_allowance(account2.address, 100);

      await expectRevert(
        freshWae.transfer_allowance(
          account1.address,
          account2.address,
          500,
          { onAccount: account2 }
        ),
        "INSUFFICIENT_ALLOWANCE"
      );
    });

    it("transfer_allowance reverts with insufficient balance", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 100 });
      await freshWae.create_allowance(account2.address, 5000);

      await expectRevert(
        freshWae.transfer_allowance(
          account1.address,
          account2.address,
          500,
          { onAccount: account2 }
        ),
        "INSUFFICIENT_BALANCE"
      );
    });

    it("transfer_allowance emits Transfer event", async () => {
      const freshWae = await deployWAE(aeSdk);
      await freshWae.deposit({ amount: 10000 });
      await freshWae.create_allowance(account2.address, 5000);

      const result = await freshWae.transfer_allowance(
        account1.address,
        account2.address,
        1000,
        { onAccount: account2 }
      );
      const events = result.decodedEvents;
      assert.lengthOf(events, 1);
      assert.equal(events[0].name, "Transfer");
    });
  });
});
