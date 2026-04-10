import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  AeSdk, Node, MemoryAccount, CompilerHttp, Contract,
} from '@aeternity/aepp-sdk';
import { ADDRESSES } from '../deploy/addresses.js';

const NETWORKS = {
  testnet: 'https://testnet.aeternity.io',
  mainnet: 'https://mainnet.aeternity.io',
};

const COMPILER_URL = 'https://compiler.aeternity.io';

const network = process.argv.includes('--network')
  ? process.argv[process.argv.indexOf('--network') + 1]
  : 'testnet';

if (!NETWORKS[network]) {
  console.error(`Unknown network: ${network}. Use "testnet" or "mainnet".`);
  process.exit(1);
}

const secretKey = process.env.SECRET_KEY;
if (!secretKey) {
  console.error('SECRET_KEY not set. Copy .env.example to .env and add your sk_... key.');
  process.exit(1);
}

const FEE_CONFIGS = [
  { name: 'Stable',    tradeFee: 500,  protocolFee: 120000, fundFee: 40000, creatorFee: 0,   poolFee: 0, tickSpacing: 1   },
  { name: 'Standard',  tradeFee: 2500, protocolFee: 120000, fundFee: 40000, creatorFee: 500, poolFee: 0, tickSpacing: 10  },
  { name: 'Volatile',  tradeFee: 10000, protocolFee: 120000, fundFee: 40000, creatorFee: 500, poolFee: 0, tickSpacing: 60  },
  { name: 'Exotic',    tradeFee: 20000, protocolFee: 120000, fundFee: 40000, creatorFee: 500, poolFee: 0, tickSpacing: 120 },
];

const STDLIB = new Set([
  'String.aes', 'Option.aes', 'List.aes', 'Func.aes', 'Pair.aes',
  'Set.aes', 'BLS12_381.aes', 'Frac.aes', 'AENSCompat.aes',
]);

function buildFileSystem(entryPath) {
  const fileSystem = {};
  const visited = new Set();

  function processFile(absFilePath) {
    if (visited.has(absFilePath)) return;
    visited.add(absFilePath);

    const source = readFileSync(absFilePath, 'utf-8');
    const dir = dirname(absFilePath);
    const includeRegex = /^include\s+"(.+)"/gm;
    let match;

    while ((match = includeRegex.exec(source)) !== null) {
      const rawPath = match[1];
      if (STDLIB.has(rawPath)) continue;

      const absInclude = resolve(dir, rawPath);
      if (!existsSync(absInclude)) {
        throw new Error(`Include not found: ${rawPath} (from ${absFilePath})`);
      }

      if (!fileSystem[rawPath]) {
        fileSystem[rawPath] = readFileSync(absInclude, 'utf-8');
      }

      processFile(absInclude);
    }
  }

  processFile(resolve(entryPath));
  return fileSystem;
}

async function deployContract(aeSdk, sourcePath, args = []) {
  const sourceCode = readFileSync(sourcePath, 'utf-8');
  const fileSystem = buildFileSystem(sourcePath);

  const contract = await Contract.initialize({
    ...aeSdk.getContext(),
    sourceCode,
    fileSystem,
  });

  const tx = await contract.init(...args);
  console.log(`  Address: ${tx.address}`);
  return { contract, address: tx.address };
}

async function deploy() {
  const account = new MemoryAccount(secretKey);
  const node = new Node(NETWORKS[network]);
  const compiler = new CompilerHttp(COMPILER_URL);

  const aeSdk = new AeSdk({
    nodes: [{ name: network, instance: node }],
    accounts: [account],
    onCompiler: compiler,
  });

  const waeAddress = ADDRESSES[network]?.wae;
  if (!waeAddress) {
    console.error(`No WAE address configured for ${network}. Update deploy/addresses.js.`);
    process.exit(1);
  }

  console.log(`\nDeploying Grow DEX to ${network} (${NETWORKS[network]})`);
  console.log(`Deployer: ${account.address}`);
  console.log(`WAE:      ${waeAddress}\n`);

  // 1. DexConfig
  console.log('[1/7] DexConfig');
  const { contract: dexConfig, address: dexConfigAddr } = await deployContract(
    aeSdk, './contracts/DexConfig.aes',
  );

  // Create fee tier configs
  for (const cfg of FEE_CONFIGS) {
    const result = await dexConfig.create_amm_config(
      cfg.tradeFee, cfg.protocolFee, cfg.fundFee, cfg.creatorFee, cfg.poolFee, cfg.tickSpacing,
    );
    console.log(`  Fee tier "${cfg.name}" created (index: ${result.decodedResult})`);
  }

  // 2. Pair template (CPMM)
  console.log('\n[2/7] Pair template (CPMM)');
  const { address: pairTemplateAddr } = await deployContract(
    aeSdk, './contracts/cpmm/Pair.aes',
    [dexConfigAddr, 0, waeAddress, waeAddress, account.address, 0],
  );

  // 3. PairFactory
  console.log('\n[3/7] PairFactory');
  const { address: pairFactoryAddr } = await deployContract(
    aeSdk, './contracts/cpmm/PairFactory.aes',
    [dexConfigAddr, 1, pairTemplateAddr, account.address],
  );

  // 4. Pool template (CLMM)
  console.log('\n[4/7] Pool template (CLMM)');
  const Q64 = 2n ** 64n;
  const { address: poolTemplateAddr } = await deployContract(
    aeSdk, './contracts/clmm/Pool.aes',
    [dexConfigAddr, 0, waeAddress, waeAddress, 1, Q64, account.address, 0],
  );

  // 5. PoolFactory
  console.log('\n[5/7] PoolFactory');
  const { address: poolFactoryAddr } = await deployContract(
    aeSdk, './contracts/clmm/PoolFactory.aes',
    [dexConfigAddr, poolTemplateAddr],
  );

  // 6. Router
  console.log('\n[6/7] Router');
  const { address: routerAddr } = await deployContract(
    aeSdk, './contracts/Router.aes',
    [pairFactoryAddr, waeAddress],
  );

  // 7. Farm
  console.log('\n[7/7] Farm');
  const { address: farmAddr } = await deployContract(
    aeSdk, './contracts/Farm.aes',
  );

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  Deployment Complete');
  console.log('='.repeat(60));
  console.log(`  Network:      ${network}`);
  console.log(`  DexConfig:    ${dexConfigAddr}`);
  console.log(`  Pair (tmpl):  ${pairTemplateAddr}`);
  console.log(`  PairFactory:  ${pairFactoryAddr}`);
  console.log(`  Pool (tmpl):  ${poolTemplateAddr}`);
  console.log(`  PoolFactory:  ${poolFactoryAddr}`);
  console.log(`  Router:       ${routerAddr}`);
  console.log(`  Farm:         ${farmAddr}`);
  console.log(`  WAE:          ${waeAddress}`);
  console.log('='.repeat(60));
}

deploy().catch((err) => {
  console.error('\nDeploy failed:', err.message || err);
  process.exit(1);
});
