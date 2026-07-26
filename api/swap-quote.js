'use strict';

const { AtlasSwapError, createAtlasSwapQuote } = require('../lib/atlas-swap');

const getQuote = createAtlasSwapQuote();
const rateBuckets = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

function clientKey(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function checkRateLimit(req) {
  const now = Date.now();
  const key = clientKey(req);
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= MAX_REQUESTS;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Use POST.' });
  }
  if (!checkRateLimit(req)) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many quote requests.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const quote = await getQuote(body);
    return res.status(200).json(quote);
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'INVALID_SWAP_REQUEST', message: 'Invalid JSON body.' });
    if (error instanceof AtlasSwapError) return res.status(error.status).json({ error: error.code, message: error.message });
    console.error('Swap quote failure:', error?.message || 'unknown');
    return res.status(503).json({ error: 'SWAP_QUOTE_UNAVAILABLE', message: 'Swap quote service is unavailable.' });
  }
};
