const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.join(__dirname, '..');
const INDICES = [
  { address: '0x1111111111111111111111111111111111111111', symbol: '$TECH', name: 'Tech Index', stocks: ['TSLA', 'AMD'] },
  { address: '0x2222222222222222222222222222222222222222', symbol: '$GROW', name: 'Growth Index', stocks: ['AMZN', 'PLTR'] },
];

test('missing or unknown index ticker becomes a deterministic clickable selection', () => {
  const { buildIndexChoice } = require('../lib/atlas-index-selection');

  const missing = buildIndexChoice({ action: 'buy_index', data: { indexTicker: null, qty: 2 } }, INDICES);
  assert.equal(missing.action, 'buy_index');
  assert.equal(missing.selectedAddress, null);
  assert.equal(missing.quantity, '2');
  assert.deepEqual(missing.indices.map(index => index.symbol), ['$TECH', '$GROW']);

  const unknown = buildIndexChoice({ action: 'sell_index', data: { indexTicker: 'WRONG', qty: 1 } }, INDICES);
  assert.equal(unknown.selectedAddress, null);
  assert.equal(unknown.indices.length, 2);
});

test('known index with missing quantity keeps the index selected and requests only an amount', () => {
  const { buildIndexChoice } = require('../lib/atlas-index-selection');
  const choice = buildIndexChoice({ action: 'buy_index', data: { indexTicker: 'tech', qty: null } }, INDICES);
  assert.equal(choice.selectedAddress, INDICES[0].address);
  assert.equal(choice.quantity, '');
});

test('clicking an index and entering an amount resolves an exact action without another AI call', () => {
  const { buildIndexChoice, resolveIndexChoice } = require('../lib/atlas-index-selection');
  const choice = buildIndexChoice({ action: 'buy_index', data: { indexTicker: null, qty: null } }, INDICES);
  const resolved = resolveIndexChoice(choice, INDICES[1].address, '1.5');
  assert.equal(resolved.action, 'buy_index');
  assert.equal(resolved.data.indexTicker, '$GROW');
  assert.equal(resolved.data.qty, 1.5);
  assert.equal(resolved.data.index.address, INDICES[1].address);
  assert.throws(() => resolveIndexChoice(choice, INDICES[1].address, '0'), /positive amount/i);
});

test('terminal renders index choices as buttons and resolves them locally', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'ATLAS.html'), 'utf8');
  assert.match(html, /m\.type === 'index-select'/);
  assert.match(html, /index-choice-btn/);
  assert.match(html, /\.index-select-wrap \.confirm-btn/);
  assert.match(html, /resolveIndexChoice/);
  assert.match(html, /Select an index/);
});
