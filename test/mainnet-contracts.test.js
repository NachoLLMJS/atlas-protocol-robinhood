const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ganache = require('ganache');
const solc = require('solc');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const MAINNET_TOKEN = 'contracts/MainnetIndexToken.sol';
const MAINNET_FACTORY = 'contracts/MainnetIndexFactory.sol';
const MOCK_TOKEN = 'test/contracts/MockERC20.sol';

function compile() {
  const sources = Object.fromEntries([MAINNET_TOKEN, MAINNET_FACTORY, MOCK_TOKEN].map(file => [file, {
    content: fs.readFileSync(path.join(ROOT, file), 'utf8'),
  }]));
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      evmVersion: 'shanghai',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import: importPath => {
      const candidates = [path.join(ROOT, importPath), path.join(ROOT, 'node_modules', importPath)];
      const found = candidates.find(candidate => fs.existsSync(candidate));
      return found ? { contents: fs.readFileSync(found, 'utf8') } : { error: `Import not found: ${importPath}` };
    },
  }));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  assert.deepEqual(errors, [], errors.map(error => error.formattedMessage).join('\n'));
  return output.contracts;
}

async function deploy(contracts, file, name, signer, args = []) {
  const artifact = contracts[file][name];
  const factory = new ethers.ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function fixture() {
  const contracts = compile();
  const eip1193 = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 8 } });
  const provider = new ethers.BrowserProvider(eip1193);
  const [owner, creator, buyer, treasury, outsider] = await Promise.all([0, 1, 2, 3, 4].map(index => provider.getSigner(index)));
  const tokenA = await deploy(contracts, MOCK_TOKEN, 'MockERC20', owner, ['Tesla', 'TSLA', 18]);
  const tokenB = await deploy(contracts, MOCK_TOKEN, 'MockERC20', owner, ['Amazon', 'AMZN', 18]);
  const factory = await deploy(contracts, MAINNET_FACTORY, 'MainnetIndexFactory', owner, [
    await treasury.getAddress(),
    [await tokenA.getAddress(), await tokenB.getAddress()],
  ]);
  return { contracts, provider, owner, creator, buyer, treasury, outsider, tokenA, tokenB, factory };
}

async function createIndex(f, stocks = [f.tokenA, f.tokenB]) {
  const addresses = await Promise.all(stocks.map(stock => stock.getAddress()));
  const connected = f.factory.connect(f.creator);
  const args = ['Mainnet Basket', 'MBASK', addresses, [6000, 4000], 100];
  const address = await connected.createIndex.staticCall(...args);
  await (await connected.createIndex(...args)).wait();
  const artifact = f.contracts[MAINNET_TOKEN].MainnetIndexToken;
  return new ethers.Contract(address, artifact.abi, f.provider);
}

test('direct mint is fully collateralized and splits immutable fees', async () => {
  const f = await fixture();
  const index = await createIndex(f);
  const amount = ethers.parseEther('1');
  const requiredA = ethers.parseEther('0.6');
  const requiredB = ethers.parseEther('0.4');
  const buyerAddress = await f.buyer.getAddress();

  await (await f.tokenA.mint(buyerAddress, requiredA)).wait();
  await (await f.tokenB.mint(buyerAddress, requiredB)).wait();
  await (await f.tokenA.connect(f.buyer).approve(await index.getAddress(), requiredA)).wait();
  await (await f.tokenB.connect(f.buyer).approve(await index.getAddress(), requiredB)).wait();
  await (await index.connect(f.buyer).mint(amount)).wait();

  assert.equal(await f.tokenA.balanceOf(await index.getAddress()), requiredA);
  assert.equal(await f.tokenB.balanceOf(await index.getAddress()), requiredB);
  assert.equal(await index.balanceOf(buyerAddress), ethers.parseEther('0.99'));
  assert.equal(await index.balanceOf(await f.creator.getAddress()), ethers.parseEther('0.005'));
  assert.equal(await index.balanceOf(await f.treasury.getAddress()), ethers.parseEther('0.005'));
  assert.equal(await index.totalSupply(), amount);
});

