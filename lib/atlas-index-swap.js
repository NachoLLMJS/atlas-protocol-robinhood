'use strict';

const { ethers } = require('ethers');
const { LIFI_DIAMOND } = require('./atlas-swap');

function positiveInteger(value, label) {
  const text = String(value || '');
  if (!/^[0-9]+$/.test(text) || BigInt(text) <= 0n) throw new Error(`${label} must be a positive raw integer`);
  return text;
}

function address(value, label) {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) throw new Error(`${label} address is invalid`);
  return ethers.getAddress(value);
}

function validateBase(input, amountField) {
  const indexAddress = address(input?.indexAddress, 'Index');
  const router = address(input?.router, 'Router');
  const amount = positiveInteger(input?.[amountField], amountField);
  if (!Array.isArray(input?.components) || input.components.length < 2 || input.components.length > 5) throw new Error('Index components must contain 2-5 canonical stocks');
  const seen = new Set();
  const components = input.components.map(component => {
    const ticker = String(component?.ticker || '').toUpperCase();
    if (!/^[A-Z0-9]{1,16}$/.test(ticker) || seen.has(ticker)) throw new Error('Invalid or duplicate component ticker');
    seen.add(ticker);
    return { ...component, ticker };
  });
  return { indexAddress, router, amount, components };
}

function validateQuote(quote, { side, ticker, amount, router }) {
  if (!quote || quote.side !== side || quote.ticker !== ticker || String(quote.fromAmount) !== String(amount)) throw new Error('Invalid component quote identity');
  if (!ethers.isAddress(quote.transaction?.from) || quote.transaction.from.toLowerCase() !== router.toLowerCase()) throw new Error('Component quote uses the wrong router');
  if (!ethers.isAddress(quote.transaction?.to) || quote.transaction.to.toLowerCase() !== LIFI_DIAMOND.toLowerCase()) throw new Error('Component quote uses an untrusted target');
  if (Number(quote.transaction?.chainId) !== 4663 || typeof quote.transaction?.data !== 'string' || !/^0x[0-9a-f]+$/i.test(quote.transaction.data)) throw new Error('Invalid component transaction');
  const minimumOutput = positiveInteger(quote.toAmountMin, 'Quote output');
  return {
    minimumOutput,
    call: {
      target: ethers.getAddress(quote.transaction.to),
      value: quote.transaction.value || '0x0',
      data: quote.transaction.data,
    },
    tool: quote.tool || 'unknown',
  };
}

function createIndexSwapPlanner({ quoteStock, maxRounds = 5 } = {}) {
  if (typeof quoteStock !== 'function') throw new Error('quoteStock is required');

  async function planBuy(input) {
    const base = validateBase(input, 'grossAmount');
    const swaps = [];
    let totalETH = 0n;
    for (const component of base.components) {
      const required = BigInt(positiveInteger(component.requiredRaw, 'Required collateral'));
      let inputAmount = 10n ** 15n;
      let selected;
      for (let round = 0; round < maxRounds; round += 1) {
        const quote = await quoteStock({ side:'buy', ticker:component.ticker, amount:inputAmount.toString(), wallet:base.router });
        const checked = validateQuote(quote, { side:'buy', ticker:component.ticker, amount:inputAmount.toString(), router:base.router });
        const output = BigInt(checked.minimumOutput);
        if (output >= required) { selected = checked; break; }
        if (output === 0n) throw new Error(`No executable liquidity output for ${component.ticker}`);
        inputAmount = ((inputAmount * required * 101n) + (output * 100n - 1n)) / (output * 100n);
      }
      if (!selected) throw new Error(`Insufficient executable liquidity output for ${component.ticker}`);
      const value = BigInt(selected.call.value || '0');
      if (value !== inputAmount) throw new Error('Component quote transaction value changed');
      totalETH += value;
      swaps.push({ ticker:component.ticker, requiredRaw:required.toString(), minimumOutput:selected.minimumOutput, tool:selected.tool, call:selected.call });
    }
    return { side:'buy', indexAddress:base.indexAddress, grossAmount:base.amount, totalETH:totalETH.toString(), swaps };
  }

  async function planSell(input) {
    const base = validateBase(input, 'indexAmount');
    const swaps = [];
    let minimumETH = 0n;
    for (const component of base.components) {
      const redeemRaw = positiveInteger(component.redeemRaw, 'Redeemed component');
      const quote = await quoteStock({ side:'sell', ticker:component.ticker, amount:redeemRaw, wallet:base.router });
      const checked = validateQuote(quote, { side:'sell', ticker:component.ticker, amount:redeemRaw, router:base.router });
      if (BigInt(checked.call.value || '0') !== 0n) throw new Error('Sell component quote cannot spend ETH');
      minimumETH += BigInt(checked.minimumOutput);
      swaps.push({ ticker:component.ticker, redeemRaw, minimumOutput:checked.minimumOutput, tool:checked.tool, call:checked.call });
    }
    return { side:'sell', indexAddress:base.indexAddress, indexAmount:base.amount, minimumETH:minimumETH.toString(), swaps };
  }

  return { planBuy, planSell };
}

module.exports = { createIndexSwapPlanner, validateQuote };
