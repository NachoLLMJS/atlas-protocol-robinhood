const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const FACTORY = '0xf920Cd56a8a39a59792103BA45dd5351d31e5f0c';
const ROUTER = '0x606f0599280f2a429895c4D2a040466dD57CeB7A';
const EXPECTED_STOCKS = {
  TSLA: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d',
  AMZN: '0x12f190a9F9d7D37a250758b26824B97CE941bF54',
  NFLX: '0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8',
  AMD: '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC',
  PLTR: '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A',
};

test('mainnet config matches Robinhood official network and RWA deployments', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/robinhood-mainnet.json'), 'utf8'));
  assert.equal(config.chainId, 4663);
  assert.equal(config.chainIdHex, '0x1237');
  assert.equal(config.rpcUrl, 'https://rpc.mainnet.chain.robinhood.com');
  assert.equal(config.explorerUrl, 'https://robinhoodchain.blockscout.com');
  assert.equal(config.nativeCurrency.symbol, 'ETH');
  assert.deepEqual(Object.fromEntries(Object.entries(config.stocks).map(([ticker, stock]) => [ticker, stock.address])), EXPECTED_STOCKS);
  assert.equal(config.atlas.factory, FACTORY);
  assert.equal(config.atlas.router, ROUTER);
  assert.equal(config.integrations.lifiDiamond, '0xB477751B76CF82d00a686A1232f5fCD772414Af3');
  assert.equal(config.atlas.launchReady, false);
});

test('deployment preflight fails closed without every explicit mainnet guard', () => {
  const { validateDeploymentEnvironment } = require('../lib/mainnet-deployment');
  const valid = {
    CONFIRM_MAINNET_DEPLOY: 'YES_DEPLOY_ROBINHOOD_4663',
    RH_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
    ATLAS_TREASURY: '0x0000000000000000000000000000000000000001',
    RH_RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
  };
  assert.throws(() => validateDeploymentEnvironment({}), /confirmation/i);
  assert.throws(() => validateDeploymentEnvironment({ ...valid, RH_PRIVATE_KEY: 'bad' }), /private key/i);
  assert.throws(() => validateDeploymentEnvironment({ ...valid, ATLAS_TREASURY: '0x0000000000000000000000000000000000000000' }), /treasury/i);
  assert.deepEqual(validateDeploymentEnvironment(valid), {
    rpcUrl: valid.RH_RPC_URL,
    privateKey: valid.RH_PRIVATE_KEY,
    treasury: valid.ATLAS_TREASURY,
  });
});

test('canonical stock metadata guard rejects missing bytecode, wrong decimals and invalid ERC-8056 multiplier', () => {
  const { validateCanonicalStockMetadata } = require('../lib/mainnet-deployment');
  assert.deepEqual(validateCanonicalStockMetadata('TSLA', { code: '0x1234', decimals: 18, uiMultiplier: 10n ** 18n }), {
    decimals: 18,
    uiMultiplier: 10n ** 18n,
  });
  assert.throws(() => validateCanonicalStockMetadata('TSLA', { code: '0x', decimals: 18, uiMultiplier: 10n ** 18n }), /bytecode/i);
  assert.throws(() => validateCanonicalStockMetadata('TSLA', { code: '0x1234', decimals: 6, uiMultiplier: 10n ** 18n }), /18 decimals/i);
  assert.throws(() => validateCanonicalStockMetadata('TSLA', { code: '0x1234', decimals: 18, uiMultiplier: 0n }), /uiMultiplier/i);
});

test('Vercel deployment includes package metadata required by serverless functions', () => {
  const ignored = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8');
  assert.doesNotMatch(ignored, /^package(?:-lock)?\.json$/m);
});

test('landing and every app header link to the official ATLAS X account safely', () => {
  const app = fs.readFileSync(path.join(ROOT, 'ATLAS.html'), 'utf8');
  const landing = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const officialX = 'https://x.com/AtlasProtocolRH';

  assert.match(landing, new RegExp(officialX.replace(/[./]/g, '\\$&')));
  assert.match(landing, /target="_blank" rel="noopener noreferrer" aria-label="Follow ATLAS Protocol on X"/);
  assert.match(app, new RegExp(officialX.replace(/[./]/g, '\\$&')));
  assert.match(app, /target="_blank" rel="noopener noreferrer" aria-label="Follow ATLAS Protocol on X"/);
  assert.equal((app.match(/<XButton \/>/g) || []).length, 9);
});

test('landing and app use the transparent ATLAS header mark', () => {
  const app = fs.readFileSync(path.join(ROOT, 'ATLAS.html'), 'utf8');
  const landing = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(landing, /assets\/brand\/atlas-header-mark\.png/);
  assert.match(app, /assets\/brand\/atlas-header-mark\.png/);
  assert.doesNotMatch(app, /atlas-icon-light\.png/);
});

test('public pages contain no Arbitrum branding', () => {
  const app = fs.readFileSync(path.join(ROOT, 'ATLAS.html'), 'utf8');
  const landing = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(app, /arbitrum/i);
  assert.doesNotMatch(landing, /arbitrum/i);
});

test('public pages contain mainnet tokens but no legacy testnet wiring', () => {
  const app = fs.readFileSync(path.join(ROOT, 'ATLAS.html'), 'utf8');
  const landing = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const publicSource = `${app}\n${landing}`;
  for (const address of Object.values(EXPECTED_STOCKS)) assert.match(publicSource, new RegExp(address, 'i'));
  assert.doesNotMatch(publicSource, /rpc\.testnet\.chain\.robinhood|explorer\.testnet\.chain\.robinhood|faucet\.testnet\.chain\.robinhood/i);
  assert.doesNotMatch(publicSource, /46630|0xb626|0xE0136684FaA29801885e1faF619bc5C8894CA35D|0x3130865dE0D1594E38C5cC52596712F05d93a4d5/i);
  assert.match(app, new RegExp(`const FACTORY_ADDRESS = '${FACTORY}'`, 'i'));
  assert.match(app, new RegExp(`const INDEX_ROUTER_ADDRESS = '${ROUTER}'`, 'i'));
  assert.match(app, /const RH_RPC = 'https:\/\/rpc\.mainnet\.chain\.robinhood\.com';/);
});
