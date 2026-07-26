'use strict';

const fs = require('fs');
const path = require('path');
const solc = require('solc');
const { ethers } = require('ethers');
const { assertMainnet, validateCanonicalStockMetadata, validateDeploymentEnvironment } = require('../lib/mainnet-deployment');

const ROOT = path.join(__dirname, '..');
const NETWORK_CONFIG = require('../config/robinhood-mainnet.json');

function loadLocalEnv() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function compileArtifacts() {
  const names = ['MainnetIndexFactory.sol', 'MainnetIndexToken.sol', 'MainnetIndexRouter.sol'];
  const sources = Object.fromEntries(names.map(name => [
    `contracts/${name}`,
    { content: fs.readFileSync(path.join(ROOT, 'contracts', name), 'utf8') },
  ]));
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import(importPath) {
      const candidates = [path.join(ROOT, importPath), path.join(ROOT, 'node_modules', importPath)];
      const found = candidates.find(fs.existsSync);
      return found ? { contents: fs.readFileSync(found, 'utf8') } : { error: `Import not found: ${importPath}` };
    },
  }));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  return {
    factory: output.contracts['contracts/MainnetIndexFactory.sol'].MainnetIndexFactory,
    router: output.contracts['contracts/MainnetIndexRouter.sol'].MainnetIndexRouter,
  };
}

function compileFactory() { return compileArtifacts().factory; }

async function verifyNetwork(provider) {
  await assertMainnet(provider);
  const diamondCode = await provider.getCode(NETWORK_CONFIG.integrations.lifiDiamond);
  if (!diamondCode || diamondCode === '0x') throw new Error('LI.FI Diamond has no mainnet bytecode');
  for (const [symbol, stock] of Object.entries(NETWORK_CONFIG.stocks)) {
    const code = await provider.getCode(stock.address);
    const token = new ethers.Contract(stock.address, [
      'function decimals() view returns (uint8)',
      'function uiMultiplier() view returns (uint256)',
    ], provider);
    const [decimals, uiMultiplier] = await Promise.all([token.decimals(), token.uiMultiplier()]);
    validateCanonicalStockMetadata(symbol, { code, decimals, uiMultiplier });
  }
}

async function main() {
  loadLocalEnv();
  const deploy = process.argv.includes('--deploy');
  const provider = new ethers.JsonRpcProvider(process.env.RH_RPC_URL || NETWORK_CONFIG.rpcUrl);
  const artifacts = compileArtifacts();
  await verifyNetwork(provider);

  if (!deploy) {
    console.log(`MAINNET_PREFLIGHT_OK chain=${NETWORK_CONFIG.chainId} stocks=${Object.keys(NETWORK_CONFIG.stocks).length} factoryBytecodeBytes=${artifacts.factory.evm.bytecode.object.length / 2} routerBytecodeBytes=${artifacts.router.evm.bytecode.object.length / 2}`);
    console.log('No transaction sent. Add --deploy only after review, audit, treasury selection and explicit environment confirmation.');
    return;
  }

  const env = validateDeploymentEnvironment(process.env);
  const checkedProvider = new ethers.JsonRpcProvider(env.rpcUrl);
  await verifyNetwork(checkedProvider);
  const wallet = new ethers.Wallet(env.privateKey, checkedProvider);
  const stockAddresses = Object.values(NETWORK_CONFIG.stocks).map(stock => stock.address);
  const factory = await new ethers.ContractFactory(artifacts.factory.abi, `0x${artifacts.factory.evm.bytecode.object}`, wallet)
    .deploy(env.treasury, stockAddresses);
  console.log(`Deployment submitted: ${factory.deploymentTransaction().hash}`);
  await factory.waitForDeployment();
  console.log(`MainnetIndexFactory deployed: ${await factory.getAddress()}`);
  const router = await new ethers.ContractFactory(artifacts.router.abi, `0x${artifacts.router.evm.bytecode.object}`, wallet)
    .deploy(NETWORK_CONFIG.integrations.lifiDiamond);
  console.log(`Router deployment submitted: ${router.deploymentTransaction().hash}`);
  await router.waitForDeployment();
  console.log(`MainnetIndexRouter deployed: ${await router.getAddress()}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`MAINNET_DEPLOYMENT_ABORTED: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { compileArtifacts, compileFactory, verifyNetwork };
