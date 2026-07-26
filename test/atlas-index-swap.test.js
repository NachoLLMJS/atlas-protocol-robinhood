const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROUTER = '0x3333333333333333333333333333333333333333';
const INDEX = '0x4444444444444444444444444444444444444444';
const DIAMOND = '0xB477751B76CF82d00a686A1232f5fCD772414Af3';

function quote(side, ticker, fromAmount, rate) {
  const output = BigInt(fromAmount) * BigInt(rate);
  return {
    side, ticker, fromAmount: String(fromAmount), toAmount: output.toString(), toAmountMin: (output * 995n / 1000n).toString(),
    approvalAddress: DIAMOND,
    transaction: { to: DIAMOND, from: ROUTER, chainId: 4663, value: side === 'buy' ? `0x${BigInt(fromAmount).toString(16)}` : '0x0', data: '0x12345678' },
  };
}

test('sizes ETH component quotes until every minimum output collateralizes the requested index mint', async () => {
  const { createIndexSwapPlanner } = require('../lib/atlas-index-swap');
  const calls = [];
  const planner = createIndexSwapPlanner({ quoteStock: async input => {
    calls.push(input);
    return quote('buy', input.ticker, input.amount, input.ticker === 'TSLA' ? 2 : 4);
  }});
  const plan = await planner.planBuy({
    indexAddress: INDEX, grossAmount: '1000000000000000000', router: ROUTER,
    components: [
      { ticker:'TSLA', requiredRaw:'600000000000000000' },
      { ticker:'AMZN', requiredRaw:'400000000000000000' },
    ],
  });
  assert.equal(plan.side, 'buy');
  assert.equal(plan.swaps.length, 2);
  assert.ok(BigInt(plan.totalETH) > 0n);
  assert.ok(BigInt(plan.swaps[0].minimumOutput) >= 600000000000000000n);
  assert.ok(BigInt(plan.swaps[1].minimumOutput) >= 400000000000000000n);
  assert.equal(plan.swaps[0].call.target, DIAMOND);
  assert.ok(calls.length >= 4, 'planner should refine initial quotes');
});

test('builds exact-input component sales and aggregates conservative ETH output', async () => {
  const { createIndexSwapPlanner } = require('../lib/atlas-index-swap');
  const planner = createIndexSwapPlanner({ quoteStock: async input => quote('sell', input.ticker, input.amount, 3) });
  const plan = await planner.planSell({
    indexAddress: INDEX, indexAmount:'990000000000000000', router:ROUTER,
    components:[
      {ticker:'TSLA',redeemRaw:'594000000000000000'},
      {ticker:'AMZN',redeemRaw:'396000000000000000'},
    ],
  });
  assert.equal(plan.side, 'sell');
  assert.equal(plan.swaps[0].call.value, '0x0');
  assert.equal(BigInt(plan.minimumETH), plan.swaps.reduce((sum, swap) => sum + BigInt(swap.minimumOutput), 0n));
});

test('frontend is wired for atomic ETH index purchases and ETH redemptions after router deployment', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ATLAS.html'), 'utf8');
  assert.match(html, /fetch\(['"]\/api\/index-quote['"]/);
  assert.match(html, /router\.mintIndexWithETH\(/);
  assert.match(html, /router\.sellIndexForETH\(/);
  assert.match(html, /const INDEX_ROUTER_ADDRESS = '0x606f0599280f2a429895c4D2a040466dD57CeB7A';/i);
});

test('index quote API uses deterministic redemption units instead of distributing arbitrary balances', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'index-quote.js'), 'utf8');
  assert.match(source, /redeemUnderlying/);
  assert.doesNotMatch(source, /balanceOf\(indexAddress\).*amount.*totalSupply/s);
});

test('rejects malformed plans and quotes that target a different router or cannot deliver collateral', async () => {
  const { createIndexSwapPlanner } = require('../lib/atlas-index-swap');
  const badTargetPlanner = createIndexSwapPlanner({ quoteStock: async input => ({ ...quote('buy', input.ticker, input.amount, 2), transaction:{...quote('buy',input.ticker,input.amount,2).transaction,from:'0x5555555555555555555555555555555555555555'} }) });
  await assert.rejects(() => badTargetPlanner.planBuy({ indexAddress:INDEX,grossAmount:'1',router:ROUTER,components:[{ticker:'TSLA',requiredRaw:'1'},{ticker:'AMZN',requiredRaw:'1'}] }), /router/i);
  const noLiquidity = createIndexSwapPlanner({ quoteStock: async input => quote('buy', input.ticker, input.amount, 0) });
  await assert.rejects(() => noLiquidity.planBuy({ indexAddress:INDEX,grossAmount:'1',router:ROUTER,components:[{ticker:'TSLA',requiredRaw:'1'},{ticker:'AMZN',requiredRaw:'1'}] }), /liquidity|output/i);
  await assert.rejects(() => noLiquidity.planSell({ indexAddress:'bad',indexAmount:'1',router:ROUTER,components:[] }), /address|components/i);
});
