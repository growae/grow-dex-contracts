import { utils } from "@aeternity/aeproject";
import { Contract, getFileSystem } from "@aeternity/aepp-sdk";
import { readFile } from "fs/promises";
import { dirname, resolve } from "path";

const defaultIncludes = [
  "List.aes", "Option.aes", "String.aes", "Func.aes",
  "Pair.aes", "Triple.aes", "BLS12_381.aes", "Frac.aes",
  "Set.aes", "Bitwise.aes",
];
const includeRe = /^include\s*"([\w/.-]+)"/gim;

async function resolveIncludes(filePath, fs) {
  const source = await readFile(filePath, "utf8");
  const fileDir = dirname(filePath);
  for (const [, inc] of source.matchAll(includeRe)) {
    if (defaultIncludes.includes(inc) || inc in fs) continue;
    const resolved = resolve(fileDir, inc);
    fs[inc] = await readFile(resolved, "utf8");
    await resolveIncludes(resolved, fs);
  }
}

async function getFileSystemFixed(path) {
  const fs = {};
  await resolveIncludes(resolve(path), fs);
  return fs;
}

export async function deploySophiaContract(aeSdk, source, initArgs = []) {
  const fileSystem = await getFileSystemFixed(source);
  const sourceCode = utils.getContractContent(source);
  const contract = await Contract.initialize({
    ...aeSdk.getContext(),
    sourceCode,
    fileSystem,
  });
  if (typeof contract.init === "function") {
    await contract.init(...initArgs);
  } else {
    await contract.$deploy(initArgs);
  }
  return contract;
}

export async function deployToken(aeSdk, name, symbol, decimals, initialSupply) {
  return deploySophiaContract(aeSdk, "./contracts/TestToken.aes", [name, symbol, decimals, initialSupply]);
}

export async function deployDexConfig(aeSdk) {
  return deploySophiaContract(aeSdk, "./contracts/DexConfig.aes", []);
}

export async function deployWAE(aeSdk) {
  return deploySophiaContract(aeSdk, "./contracts/WAE.aes", []);
}
