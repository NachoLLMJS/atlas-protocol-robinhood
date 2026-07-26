const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const WALLET = '0x1111111111111111111111111111111111111111';
const TSLA = '0x322F0929c4625eD5bAd873c95208D54E1c003b2d';
const NATIVE = '0x0000000000000000000000000000000000000000';
const DIAMOND = '0xB477751B76CF82d00a686A1232f5fCD772414Af3';

function response(payload) {
  return { ok: true, status: 200, async json() { return payload; } };
}

function providerQuote({ fromToken = NATIVE, toToken = TSLA, fromAmount = '1000000000000000', value = '0x38d7ea4c68000', to = DIAMOND } = {}) {
  return {
    id: 'quote-id', tool: 'fly',
    action: { fromChainId: 4663, toChainId: 4663, fromToken: { address: fromToken }, toToken: { address: toToken }, fromAmount, fromAddress: WALLET, toAddress: WALLET, slippage: 0.005 },
    estimate: { fromAmount, toAmount: '6062355493594767', toAmountMin: '6032043716126793', approvalAddress: DIAMOND, feeCosts: [], gasCosts: [] },
    transactionRequest: { to, from: WALLET, chainId: 4663, value, data: '0x12345678', gasLimit: '0xc90fe' },
  };
}

test('creates and validates an ETH to canonical Stock Token quote', async () => {
  const { createAtlasSwapQuote } = require('../lib/atlas-swap');
  let requested;
  const quote = createAtlasSwapQuote({ fetchImpl: async url => { requested = new URL(url); return response(providerQuote()); } });
  const result = await quote({ side: 'buy', ticker: 'TSLA', amount: '1000000000000000', wallet: WALLET });
  assert.equal(requested.searchParams.get('fromChain'), '4663');
  assert.equal(requested.searchParams.get('fromToken'), NATIVE);
  assert.equal(requested.searchParams.get('toToken').toLowerCase(), TSLA.toLowerCase());
  assert.equal(result.transaction.to, DIAMOND);
  assert.equal(result.transaction.value, '0x38d7ea4c68000');
  assert.equal(result.toAmountMin, '6032043716126793');
});

test('creates a canonical Stock Token to ETH quote for selling', async () => {
  const { createAtlasSwapQuote } = require('../lib/atlas-swap');
  const payload = providerQuote({ fromToken: TSLA, toToken: NATIVE, fromAmount: '10000000000000000', value: '0x0' });
  const quote = createAtlasSwapQuote({ fetchImpl: async () => response(payload) });
  const result = await quote({ side: 'sell', ticker: 'TSLA', amount: '10000000000000000', wallet: WALLET });
  assert.equal(result.approvalAddress, DIAMOND);
  assert.equal(result.transaction.value, '0x0');
});

test('rejects quote-provider output that changes chain, asset, recipient or transaction target', async () => {
  const { createAtlasSwapQuote } = require('../lib/atlas-swap');
  for (const payload of [
    { ...providerQuote(), transactionRequest: { ...providerQuote().transactionRequest, to: '0x2222222222222222222222222222222222222222' } },
    { ...providerQuote(), action: { ...providerQuote().action, toChainId: 1 } },
    { ...providerQuote(), action: { ...providerQuote().action, toAddress: '0x2222222222222222222222222222222222222222' } },
    providerQuote({ toToken: '0x2222222222222222222222222222222222222222' }),
  ]) {
    const quote = createAtlasSwapQuote({ fetchImpl: async () => response(payload) });
    await assert.rejects(() => quote({ side: 'buy', ticker: 'TSLA', amount: '1000000000000000', wallet: WALLET }), /invalid quote/i);
  }
});

test('stock UI requests validated quotes, approves sells and submits the returned transaction', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ATLAS.html'), 'utf8');
  assert.match(html, /fetch\(['"]\/api\/swap-quote['"]/);
  assert.match(html, /underlying\.approve\(quote\.approvalAddress, rawAmount\)/);
  assert.match(html, /wallet\.signer\.sendTransaction\(quote\.transaction\)/);
  assert.match(html, /Buy with ETH/);
  assert.match(html, /Sell for ETH/);
});

test('rejects unsupported tickers, invalid wallets and unsafe amounts before provider access', async () => {
  const { createAtlasSwapQuote } = require('../lib/atlas-swap');
  let calls = 0;
  const quote = createAtlasSwapQuote({ fetchImpl: async () => { calls += 1; return response(providerQuote()); } });
  await assert.rejects(() => quote({ side: 'buy', ticker: 'FAKE', amount: '1', wallet: WALLET }), /ticker/i);
  await assert.rejects(() => quote({ side: 'buy', ticker: 'TSLA', amount: '0', wallet: WALLET }), /amount/i);
  await assert.rejects(() => quote({ side: 'buy', ticker: 'TSLA', amount: '1', wallet: 'bad' }), /wallet/i);
  assert.equal(calls, 0);
});
