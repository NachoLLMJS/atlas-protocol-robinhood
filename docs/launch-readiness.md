# ATLAS mainnet launch readiness

Status: **MAINNET DEPLOYED — UNAUDITED; DO NOT TREAT AS PRODUCTION-SAFE**

## Completed and locally verified

- Robinhood Chain mainnet configuration (`4663` / `0x1237`)
- Canonical TSLA, AMZN, NFLX, AMD and PLTR contract addresses
- On-chain bytecode, 18 decimals and positive ERC-8056 `uiMultiplier()` preflight
- ERC-8056-adjusted portfolio balances and Stock Token transfers
- Direct-collateralized index mint and deterministic burn/redemption contracts; accidental donations remain explicit surplus
- Live LI.FI aggregate ETH quotes verified for all five canonical Stock Tokens; direct on-chain liquidity independently verified across Uniswap V3 and Sheriff/Algebra
- Atomic `MainnetIndexRouter` implementation and local tests for ETH→basket→index and index→basket→ETH
- Router rejects unpaid, wrong-target and under-collateralized purchases and protects pre-existing dust
- Canonical-token allowlist and two-step Factory ownership
- Fail-closed deployment command and exact mainnet confirmation phrase
- Server-side ModelArk proxy; no AI provider credential in browser code
- Invalid AI JSON falls back safely; Seed 2.0 Lite uses strict JSON Schema
- Vulnerable legacy AtlasVault/StockPaymentVault excluded from mainnet; real routing replaces their UX without free LP collateral
- Factory deployed at `0xf920Cd56a8a39a59792103BA45dd5351d31e5f0c` (tx `0x221d33657503d3825e58c73a8d2b897153154c756ba4a9baf11d0e221c25d64e`)
- Router deployed at `0x606f0599280f2a429895c4D2a040466dD57CeB7A` (tx `0x9606beab5b9cc4d9b7b19c2a2d581c5145cd80cc718a8cc05306f6976023228f`)

## External blockers requiring the owner

1. **Rotate the exposed ModelArk credential.** Create a replacement in BytePlus and install it directly in the private server/Vercel environment. Do not paste it into chat or Git.
2. **Resolve BytePlus `AccountOverdueError`.** Inference remains unavailable until the account/billing state is fixed.
3. **Migrate treasury/ownership to a Safe multisig.** The initial deployer currently owns the Factory and receives treasury fees; document owners and threshold, test recovery, then use `Ownable2Step`.
4. **Independent smart-contract audit.** Include economic invariants, fee accounting, raw/UI units, rounding, transfer restrictions, fee-on-transfer behavior and corporate actions.
5. **Legal/compliance review.** Robinhood Stock Tokens are jurisdiction-restricted debt instruments and not legal ownership of the referenced shares.
6. **Production RPC.** Replace the public rate-limited RPC with a private production provider before launch.
7. **Post-deployment operations.** Verify source on Blockscout, transfer ownership to the multisig and read every role/address back on-chain.

## Remaining engineering hardening before public production

- Replace browser-time Babel/CDN compilation with a pinned production build and Content Security Policy.
- Add durable distributed rate limiting and abuse protection to `/api/chat`, `/api/swap-quote` and `/api/index-quote`.
- Add fork tests against Robinhood Chain, including real LI.FI Diamond calldata, quote expiry and route changes; add fuzz/property tests for router and mint/burn rounding.
- Test scheduled `newUIMultiplier()` / `effectiveAt()` corporate-action transitions.
- Add monitoring for canonical registry changes, multiplier changes, RPC health and contract events.
- Remove dev-only Ganache/Solc packages from any production runtime image. Their transitive development dependency tree still has unresolved npm advisories; do not use those packages in request-serving code.

Factory and Router are live on Robinhood Chain Mainnet. No index has been created yet. Mainnet deployment does not replace audit, legal review or operational hardening.