test('burn returns the deterministic underlying basket', async () => {
  const f = await fixture();
  const index = await createIndex(f);
  const buyerAddress = await f.buyer.getAddress();
  await (await f.tokenA.mint(buyerAddress, ethers.parseEther('0.6'))).wait();
  await (await f.tokenB.mint(buyerAddress, ethers.parseEther('0.4'))).wait();
  await (await f.tokenA.connect(f.buyer).approve(await index.getAddress(), ethers.MaxUint256)).wait();
  await (await f.tokenB.connect(f.buyer).approve(await index.getAddress(), ethers.MaxUint256)).wait();
  await (await index.connect(f.buyer).mint(ethers.parseEther('1'))).wait();
  await (await index.connect(f.buyer).burn(ethers.parseEther('0.99'))).wait();

  assert.equal(await f.tokenA.balanceOf(buyerAddress), ethers.parseEther('0.594'));
  assert.equal(await f.tokenB.balanceOf(buyerAddress), ethers.parseEther('0.396'));
  assert.equal(await index.totalSupply(), ethers.parseEther('0.01'));
});

test('donations remain surplus and cannot be captured through mint and burn', async () => {
  const f = await fixture();
  const index = await createIndex(f);
  const indexAddress = await index.getAddress();
  const buyerAddress = await f.buyer.getAddress();

  await (await f.tokenA.mint(buyerAddress, ethers.parseEther('0.6'))).wait();
  await (await f.tokenB.mint(buyerAddress, ethers.parseEther('0.4'))).wait();
  await (await f.tokenA.connect(f.buyer).approve(indexAddress, ethers.MaxUint256)).wait();
  await (await f.tokenB.connect(f.buyer).approve(indexAddress, ethers.MaxUint256)).wait();
  await (await index.connect(f.buyer).mint(ethers.parseEther('1'))).wait();

  await (await f.tokenA.mint(indexAddress, ethers.parseEther('6'))).wait();
  await (await f.tokenB.mint(indexAddress, ethers.parseEther('4'))).wait();
  await (await index.connect(f.buyer).burn(ethers.parseEther('0.99'))).wait();

  assert.equal(await f.tokenA.balanceOf(buyerAddress), ethers.parseEther('0.594'));
  assert.equal(await f.tokenB.balanceOf(buyerAddress), ethers.parseEther('0.396'));
  assert.equal(await f.tokenA.balanceOf(indexAddress), ethers.parseEther('6.006'));
  assert.equal(await f.tokenB.balanceOf(indexAddress), ethers.parseEther('4.004'));
});

test('factory rejects fake, duplicate, zero-weight and malformed baskets', async () => {
  const f = await fixture();
  const fake = await deploy(f.contracts, MOCK_TOKEN, 'MockERC20', f.outsider, ['Fake Tesla', 'TSLA', 18]);
  const valid = await f.tokenA.getAddress();
  const invalid = await fake.getAddress();
  const create = (...args) => f.factory.connect(f.creator).createIndex(...args);

  await assert.rejects(create('Fake', 'FAKE', [valid, invalid], [5000, 5000], 30));
  await assert.rejects(create('Duplicate', 'DUP', [valid, valid], [5000, 5000], 30));
  await assert.rejects(create('Bad weights', 'BAD', [await f.tokenA.getAddress(), await f.tokenB.getAddress()], [10000, 0], 30));
  await assert.rejects(create('', '', [await f.tokenA.getAddress(), await f.tokenB.getAddress()], [5000, 5000], 30));
});

test('only the owner can change the canonical stock allowlist or treasury', async () => {
  const f = await fixture();
  const fake = await deploy(f.contracts, MOCK_TOKEN, 'MockERC20', f.outsider, ['New Canonical', 'NEW', 18]);
  const fakeAddress = await fake.getAddress();

  await assert.rejects(f.factory.connect(f.outsider).setStockAllowed(fakeAddress, true));
  await (await f.factory.setStockAllowed(fakeAddress, true)).wait();
  assert.equal(await f.factory.allowedStock(fakeAddress), true);
  const wrongDecimals = await deploy(f.contracts, MOCK_TOKEN, 'MockERC20', f.outsider, ['Wrong decimals', 'BAD6', 6]);
  await assert.rejects(f.factory.setStockAllowed(await wrongDecimals.getAddress(), true));
  await assert.rejects(f.factory.setStockAllowed(await f.outsider.getAddress(), true));
  await assert.rejects(f.factory.connect(f.outsider).setTreasury(await f.outsider.getAddress()));
  await assert.rejects(f.factory.setTreasury(ethers.ZeroAddress));
});
