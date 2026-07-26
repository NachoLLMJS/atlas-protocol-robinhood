const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ONE = 10n ** 18n;

test('converts raw Stock Token units to ERC-8056 underlying-share units', () => {
  const { rawToUiUnits } = require('../stock-token-units');
  assert.equal(rawToUiUnits(3n * ONE, ONE), 3n * ONE);
  assert.equal(rawToUiUnits(3n * ONE, 2n * ONE), 6n * ONE);
  assert.equal(rawToUiUnits(4n * ONE, ONE / 2n), 2n * ONE);
});

test('converts UI share units back to raw units and rounds required collateral up', () => {
  const { uiToRawUnits } = require('../stock-token-units');
  assert.equal(uiToRawUnits(6n * ONE, 2n * ONE), 3n * ONE);
  assert.equal(uiToRawUnits(1n, 3n), 333333333333333334n);
});

test('frontend loads ERC-8056 unit conversion and applies uiMultiplier to Stock Token balances', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ATLAS.html'), 'utf8');
  assert.match(html, /<script[^>]+stock-token-units\.js/);
  assert.match(html, /function uiMultiplier\(\) view returns \(uint256\)/);
  assert.match(html, /StockTokenUnits\.rawToUiUnits\(bal, multiplier\)/);
  assert.match(html, /StockTokenUnits\.uiToRawUnits\(uiAmount, multiplier\)/);
  assert.match(html, /STOCK_UI_MULTIPLIERS\[s\.ticker\] = multiplier/);
});

test('rejects invalid negative amounts and zero multipliers', () => {
  const { rawToUiUnits, uiToRawUnits } = require('../stock-token-units');
  assert.throws(() => rawToUiUnits(-1n, ONE), /non-negative/);
  assert.throws(() => rawToUiUnits(1n, 0n), /positive/);
  assert.throws(() => uiToRawUnits(1n, 0n), /positive/);
});
