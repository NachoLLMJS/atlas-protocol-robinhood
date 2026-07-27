'use strict';

const DEFAULT_MODELS = [
  'gpt-4.1-mini',
  'gpt-4.1-nano',
];
const ALLOWED_ACTIONS = new Set(['none', 'buy_index', 'sell_index', 'buy_stock', 'sell_stock', 'create_index', 'send', 'portfolio', 'price']);
const ATLAS_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: {
    name: 'atlas_terminal_action',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reply: { type: 'string' },
        action: { type: 'string', enum: [...ALLOWED_ACTIONS] },
        data: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ticker: { type: ['string', 'null'] },
            indexTicker: { type: ['string', 'null'] },
            qty: { type: ['number', 'null'] },
            ethAmount: { type: ['number', 'null'] },
            indexName: { type: ['string', 'null'] },
            indexStocks: { type: ['array', 'null'], items: { type: 'string' } },
            toAddress: { type: ['string', 'null'] },
            sendAmount: { type: ['number', 'null'] },
            sendToken: { type: ['string', 'null'] },
          },
          required: ['ticker', 'indexTicker', 'qty', 'ethAmount', 'indexName', 'indexStocks', 'toAddress', 'sendAmount', 'sendToken'],
        },
      },
      required: ['reply', 'action', 'data'],
    },
  },
});

class AtlasAIError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'AtlasAIError';
    this.code = code;
    this.status = status;
  }
}

function validateInput(input) {
  if (!input || !Array.isArray(input.history) || input.history.length === 0 || input.history.length > 20) {
    throw new AtlasAIError('INVALID_AI_REQUEST', 'History must contain 1-20 messages.', 400);
  }
  const history = input.history.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length < 1 || message.content.length > 5000) {
      throw new AtlasAIError('INVALID_AI_REQUEST', 'Invalid message.', 400);
    }
    return { role: message.role, content: message.content };
  });
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const stocks = Array.isArray(context.stocks) ? context.stocks.slice(0, 100).map(stock => ({
    ticker: String(stock.ticker || '').slice(0, 16).toUpperCase(),
    name: String(stock.name || '').slice(0, 100),
    price: Number.isFinite(Number(stock.price)) ? Number(stock.price) : 0,
    change: Number.isFinite(Number(stock.change)) ? Number(stock.change) : 0,
    live: Boolean(stock.live),
  })).filter(stock => stock.ticker) : [];
  const indices = Array.isArray(context.indices) ? context.indices.slice(0, 100).map(index => ({
    address: String(index.address || '').slice(0, 42),
    name: String(index.name || '').slice(0, 100),
    symbol: String(index.symbol || '').slice(0, 16),
    stocks: Array.isArray(index.stocks) ? index.stocks.slice(0, 5).map(String) : [],
    totalSupply: Number(index.totalSupply) || 0,
    feeBps: Number(index.feeBps) || 0,
  })) : [];
  const balances = {};
  if (context.balances && typeof context.balances === 'object') {
    Object.entries(context.balances).slice(0, 120).forEach(([key, value]) => {
      const amount = Number(value);
      if (Number.isFinite(amount)) balances[String(key).slice(0, 32)] = amount;
    });
  }
  return { history, context: { stocks, indices, balances } };
}

