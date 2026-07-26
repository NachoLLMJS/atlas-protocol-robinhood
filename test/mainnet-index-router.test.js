const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ganache = require('ganache');
const solc = require('solc');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'contracts/MainnetIndexToken.sol';
const ROUTER = 'contracts/MainnetIndexRouter.sol';
const MOCK_TOKEN = 'test/contracts/MockERC20.sol';
const MOCK_DIAMOND = 'test/contracts/MockSwapDiamond.sol';

function compile() {
  const files = [TOKEN, ROUTER, MOCK_TOKEN, MOCK_DIAMOND];
  const sources = Object.fromEntries(files.map(file => [file, { content: fs.readFileSync(path.join(ROOT, file), 'utf8') }]));
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  }), { import: importPath => {
    const candidates = [path.join(ROOT, importPath), path.join(ROOT, 'node_modules', importPath)];
    const found = candidates.find(candidate => fs.existsSync(candidate));
    return found ? { contents: fs.readFileSync(found, 'utf8') } : { error: `Import not found: ${importPath}` };
  } }));
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
  const provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 7, defaultBalance: 1000 } }));
  const [owner, creator, buyer, treasury, attacker] = await Promise.all([0,1,2,3,4].map(i => provider.getSigner(i)));
  const tokenA = await deploy(contracts, MOCK_TOKEN, 'MockERC20', owner, ['Tesla','TSLA',18]);
  const tokenB = await deploy(contracts, MOCK_TOKEN, 'MockERC20', owner, ['Amazon','AMZN',18]);
  const diamond = await deploy(contracts, MOCK_DIAMOND, 'MockSwapDiamond', owner);
  const index = await deploy(contracts, TOKEN, 'MainnetIndexToken', owner, [
    'Mainnet Basket','MBASK',[await tokenA.getAddress(), await tokenB.getAddress()],[6000,4000],await creator.getAddress(),100,await treasury.getAddress(),
  ]);
  const router = await deploy(contracts, ROUTER, 'MainnetIndexRouter', owner, [await diamond.getAddress()]);
  await (await tokenA.mint(await diamond.getAddress(), ethers.parseEther('1000'))).wait();
  await (await tokenB.mint(await diamond.getAddress(), ethers.parseEther('1000'))).wait();
  await (await owner.sendTransaction({ to: await diamond.getAddress(), value: ethers.parseEther('100') })).wait();
  return { contracts, provider, owner, creator, buyer, treasury, attacker, tokenA, tokenB, diamond, index, router };
}

function buyCalls(f, outputA = '0.6', outputB = '0.4') {
  const iface = f.diamond.interface;
  return Promise.all([
    f.tokenA.getAddress().then(token => ({ target: f.diamond.target, value: ethers.parseEther('1'), data: iface.encodeFunctionData('swapETHForToken',[token,ethers.parseEther(outputA)]) })),
    f.tokenB.getAddress().then(token => ({ target: f.diamond.target, value: ethers.parseEther('1'), data: iface.encodeFunctionData('swapETHForToken',[token,ethers.parseEther(outputB)]) })),
  ]);
}

test('one transaction charges ETH, acquires every component and mints the index to the buyer', async () => {
  const f = await fixture();
  const calls = await buyCalls(f);
  await (await f.router.connect(f.buyer).mintIndexWithETH(await f.index.getAddress(), ethers.parseEther('1'), calls, { value: ethers.parseEther('2') })).wait();
  assert.equal(await f.index.balanceOf(await f.buyer.getAddress()), ethers.parseEther('0.99'));
  assert.equal(await f.index.balanceOf(await f.creator.getAddress()), ethers.parseEther('0.005'));
  assert.equal(await f.index.balanceOf(await f.treasury.getAddress()), ethers.parseEther('0.005'));
  assert.equal(await f.tokenA.balanceOf(await f.index.getAddress()), ethers.parseEther('0.6'));
  assert.equal(await f.tokenB.balanceOf(await f.index.getAddress()), ethers.parseEther('0.4'));
  assert.equal(await f.provider.getBalance(await f.router.getAddress()), 0n);
});

test('cannot mint for free, use a different target or under-deliver collateral', async () => {
  const f = await fixture();
  const calls = await buyCalls(f);
  await assert.rejects(f.router.connect(f.buyer).mintIndexWithETH(await f.index.getAddress(), ethers.parseEther('1'), calls, { value: 0 }));
  const wrongTarget = calls.map((call, i) => i ? call : { ...call, target: awaitAddress(f.attacker) });
  await assert.rejects(f.router.connect(f.buyer).mintIndexWithETH(await f.index.getAddress(), ethers.parseEther('1'), wrongTarget, { value: ethers.parseEther('2') }));
  const short = await buyCalls(f, '0.59', '0.4');
  await assert.rejects(f.router.connect(f.buyer).mintIndexWithETH(await f.index.getAddress(), ethers.parseEther('1'), short, { value: ethers.parseEther('2') }));
});

async function awaitAddress(signer) { return signer.getAddress(); }

test('burns an index and atomically converts its redeemed components back to ETH', async () => {
  const f = await fixture();
  await (await f.router.connect(f.buyer).mintIndexWithETH(await f.index.getAddress(), ethers.parseEther('1'), await buyCalls(f), { value: ethers.parseEther('2') })).wait();
  const indexAmount = ethers.parseEther('0.99');
  await (await f.index.connect(f.buyer).approve(await f.router.getAddress(), indexAmount)).wait();
  const iface = f.diamond.interface;
  const sellCalls = [
    { target: f.diamond.target, value: 0, data: iface.encodeFunctionData('swapTokenForETH',[await f.tokenA.getAddress(),ethers.parseEther('0.594'),ethers.parseEther('0.5')]) },
    { target: f.diamond.target, value: 0, data: iface.encodeFunctionData('swapTokenForETH',[await f.tokenB.getAddress(),ethers.parseEther('0.396'),ethers.parseEther('0.3')]) },
  ];
  const tx = await f.router.connect(f.buyer).sellIndexForETH(await f.index.getAddress(), indexAmount, sellCalls, ethers.parseEther('0.8'));
  const receipt = await tx.wait();
  const event = receipt.logs.map(log => { try { return f.router.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === 'IndexSoldForETH');
  assert.equal(event.args.ethAmount, ethers.parseEther('0.8'));
  assert.equal(await f.index.balanceOf(await f.buyer.getAddress()), 0n);
  assert.equal(await f.index.totalSupply(), ethers.parseEther('0.01'));
  assert.equal(await f.provider.getBalance(await f.router.getAddress()), 0n);
});

test('pre-existing dust in the router cannot be claimed by a buyer', async () => {
  const f = await fixture();
  const dust = ethers.parseEther('3');
  await (await f.tokenA.mint(await f.router.getAddress(), dust)).wait();
  await (await f.router.connect(f.buyer).mintIndexWithETH(await f.index.getAddress(), ethers.parseEther('1'), await buyCalls(f), { value: ethers.parseEther('2') })).wait();
  assert.equal(await f.tokenA.balanceOf(await f.router.getAddress()), dust);
});
