'use strict';

const { ethers } = require('ethers');
const network = require('../config/robinhood-mainnet.json');
const { createAtlasSwapQuote } = require('../lib/atlas-swap');
const { createIndexSwapPlanner } = require('../lib/atlas-index-swap');

const quoteStock = createAtlasSwapQuote();
const planner = createIndexSwapPlanner({ quoteStock });
const buckets = new Map();

function allowed(req) {
  const key = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) { buckets.set(key, { startedAt:now, count:1 }); return true; }
  bucket.count += 1;
  return bucket.count <= 8;
}

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'METHOD_NOT_ALLOWED',message:'Use POST.'}); }
  if (!allowed(req)) return res.status(429).json({error:'RATE_LIMITED',message:'Too many index quote requests.'});

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!network.atlas.factory || !network.atlas.router) fail('INDEX_ROUTER_NOT_DEPLOYED','The reviewed mainnet Factory and Index Router are not deployed yet.',503);
    const side = String(body.side || '');
    if (!['buy','sell'].includes(side)) fail('INVALID_INDEX_QUOTE','Side must be buy or sell.');
    if (!ethers.isAddress(body.indexAddress)) fail('INVALID_INDEX_QUOTE','Invalid index address.');
    const amount = String(body.amount || '');
    if (!/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) fail('INVALID_INDEX_QUOTE','Amount must be a positive raw integer.');

    const provider = new ethers.JsonRpcProvider(process.env.RH_RPC_URL || network.rpcUrl);
    const factory = new ethers.Contract(network.atlas.factory,['function isIndex(address) view returns (bool)'],provider);
    if (!await factory.isIndex(body.indexAddress)) fail('INVALID_INDEX_QUOTE','Index was not created by the configured ATLAS Factory.');
    const index = new ethers.Contract(body.indexAddress,[
      'function getStocks() view returns (address[])',
      'function requiredUnderlying(uint256,uint256) view returns (uint256)',
      'function redeemUnderlying(uint256,uint256) view returns (uint256)',
      'function totalSupply() view returns (uint256)',
    ],provider);
    const stocks = await index.getStocks();
    if (stocks.length < 2 || stocks.length > 5) fail('INVALID_INDEX_QUOTE','Index has an unsupported component count.');
    const tickerByAddress = new Map(Object.entries(network.stocks).map(([ticker,stock]) => [stock.address.toLowerCase(),ticker]));
    const tickers = stocks.map(stock => tickerByAddress.get(stock.toLowerCase()));
    if (tickers.some(ticker => !ticker)) fail('INVALID_INDEX_QUOTE','Index contains a non-canonical Stock Token.');

    let components;
    let plan;
    if (side === 'buy') {
      components = await Promise.all(stocks.map(async (_stock,i) => ({ ticker:tickers[i], requiredRaw:String(await index.requiredUnderlying(i,amount)) })));
      plan = await planner.planBuy({ indexAddress:body.indexAddress,grossAmount:amount,router:network.atlas.router,components });
    } else {
      const supply = await index.totalSupply();
      if (BigInt(amount) > supply) fail('INVALID_INDEX_QUOTE','Sale exceeds current index supply.');
      components = await Promise.all(stocks.map(async (_stock,i) => ({
        ticker:tickers[i],
        redeemRaw:String(await index.redeemUnderlying(i,amount)),
      })));
      plan = await planner.planSell({ indexAddress:body.indexAddress,indexAmount:amount,router:network.atlas.router,components });
    }
    return res.status(200).json(plan);
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({error:'INVALID_INDEX_QUOTE',message:'Invalid JSON body.'});
    const status = Number(error.status) || 503;
    const code = error.code || 'INDEX_QUOTE_UNAVAILABLE';
    const message = status < 500 ? error.message : (error.code === 'INDEX_ROUTER_NOT_DEPLOYED' ? error.message : 'Executable index quote is unavailable.');
    if (status >= 500 && !error.code) console.error('Index quote failure:', error?.message || 'unknown');
    return res.status(status).json({error:code,message});
  }
};