function buildSystemPrompt(context) {
  const liveStocks = context.stocks.filter(stock => stock.live);
  const available = liveStocks.map(stock => stock.ticker);
  const stockList = liveStocks.length
    ? liveStocks.map(stock => `- ${stock.ticker} (${stock.name}): $${stock.price.toFixed(2)}, 24h ${(stock.change >= 0 ? '+' : '') + stock.change}%`).join('\n')
    : 'No stock-token data is currently available.';
  const indexList = context.indices.length
    ? context.indices.map(index => `- ${index.symbol} "${index.name}": stocks=[${index.stocks.join(', ')}], supply=${index.totalSupply}, fee=${index.feeBps / 100}%, contract=${index.address}`).join('\n')
    : 'No ATLAS indices are deployed on mainnet yet.';
  const balanceList = Object.entries(context.balances).filter(([, value]) => value > 0).map(([key, value]) => `${key}: ${value}`).join(', ') || 'Wallet not connected or empty.';

  return `You are ATLAS, the concise English-language trading terminal for ATLAS Protocol on Robinhood Chain mainnet (chain ID 4663).

Capabilities:
1. Prepare direct collateralized mint or deterministic basket redemption for an already-deployed ATLAS index.
2. Prepare a Stock Token purchase with native ETH or sale for native ETH through live-validated LI.FI aggregate mainnet quotes.
3. Prepare creation of a 2-5 stock index when the mainnet factory is deployed.
4. Prepare explicit token transfers.
5. Report the connected wallet portfolio and current stock prices.
6. Explain the protocol. Never claim that a transaction happened; the browser always shows a separate confirmation and the wallet executes it.

Canonical mainnet stock tokens available to this interface:
${stockList}
Allowed tickers: ${available.join(', ') || 'none'}.
Never put unavailable tickers in indexStocks.

Deployed ATLAS indices:
${indexList}

Wallet balances:
${balanceList}

Return one JSON object only, with no markdown:
{"reply":"concise response in English","action":"none|buy_index|sell_index|buy_stock|sell_stock|create_index|send|portfolio|price","data":{"ticker":"TSLA","indexTicker":"TECH","qty":1,"ethAmount":0.01,"indexName":"My Index","indexStocks":["TSLA","AMD"],"toAddress":"0x...","sendAmount":1,"sendToken":"TSLA"}}

Rules:
- Use action=buy_index or sell_index whenever index trading intent is clear, even if indexTicker or qty is unknown; use null for missing fields because the clickable UI collects them deterministically. A buy means direct collateralized mint and a sell means burn with deterministic basket redemption.
- Use action=buy_stock only when a canonical ticker and positive ethAmount are explicit. ethAmount is native ETH to spend, not USD.
- Use action=sell_stock only when a canonical ticker and positive qty are explicit. qty is the ERC-8056 UI-adjusted Stock Token amount to sell.
- Use action=create_index when indexName plus 2-5 valid indexStocks are known.
- Use action=send only for an explicit transfer request with toAddress, sendAmount and sendToken.
- Never invent addresses, balances, prices, deployed indices, transaction hashes or completed trades.
- Always respond in English, regardless of the language used by the user. Keep replies short.`;
}

function parseModelOutput(raw, history, { strict = false } = {}) {
  const text = String(raw || '').trim();
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch {}
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (strict) throw new Error('Model response was not a JSON object.');
    parsed = { reply: text || 'Unable to process the request.', action: 'none', data: {} };
  }
  parsed.reply = typeof parsed.reply === 'string' ? parsed.reply.slice(0, 4000) : 'Unable to process the request.';
  parsed.action = ALLOWED_ACTIONS.has(parsed.action) ? parsed.action : 'none';
  parsed.data = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? parsed.data : {};

  return parsed;
}

function readProviderError(payload, status) {
  const error = payload && payload.error && typeof payload.error === 'object' ? payload.error : {};
  const code = String(error.code || 'PROVIDER_ERROR');
  const message = String(error.message || `Provider returned HTTP ${status}`);
  if (status === 401 || status === 402 || status === 403 || /insufficient_quota|billing|authentication|unauthorized/i.test(`${code} ${message}`)) {
    throw new AtlasAIError('AI_ACCOUNT_BLOCKED', 'AI service billing or authentication is blocking requests.', 503);
  }
  return { code, message, retryable: status === 408 || status === 409 || status === 429 || status >= 500 || /model|capacity|overload|rate/i.test(code) };
}

function createAtlasAI({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required');
  const apiKey = env.OPENAI_API_KEY;
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const models = String(env.ATLAS_AI_MODELS || env.OPENAI_MODELS || '').split(',').map(model => model.trim()).filter(Boolean);
  const fallbackModels = models.length ? models : DEFAULT_MODELS;

  return async function runAtlasAI(input) {
    if (!apiKey) throw new AtlasAIError('AI_NOT_CONFIGURED', 'AI terminal is not configured.', 503);
    const { history, context } = validateInput(input);
    const messages = [{ role: 'system', content: buildSystemPrompt(context) }, ...history];
    let lastError;

    for (const model of fallbackModels) {
      let response;
      try {
        const requestBody = { model, messages, temperature: 0.2, max_tokens: 800, stream: false, response_format: ATLAS_RESPONSE_FORMAT };
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(requestBody),
        });
      } catch (error) {
        lastError = error;
        continue;
      }

      let payload = {};
      try { payload = await response.json(); } catch {}
      if (!response.ok) {
        const providerError = readProviderError(payload, response.status);
        lastError = new Error(`${providerError.code}: ${providerError.message}`);
        if (providerError.retryable) continue;
        break;
      }

      const raw = payload.choices?.[0]?.message?.content;
      if (typeof raw !== 'string' || !raw.trim()) {
        lastError = new Error(`Empty response from ${model}`);
        continue;
      }
      try {
        return { ...parseModelOutput(raw, history, { strict: true }), model, usage: payload.usage || null };
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    throw new AtlasAIError('AI_UNAVAILABLE', 'All configured AI models are unavailable.', 503, { cause: lastError });
  };
}

module.exports = { AtlasAIError, DEFAULT_MODELS, buildSystemPrompt, createAtlasAI, parseModelOutput, validateInput };
