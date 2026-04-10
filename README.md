# Grow DEX Contracts

> **WARNING: USE AT YOUR OWN RISK**
>
> This software is a **proof of concept** demonstrating what can be built on the [Aeternity](https://aeternity.com) blockchain. It is provided strictly for educational and experimental purposes.
>
> **These contracts have NOT been formally audited.** They may contain bugs, vulnerabilities, or other issues that could result in the **total loss of funds**. Do not deploy to mainnet or use with real assets unless you fully understand and accept the risks.
>
> The authors and contributors of this project **assume no responsibility or liability** for any loss, damage, or other consequence arising from the use, deployment, or interaction with this software in any environment, including but not limited to testnet and mainnet. By using this software, you acknowledge that you do so **entirely at your own risk**.

A Raydium-equivalent decentralized exchange on Aeternity, featuring both constant-product (CPMM) and concentrated-liquidity (CLMM) automated market makers, plus LP farming.

## Architecture

```
contracts/
├── lib/                  # Shared math & utility namespaces
│   ├── Math.aes          # min, max, abs, ceil_div, mul_div, sqrt
│   ├── FeeMath.aes       # Fee splitting (trade, protocol, fund, creator)
│   ├── SwapMath.aes      # Constant-product swap math + multi-hop helpers
│   ├── Oracle.aes        # TWAP price oracle (ring buffer observations)
│   ├── TickMath.aes      # Tick ↔ √price conversion (Q64 fixed-point)
│   ├── LiquidityMath.aes # Concentrated liquidity math (amounts, prices)
│   └── BitMap.aes        # Tick bitmap for efficient initialized-tick search
├── interfaces/           # Contract interfaces for cross-contract calls
├── cpmm/
│   ├── Pair.aes          # CPMM liquidity pool (deposit, withdraw, swap, LP token)
│   └── PairFactory.aes   # Pair deployment via Chain.clone, paginated registry
├── clmm/
│   ├── Pool.aes          # CLMM pool (positions, tick-based swaps, fee accrual)
│   └── PoolFactory.aes   # Pool deployment via Chain.clone, paginated registry
├── DexConfig.aes         # Fee tier configuration (trade, protocol, fund, creator rates)
├── Router.aes            # Multi-hop CPMM swap routing
├── Farm.aes              # MasterChef-style LP staking with reward distribution
├── WAE.aes               # Wrapped AE (AEX-9, for local testing)
└── TestToken.aes         # Generic AEX-9 token for testing
```

## Key Features

- **CPMM (Constant Product)** — Uniswap V2-style pairs with configurable multi-tier fees
- **CLMM (Concentrated Liquidity)** — Uniswap V3-style concentrated positions with tick-based price ranges
- **Multi-hop routing** — `Router.swap_base_input` chains swaps across pairs automatically
- **Fee splitting** — Configurable trade, protocol, fund, and creator fee tiers
- **TWAP oracle** — Ring-buffer price oracle with manipulation resistance
- **LP farming** — Time-windowed reward distribution for staked LP tokens
- **Paginated registries** — Factories use `map(int, ...)` with `get_pairs(offset, limit)` / `get_pools(offset, limit)` for gas-safe enumeration
- **Reentrancy protection** — Lock guard on all state-changing pool operations
- **Status bitmask** — Admin can selectively disable deposit/withdraw/swap per pool

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) >= 22

## Setup

```bash
# Start the local Aeternity node, compiler, and proxy
docker compose up -d

# Install dependencies
npm install

# Wait for services (node on :3001, compiler on :3080)
```

## Testing

```bash
npm test
```

Runs 409 tests across 13 suites covering all contracts, libraries, and edge cases.

| Suite | Tests | Contract |
|-------|------:|----------|
| math | 30 | Math namespace |
| fee-math | 22 | FeeMath namespace |
| swap-math | 18 | SwapMath namespace |
| bitmap | 31 | BitMap namespace |
| tick-math | 20 | TickMath namespace |
| liquidity-math | 25 | LiquidityMath namespace |
| dex-config | 37 | DexConfig |
| wae | 28 | WAE |
| pair | 62 | Pair (CPMM) |
| pair-factory | 17 | PairFactory |
| router | 11 | Router |
| pool | 35 | Pool (CLMM) |
| farm | 30 | Farm |

## CI/CD

GitHub Actions runs the full test suite on every pull request and push to `develop` or `main`. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Deployment

### Quick start

```bash
# Generate a new wallet (if needed)
npm run generate-wallet

# Copy .env.example and set your secret key
cp .env.example .env

# Deploy to testnet
npm run deploy:testnet

# Deploy to mainnet
npm run deploy:mainnet
```

The deploy script handles the full deployment sequence automatically:

1. **DexConfig** — deploys and creates four fee tier configs (Stable, Standard, Volatile, Exotic)
2. **Pair** — deploys a CPMM template instance
3. **PairFactory** — deploys with DexConfig address and Pair template
4. **Pool** — deploys a CLMM template instance
5. **PoolFactory** — deploys with DexConfig address and Pool template
6. **Router** — deploys with PairFactory and WAE addresses
7. **Farm** — deploys the LP staking contract

### Fee tiers

| Tier | Trade Fee | Protocol | Fund | Creator | Tick Spacing |
|------|-----------|----------|------|---------|--------------|
| Stable | 0.05% | 12% | 4% | — | 1 |
| Standard | 0.25% | 12% | 4% | 0.05% | 10 |
| Volatile | 1.00% | 12% | 4% | 0.05% | 60 |
| Exotic | 2.00% | 12% | 4% | 0.05% | 120 |

### WAE addresses

Production WAE contracts (reused from existing deployments):

| Network | WAE Address |
|---------|-------------|
| Mainnet | `ct_J3zBY8xxjsRr3QojETNw48Eb38fjvEuJKkQ6KzECvubvEcvCa` |
| Testnet | `ct_JDp175ruWd7mQggeHewSLS1PFXt9AzThCDaFedxon8mF8xTRF` |

## Stack

- **Sophia** >= 8 (FATE VM)
- **Aeternity Node** v7.2.1
- **Sophia Compiler** v8.0.0
- **aepp-sdk** ^14.0.0
- **aeproject** ^5.0.0
- **Mocha** + **Chai** for testing

## Disclaimer

This project is a **proof of concept** showcasing decentralized exchange functionality on the Aeternity blockchain. It is not intended for production use. The authors and contributors make **no warranties**, express or implied, regarding the safety, reliability, or fitness of this software for any purpose. Use of this software is entirely at the user's own risk, and the authors bear **no responsibility** for any financial loss, security breach, or other damage that may result from its use.

## License

MIT License — see [LICENSE](LICENSE) for details.
