const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.join(__dirname, '..');

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test('uses the server credential and falls back to the next model', async () => {
  const { createAtlasAI } = require('../lib/atlas-ai');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (calls.length === 1) return jsonResponse(503, { error: { code: 'ModelOverloaded', message: 'busy' } });
    return jsonResponse(200, {
      choices: [{ message: { content: '{"reply":"ok","action":"buy_index","data":{"indexTicker":"TECH","qty":1}}' } }],
      usage: { total_tokens: 12 },
    });
  };
  const ai = createAtlasAI({
    fetchImpl,
    env: {
      OPENAI_API_KEY: 'server-only-secret',
      OPENAI_BASE_URL: 'https://api.openai.test/v1',
      ATLAS_AI_MODELS: 'primary-model,fallback-model',
    },
  });

  const result = await ai({
    history: [{ role: 'user', content: 'hello' }],
    context: { stocks: [], indices: [], balances: {} },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.body.model), ['primary-model', 'fallback-model']);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-only-secret');
  assert.equal(calls[0].options.body.includes('server-only-secret'), false);
  assert.equal(result.model, 'fallback-model');
  assert.equal(result.reply, 'ok');
  assert.equal(result.action, 'buy_index');
  assert.deepEqual(result.data, { indexTicker: 'TECH', qty: 1 });
});

test('does not waste fallbacks when billing or authentication blocks the account', async () => {
  const { createAtlasAI } = require('../lib/atlas-ai');
  let calls = 0;
  const ai = createAtlasAI({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(429, { error: { code: 'insufficient_quota', message: 'quota exhausted' } });
    },
    env: {
      OPENAI_API_KEY: 'server-only-secret',
      OPENAI_BASE_URL: 'https://api.openai.test/v1',
      ATLAS_AI_MODELS: 'one,two,three',
    },
  });

  await assert.rejects(
    () => ai({ history: [{ role: 'user', content: 'hello' }], context: {} }),
    error => error.code === 'AI_ACCOUNT_BLOCKED' && error.status === 503,
  );
  assert.equal(calls, 1);
});

test('rejects oversized or malformed browser context before calling the provider', async () => {
  const { createAtlasAI } = require('../lib/atlas-ai');
  let calls = 0;
  const ai = createAtlasAI({
    fetchImpl: async () => { calls += 1; return jsonResponse(200, {}); },
    env: { OPENAI_API_KEY: 'secret', OPENAI_BASE_URL: 'https://api.openai.test/v1' },
  });

  await assert.rejects(
    () => ai({ history: [{ role: 'user', content: 'x'.repeat(5001) }], context: {} }),
    error => error.code === 'INVALID_AI_REQUEST' && error.status === 400,
  );
  assert.equal(calls, 0);
});

test('falls back when a model violates the required JSON response contract', async () => {
  const { createAtlasAI } = require('../lib/atlas-ai');
  const calls = [];
  const ai = createAtlasAI({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (calls.length === 1) {
        return jsonResponse(200, { choices: [{ message: { content: 'I would buy it now.' } }] });
      }
      return jsonResponse(200, { choices: [{ message: { content: '{"reply":"Safe answer","action":"none","data":{}}' } }] });
    },
    env: {
      OPENAI_API_KEY: 'server-only-secret',
      OPENAI_BASE_URL: 'https://api.openai.test/v1',
      ATLAS_AI_MODELS: 'powerful-model,structured-model',
    },
  });

  const result = await ai({ history: [{ role: 'user', content: 'hello' }], context: {} });
  assert.deepEqual(calls.map(call => call.model), ['powerful-model', 'structured-model']);
  assert.equal(result.model, 'structured-model');
  assert.equal(result.reply, 'Safe answer');
});

test('requests strict JSON Schema from every OpenAI model', async () => {
  const { createAtlasAI } = require('../lib/atlas-ai');
  const calls = [];
  const ai = createAtlasAI({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (calls.length === 1) return jsonResponse(503, { error: { code: 'ModelOverloaded', message: 'busy' } });
      return jsonResponse(200, { choices: [{ message: { content: '{"reply":"ok","action":"none","data":{}}' } }] });
    },
    env: {
      OPENAI_API_KEY: 'server-only-secret',
      OPENAI_BASE_URL: 'https://api.openai.test/v1',
      ATLAS_AI_MODELS: 'gpt-4.1-mini,gpt-4.1-nano',
    },
  });

  await ai({ history: [{ role: 'user', content: 'hello' }], context: {} });
  assert.equal(calls[0].response_format.type, 'json_schema');
  assert.equal(calls[1].response_format.type, 'json_schema');
  assert.equal(calls[1].response_format.json_schema.strict, true);
  const dataSchema = calls[1].response_format.json_schema.schema.properties.data;
  assert.deepEqual(dataSchema.required, ['ticker', 'indexTicker', 'qty', 'ethAmount', 'indexName', 'indexStocks', 'toAddress', 'sendAmount', 'sendToken']);
  assert.deepEqual(calls[1].response_format.json_schema.schema.properties.action.enum, ['none', 'buy_index', 'sell_index', 'buy_stock', 'sell_stock', 'create_index', 'send', 'portfolio', 'price']);
  assert.equal(calls[1].thinking, undefined);
});

test('frontend contains no AI provider secret boundary', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'ATLAS.html'), 'utf8');
  assert.doesNotMatch(html, /api\.openai\.com|api\.tavily\.com|ark\.ap-southeast/i);
  assert.doesNotMatch(html, /OPENAI_KEY|TAVILY_KEYS|OPENAI_API_KEY/);
  assert.doesNotMatch(html, /<script[^>]+config\.js/i);
  assert.match(html, /fetch\(['"]\/api\/chat['"]/);
});
