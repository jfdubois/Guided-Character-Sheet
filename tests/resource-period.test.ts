import { describe, expect, it } from 'vitest';
import { mutableResetForPeriod, mutableResetForRecovery, recoverableResetForUses } from '../src/resource-period';

describe('pinned Foundry recovery periods', () => {
  it.each([['sr', 'short-rest'], ['lr', 'long-rest']] as const)('maps %s', (period, expected) => expect(mutableResetForPeriod(period)).toBe(expected));
  it('does not invent unsupported recovery semantics', () => expect(mutableResetForPeriod('day')).toBeUndefined());
  it('omits a recovery profile containing unsupported periods', () => expect(mutableResetForRecovery([{ period: 'day' }])).toBeUndefined());
});

describe('recoverable feature uses', () => {
  it('requires a usable maximum and a supported rest recovery', () => {
    expect(recoverableResetForUses({ maximum: 1, recovery: [{ period: 'sr' }] })).toBe('short-rest');
    expect(recoverableResetForUses({ maximum: 1, recovery: [] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: 1, recovery: [{ period: 'none' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: 1, recovery: [{ period: 'day' }] })).toBeUndefined();
    expect(recoverableResetForUses({ recovery: [{ period: 'sr' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: '', recovery: [{ period: 'sr' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: 'often', recovery: [{ period: 'sr' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: '1\n', recovery: [{ period: 'sr' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: ' 1', recovery: [{ period: 'sr' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: '@prof\n', recovery: [{ period: 'sr' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: '@prof ', recovery: [{ period: 'sr' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: '@scale.fighter.second-wind\n', recovery: [{ period: 'sr' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: '@scale.fighter.second-wind', recovery: [{ period: 'sr' }] })).toBe('short-rest');
    expect(recoverableResetForUses({ maximum: '@scale.fighter.', recovery: [{ period: 'sr' }] })).toBeUndefined();
    expect(recoverableResetForUses({ maximum: '@scale..second-wind', recovery: [{ period: 'sr' }] })).toBeUndefined();
  });
});
