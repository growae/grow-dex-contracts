import { utils } from "@aeternity/aeproject";
import { Contract, getFileSystem } from "@aeternity/aepp-sdk";

export const Q32 = 2n ** 32n;
export const Q64 = 2n ** 64n;
export const FEE_RATE_DENOMINATOR = 1_000_000n;
export const MINIMUM_LIQUIDITY = 100n;
export const INITIAL_SUPPLY = 10n ** 18n;

export function sqrt(value) {
  if (value < 0n) throw new Error("square root of negative");
  if (value === 0n) return 0n;
  let z = value;
  let x = value / 2n + 1n;
  while (x < z) {
    z = x;
    x = (value / x + x) / 2n;
  }
  return z;
}

export function ceilDiv(a, b) {
  if (b === 0n) throw new Error("division by zero");
  if (a === 0n) return 0n;
  return (a + b - 1n) / b;
}

export function tradingFee(amount, rate) {
  if (rate === 0n) return 0n;
  return ceilDiv(amount * rate, FEE_RATE_DENOMINATOR);
}

export function protocolFee(tradeFee, rate) {
  return tradeFee * rate / FEE_RATE_DENOMINATOR;
}

export function fundFee(tradeFee, rate) {
  return tradeFee * rate / FEE_RATE_DENOMINATOR;
}

export function creatorFee(amount, rate) {
  if (rate === 0n) return 0n;
  return ceilDiv(amount * rate, FEE_RATE_DENOMINATOR);
}

export function amountOut(amountIn, reserveIn, reserveOut) {
  const numerator = amountIn * reserveOut;
  const denominator = reserveIn + amountIn;
  return numerator / denominator;
}

export function amountIn(amountOutVal, reserveIn, reserveOut) {
  const numerator = reserveIn * amountOutVal;
  const denominator = reserveOut - amountOutVal;
  return numerator / denominator + 1n;
}

export async function expectRevert(promise, errorMsg) {
  try {
    await promise;
    throw new Error("Expected revert but call succeeded");
  } catch (e) {
    if (errorMsg && !e.message.includes(errorMsg)) {
      throw new Error(`Expected "${errorMsg}" but got "${e.message}"`);
    }
  }
}

export function approxEqual(a, b, tolerance = 1n) {
  const diff = a > b ? a - b : b - a;
  return diff <= tolerance;
}
