(function universalAtlasIndexSelection(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AtlasIndexSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAtlasIndexSelection() {
  'use strict';

  const INDEX_ACTIONS = new Set(['buy_index', 'sell_index']);

  function normalizedSymbol(value) {
    return String(value || '').replace(/^\$/, '').trim().toUpperCase();
  }

  function buildIndexChoice(parsed, indices) {
    if (!parsed || !INDEX_ACTIONS.has(parsed.action)) return null;
    const available = Array.isArray(indices) ? indices.filter(index => index && index.address && index.symbol) : [];
    const data = parsed.data && typeof parsed.data === 'object' ? { ...parsed.data } : {};
    const requested = normalizedSymbol(data.indexTicker);
    const selected = requested
      ? available.find(index => normalizedSymbol(index.symbol) === requested) || null
      : null;
    const quantity = Number(data.qty) > 0 ? String(data.qty) : '';

    if (selected && quantity) return null;

    return {
      action: parsed.action,
      data,
      indices: available,
      selectedAddress: selected?.address || null,
      quantity,
    };
  }

  function resolveIndexChoice(choice, indexAddress, quantity) {
    if (!choice || !INDEX_ACTIONS.has(choice.action)) throw new Error('Invalid index action.');
    const selected = choice.indices.find(index => String(index.address).toLowerCase() === String(indexAddress || '').toLowerCase());
    if (!selected) throw new Error('Select a valid index.');
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive amount.');

    return {
      action: choice.action,
      reply: `${choice.action === 'buy_index' ? 'Buy' : 'Sell'} ${amount} ${selected.symbol}.`,
      data: {
        ...choice.data,
        indexTicker: selected.symbol,
        qty: amount,
        index: selected,
      },
    };
  }

  return Object.freeze({ buildIndexChoice, resolveIndexChoice });
});
