'use strict';

const { AtlasAIError, createAtlasAI } = require('../lib/atlas-ai');

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;
const buckets = new Map();

function clientId(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function isRateLimited(req, now = Date.now()) {
  const id = clientId(req);
  const bucket = buckets.get(id);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    buckets.set(id, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  if (Number(req.headers['content-length'] || 0) > 50_000) return res.status(413).json({ error: 'REQUEST_TOO_LARGE' });
  if (isRateLimited(req)) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Please wait before sending another request.' });

  try {
    const result = await createAtlasAI()({
      history: req.body?.history,
      context: req.body?.context,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof AtlasAIError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    console.error('ATLAS AI server error:', error?.message || error);
    return res.status(500).json({ error: 'AI_INTERNAL_ERROR', message: 'AI terminal failed safely.' });
  }
};

module.exports._test = { clientId, isRateLimited };
