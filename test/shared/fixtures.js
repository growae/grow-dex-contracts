import { utils } from "@aeternity/aeproject";
import { Contract, getFileSystem } from "@aeternity/aepp-sdk";

export async function deploySophiaContract(aeSdk, source, initArgs = []) {
  const fileSystem = await getFileSystem(source);
  const sourceCode = utils.getContractContent(source);
  const contract = await Contract.initialize({
    ...aeSdk.getContext(),
    sourceCode,
    fileSystem,
  });
  await contract.init(...initArgs);
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
