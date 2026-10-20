import { describe, expect, it } from 'vitest';
import { applyCurrencyTransaction } from '../src/currency-transaction';

describe('currency transactions', () => {
  const purse = { pp: 1, gp: 2, ep: 0, sp: 0, cp: 0 };

  it('makes change from one gold coin when spending five silver', () => {
    expect(applyCurrencyTransaction(purse, 'spend', 'sp', 5)).toEqual({ pp: 1, gp: 1, ep: 0, sp: 5, cp: 0 });
    expect(purse).toEqual({ pp: 1, gp: 2, ep: 0, sp: 0, cp: 0 });
  });

  it('adds the chosen denomination without converting existing coins', () => {
    expect(applyCurrencyTransaction(purse, 'add', 'ep', 3)).toEqual({ pp: 1, gp: 2, ep: 3, sp: 0, cp: 0 });
  });

  it('spends exact coins before making change and supports electrum', () => {
    expect(applyCurrencyTransaction({ pp: 0, gp: 0, ep: 1, sp: 3, cp: 0 }, 'spend', 'sp', 6))
      .toEqual({ pp: 0, gp: 0, ep: 0, sp: 2, cp: 0 });
  });

  it('returns copper change when the payment is below one silver', () => {
    expect(applyCurrencyTransaction({ pp: 0, gp: 0, ep: 0, sp: 1, cp: 0 }, 'spend', 'cp', 3))
      .toEqual({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 7 });
  });

  it('rejects an unaffordable payment without changing the purse', () => {
    expect(() => applyCurrencyTransaction(purse, 'spend', 'pp', 2)).toThrow('Insufficient currency');
    expect(purse.gp).toBe(2);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])('rejects an invalid amount: %s', (amount) => {
    expect(() => applyCurrencyTransaction(purse, 'add', 'gp', amount)).toThrow('positive whole number');
  });
});
