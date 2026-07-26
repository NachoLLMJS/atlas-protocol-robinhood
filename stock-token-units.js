(function universalStockTokenUnits(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StockTokenUnits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStockTokenUnits() {
  'use strict';

  const SCALE = 10n ** 18n;

  function assertAmount(value, label) {
    if (typeof value !== 'bigint') throw new TypeError(`${label} must be a bigint.`);
    if (value < 0n) throw new RangeError(`${label} must be non-negative.`);
  }

  function assertMultiplier(multiplier) {
    if (typeof multiplier !== 'bigint') throw new TypeError('uiMultiplier must be a bigint.');
    if (multiplier <= 0n) throw new RangeError('uiMultiplier must be positive.');
  }

  function rawToUiUnits(rawAmount, uiMultiplier) {
    assertAmount(rawAmount, 'rawAmount');
    assertMultiplier(uiMultiplier);
    return rawAmount * uiMultiplier / SCALE;
  }

  function uiToRawUnits(uiAmount, uiMultiplier) {
    assertAmount(uiAmount, 'uiAmount');
    assertMultiplier(uiMultiplier);
    if (uiAmount === 0n) return 0n;
    return (uiAmount * SCALE + uiMultiplier - 1n) / uiMultiplier;
  }

  return Object.freeze({ SCALE, rawToUiUnits, uiToRawUnits });
});
