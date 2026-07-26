'use strict';

const { ethers } = require('ethers');
const network = require('../config/robinhood-mainnet.json');

const CHAIN_ID = 4663;
const NATIVE_TOKEN = ethers.ZeroAddress;
const LIFI_QUOTE_URL = network.integrations.quoteApi;
const LIFI_DIAMOND = ethers.getAddress(network.integrations.lifiDiamond);
const STOCKS = Object.freeze(Object.fromEntries(
  Object.entries(network.stocks).map(([ticker, stock]) => [ticker, ethers.getAddress(stock.address)]),
));

class AtlasSwapError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AtlasSwapError';
    this.code = code;
    this.status = status;
  }
}

function sameAddress(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

function invalidQuote(reason) {
  throw new AtlasSwapError('INVALID_SWAP_QUOTE', `Invalid quote provider response: ${reason}`, 502);
}

function validateInput(input = {}) {
  const side = String(input.side || '').toLowerCase();
  if (!['buy', 'sell'].includes(side)) throw new AtlasSwapError('INVALID_SWAP_REQUEST', 'Side must be buy or sell.');
  const ticker = String(input.ticker || '').toUpperCase();
  const stock = STOCKS[ticker];
  if (!stock) throw new AtlasSwapError('INVALID_SWAP_REQUEST', 'Unsupported Stock Token ticker.');
  const wallet = String(input.wallet || '');
  if (!ethers.isAddress(wallet) || wallet === ethers.ZeroAddress) throw new AtlasSwapError('INVALID_SWAP_REQUEST', 'Invalid wallet address.');
  const amountText = String(input.amount || '');
  if (!/^[0-9]+$/.test(amountText)) throw new AtlasSwapError('INVALID_SWAP_REQUEST', 'Amount must be a positive integer in raw units.');
  const amount = BigInt(amountText);
  if (amount <= 0n || amount > ethers.MaxUint256) throw new AtlasSwapError('INVALID_SWAP_REQUEST', 'Amount is outside the supported range.');
  return { side, ticker, stock, wallet: ethers.getAddress(wallet), amount: amountText };
}

function sanitizeQuote(payload, expected) {
  const action = payload?.action || {};
  const estimate = payload?.estimate || {};
  const tx = payload?.transactionRequest || {};
  const fromToken = expected.side === 'buy' ? NATIVE_TOKEN : expected.stock;
  const toToken = expected.side === 'buy' ? expected.stock : NATIVE_TOKEN;

  if (Number(action.fromChainId) !== CHAIN_ID || Number(action.toChainId) !== CHAIN_ID || Number(tx.chainId) !== CHAIN_ID) invalidQuote('wrong chain');
  if (!sameAddress(action.fromToken?.address, fromToken) || !sameAddress(action.toToken?.address, toToken)) invalidQuote('wrong asset');
  if (!sameAddress(action.fromAddress, expected.wallet) || !sameAddress(action.toAddress, expected.wallet) || !sameAddress(tx.from, expected.wallet)) invalidQuote('wrong wallet or recipient');
  if (String(action.fromAmount) !== expected.amount || String(estimate.fromAmount) !== expected.amount) invalidQuote('wrong input amount');
  if (!sameAddress(tx.to, LIFI_DIAMOND) || !sameAddress(estimate.approvalAddress, LIFI_DIAMOND)) invalidQuote('untrusted execution target');
  if (typeof tx.data !== 'string' || !/^0x[0-9a-f]+$/i.test(tx.data) || tx.data.length < 10) invalidQuote('missing calldata');

  let value;
  try { value = BigInt(tx.value || '0'); } catch { invalidQuote('invalid transaction value'); }
  if (expected.side === 'buy' ? value !== BigInt(expected.amount) : value !== 0n) invalidQuote('wrong transaction value');

  const toAmount = String(estimate.toAmount || '');
  const toAmountMin = String(estimate.toAmountMin || '');
  if (!/^[0-9]+$/.test(toAmount) || !/^[0-9]+$/.test(toAmountMin) || BigInt(toAmountMin) <= 0n || BigInt(toAmount) < BigInt(toAmountMin)) invalidQuote('invalid output amount');

  return {
    quoteId: String(payload.id || '').slice(0, 200),
    tool: String(payload.tool || '').slice(0, 50),
    side: expected.side,
    ticker: expected.ticker,
    fromAmount: expected.amount,
    toAmount,
    toAmountMin,
    approvalAddress: ethers.getAddress(estimate.approvalAddress),
    transaction: {
      to: ethers.getAddress(tx.to),
      from: expected.wallet,
      chainId: CHAIN_ID,
      value: `0x${value.toString(16)}`,
      data: tx.data,
      ...(tx.gasLimit ? { gasLimit: tx.gasLimit } : {}),
    },
  };
}

function createAtlasSwapQuote({ fetchImpl = globalThis.fetch, quoteUrl = LIFI_QUOTE_URL } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required');
  return async function getAtlasSwapQuote(input) {
    const expected = validateInput(input);
    const fromToken = expected.side === 'buy' ? NATIVE_TOKEN : expected.stock;
    const toToken = expected.side === 'buy' ? expected.stock : NATIVE_TOKEN;
    const params = new URLSearchParams({
      fromChain: String(CHAIN_ID),
      toChain: String(CHAIN_ID),
      fromToken,
      toToken,
      fromAmount: expected.amount,
      fromAddress: expected.wallet,
      toAddress: expected.wallet,
      slippage: '0.005',
    });

    let response;
    try {
      response = await fetchImpl(`${quoteUrl}?${params}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'ATLAS-Protocol/0.1' },
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(15000) : undefined,
      });
    } catch {
      throw new AtlasSwapError('SWAP_QUOTE_UNAVAILABLE', 'Swap quote service is unavailable.', 503);
    }
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const message = response.status === 404 ? 'No executable liquidity route is available.' : 'Swap quote service rejected the request.';
      throw new AtlasSwapError('SWAP_QUOTE_UNAVAILABLE', message, response.status === 404 ? 409 : 503);
    }
    return sanitizeQuote(payload, expected);
  };
}

module.exports = { AtlasSwapError, CHAIN_ID, LIFI_DIAMOND, NATIVE_TOKEN, STOCKS, createAtlasSwapQuote, sanitizeQuote, validateInput };
