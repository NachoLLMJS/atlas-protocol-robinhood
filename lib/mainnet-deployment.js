'use strict';

const { ethers } = require('ethers');

const CONFIRMATION = 'YES_DEPLOY_ROBINHOOD_4663';

function validateDeploymentEnvironment(env = process.env) {
  if (env.CONFIRM_MAINNET_DEPLOY !== CONFIRMATION) {
    throw new Error(`Missing mainnet confirmation: CONFIRM_MAINNET_DEPLOY=${CONFIRMATION}`);
  }
  const privateKey = String(env.RH_PRIVATE_KEY || '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('RH_PRIVATE_KEY must be a 32-byte private key.');
  const treasury = String(env.ATLAS_TREASURY || '');
  if (!ethers.isAddress(treasury) || treasury === ethers.ZeroAddress) throw new Error('ATLAS_TREASURY must be a non-zero address.');
  const rpcUrl = String(env.RH_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com');
  if (!/^https:\/\//.test(rpcUrl)) throw new Error('RH_RPC_URL must be an HTTPS URL.');
  return { rpcUrl, privateKey, treasury };
}

function validateCanonicalStockMetadata(symbol, { code, decimals, uiMultiplier }) {
  if (typeof code !== 'string' || code === '0x') throw new Error(`Canonical ${symbol} address has no bytecode.`);
  const normalizedDecimals = Number(decimals);
  if (normalizedDecimals !== 18) throw new Error(`Canonical ${symbol} must use 18 decimals.`);
  const normalizedMultiplier = BigInt(uiMultiplier);
  if (normalizedMultiplier <= 0n) throw new Error(`Canonical ${symbol} returned an invalid uiMultiplier.`);
  return { decimals: normalizedDecimals, uiMultiplier: normalizedMultiplier };
}

async function assertMainnet(provider) {
  const network = await provider.getNetwork();
  if (network.chainId !== 4663n) throw new Error(`Refusing deployment on chain ${network.chainId}; expected 4663.`);
  return network;
}

module.exports = { CONFIRMATION, assertMainnet, validateCanonicalStockMetadata, validateDeploymentEnvironment };
