import type { InventoryCurrency } from './inventory';

export type CurrencyDenomination = keyof InventoryCurrency;
export type CurrencyOperation = 'add' | 'spend';

// Copper values follow the pinned dnd5e currency conversions in module/config.mjs.
const COPPER_VALUE: Readonly<Record<CurrencyDenomination, number>> = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
export const CURRENCY_DENOMINATIONS: readonly CurrencyDenomination[] = ['pp', 'gp', 'ep', 'sp', 'cp'];

export function applyCurrencyTransaction(currency: InventoryCurrency, operation: CurrencyOperation, denomination: CurrencyDenomination, amount: number): InventoryCurrency {
  const value = amount * COPPER_VALUE[denomination];
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(value)) throw new Error('Enter a positive whole number of coins within the supported range.');
  if (CURRENCY_DENOMINATIONS.some((key) => !Number.isSafeInteger(currency[key]) || currency[key] < 0)) throw new Error('Currency balance is invalid.');
  const result = { ...currency };
  if (operation === 'add') {
    result[denomination] += amount;
    if (!Number.isSafeInteger(result[denomination])) throw new Error('Enter a positive whole number of coins within the supported range.');
    return result;
  }

  const total = CURRENCY_DENOMINATIONS.reduce((sum, key) => sum + result[key] * COPPER_VALUE[key], 0);
  if (!Number.isSafeInteger(total)) throw new Error('Currency balance exceeds the supported range.');
  if (total < value) throw new Error('Insufficient currency.');

  let remaining = value;
  const targetIndex = CURRENCY_DENOMINATIONS.indexOf(denomination);
  for (const key of CURRENCY_DENOMINATIONS.slice(targetIndex)) {
    const spent = Math.min(result[key], Math.floor(remaining / COPPER_VALUE[key]));
    result[key] -= spent;
    remaining -= spent * COPPER_VALUE[key];
  }
  if (remaining === 0) return result;

  // Break the smallest available coin that can cover the remainder. Return
  // change in the requested denomination and smaller coins.
  for (let index = CURRENCY_DENOMINATIONS.length - 1; index >= 0; index--) {
    const key = CURRENCY_DENOMINATIONS[index]!;
    if (COPPER_VALUE[key] <= remaining || result[key] === 0) continue;
    result[key] -= 1;
    let change = COPPER_VALUE[key] - remaining;
    for (const smaller of CURRENCY_DENOMINATIONS.slice(targetIndex)) {
      const count = Math.floor(change / COPPER_VALUE[smaller]);
      result[smaller] += count;
      change -= count * COPPER_VALUE[smaller];
    }
    return result;
  }
  throw new Error('Currency could not be converted.');
}
