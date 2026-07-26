# ATLAS Protocol — Robinhood Chain Mainnet

ATLAS is a tokenized-stock index protocol for Robinhood Chain. Factory and Router are deployed on mainnet; the contracts remain unaudited.

## Current status

- Network: Robinhood Chain mainnet (`4663` / `0x1237`)
- RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: `https://robinhoodchain.blockscout.com`
- Gas asset: ETH
- Canonical RWA addresses: `config/robinhood-mainnet.json`
- Stock Token balances/transfers: ERC-8056 `uiMultiplier()` aware
- Stock Token buy/sell: executable ETH routes from LI.FI aggregation, validated server-side before wallet submission
- ATLAS mainnet Factory: `0xf920Cd56a8a39a59792103BA45dd5351d31e5f0c`
- ATLAS atomic Index Router: `0x606f0599280f2a429895c4D2a040466dD57CeB7A`
- Legacy `AtlasVault` and `StockPaymentVault`: excluded from mainnet
- AI: server-side `/api/chat` proxy; no provider key is loaded by browser code

This is not an audit. Use an independent smart-contract audit, legal review and treasury multisig before treating the deployment as production-safe.

## Why the legacy vault is disabled

The testnet `AtlasVault.buyIndex()` path supplied LP stock collateral without charging the buyer through a real payment/swap path, and the advertised LP fee distribution had no complete claim mechanism. The fixed-price `StockPaymentVault` also lacked mainnet-grade oracle/slippage protection. Both are excluded from this production repository, the mainnet deployment path and the UI.

The mainnet contracts use direct collateralization instead:

1. A user approves the canonical underlying Stock Tokens.
2. `MainnetIndexToken.mint()` transfers the configured basket into the index contract.
3. The gross index amount is minted and its immutable fee is split 50/50 between creator and treasury.
4. `burn()` returns the deterministic raw-unit basket; accidental donations/surplus are not distributed to minters.

`MainnetIndexRouter` restores the testnet-style ETH index flow without consuming LP inventory for free:

1. `/api/index-quote` sizes an executable LI.FI aggregate route for every required component.
2. The router accepts calls only to the configured LI.FI Diamond.
3. It verifies each component balance delta before minting, then refunds excess ETH/tokens.
4. The reverse path burns an index, swaps every redeemed component, enforces aggregate minimum ETH output and returns ETH to the seller.
5. Pre-existing router dust is excluded from user refunds.

Factory and Router addresses are configured in the UI. Direct Stock Token mint/redemption remains the fail-closed fallback, while individual Stock Token ETH buy/sell uses `/api/swap-quote`.

## Local development

```bash
npm ci
npm test
npm run compile
npm run preflight:mainnet
set -a; . ./.env.local; set +a
npx vercel dev --listen 4173 --yes
```

Open:

- Landing: `http://localhost:4173/`
- App: `http://localhost:4173/ATLAS.html`
- Terminal: `http://localhost:4173/ATLAS.html#terminal`

## Server-side AI

Copy `.env.example` to `.env.local` and configure `OPENAI_API_KEY`. `.env.local` is ignored by Git and must never be committed, served, logged or copied into `ATLAS.html`/client JavaScript.

Default model order:

1. `gpt-4.1-mini`
2. `gpt-4.1-nano`

Fallback occurs only for retryable model/capacity failures. Every OpenAI request uses a strict JSON Schema; a successful response that violates the action contract falls through safely. Authentication, billing and quota-block errors stop immediately instead of wasting calls across every model.

For production, add durable rate limiting/authentication at the platform edge; the included in-memory serverless limit is only a basic local/instance guard.

## Mainnet deployment guard

`npm run deploy:mainnet` refuses to send a transaction unless all of these are present:

- `RH_PRIVATE_KEY`
- non-zero `ATLAS_TREASURY`
- HTTPS `RH_RPC_URL`
- `CONFIRM_MAINNET_DEPLOY=YES_DEPLOY_ROBINHOOD_4663`
- RPC-reported Chain ID exactly `4663`
- bytecode, 18 decimals and a positive ERC-8056 `uiMultiplier()` at every configured canonical Stock Token address
- bytecode at the configured LI.FI Diamond

The guarded deployment compiles both `MainnetIndexFactory` and `MainnetIndexRouter`. Deployment still requires an independent audit and explicit authorization.

No mainnet transaction has been sent from this working tree.

## Authoritative sources

- Network: https://docs.robinhood.com/chain/connecting
- Stock Token contracts: https://docs.robinhood.com/chain/contracts
- Official asset endpoint: https://api.robinhood.com/rhj/assets
- Robinhood trading venues and liquidity: https://docs.robinhood.com/chain/building-with-stock-tokens
- LI.FI supported chains / Robinhood Diamond discovery: https://li.quest/v1/chains
