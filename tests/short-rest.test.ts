import { describe, expect, it } from 'vitest';
import { applyShortRest } from '../src/short-rest';
import type { MutableCharacterState } from '../src/mutable-character-state';

function state(): MutableCharacterState {
  return {
    hitPoints: { current: 4, maximum: 10, maximumOverride: 12, temporary: 3 },
    hitDice: [{ classSourcePath: 'classes/warlock.yml', denomination: 'd8', current: 1, maximum: 1 }],
    preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [],
    spellSlots: [
      { key: 'spell:1', kind: 'spell', level: 1, current: 0, maximum: 2, recovery: ['long-rest'] },
      { key: 'pact:1', kind: 'pact', level: 1, current: 0, maximum: 1, recovery: ['short-rest', 'long-rest'] },
      { level: 2, current: 0, maximum: 1 },
    ],
    spellUses: [{ key: 'short-use', current: 0, maximum: 1, reset: 'short-rest' }, { key: 'long-use', current: 0, maximum: 1, reset: 'long-rest' }],
    resources: [
      { key: 'rage', current: 0, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }, { period: 'short-rest', type: 'formula', formula: '1' }] },
      { key: 'adrenaline', current: 0, maximum: 2, reset: 'short-rest', recovery: [{ period: 'short-rest', type: 'recover-all' }] },
      { key: 'unsupported', current: 0, maximum: 2, reset: 'short-rest', recovery: [{ period: 'short-rest', type: 'formula', formula: '@prof' }] },
    ],
  };
}

describe('short rest', () => {
  it('spends one die, records entered healing, and applies only short-rest recovery', () => {
    const current = state();
    const before = structuredClone(current);
    const result = applyShortRest(current, { hitDieClassSourcePath: 'classes/warlock.yml', healing: 6 });
    expect(result.state.hitPoints).toEqual({ current: 10, maximum: 10, maximumOverride: 12, temporary: 3 });
    expect(result.state.hitDice?.[0]?.current).toBe(0);
    expect(result.state.spellSlots?.map((slot) => slot.current)).toEqual([0, 1, 0]);
    expect(result.state.spellUses?.map((use) => use.current)).toEqual([1, 0]);
    expect(result.state.resources.map((resource) => resource.current)).toEqual([1, 2, 0]);
    expect(result.summary).toEqual({ hitDiceSpent: 1, hitPointsRestored: 6, spellSlotLevelsRestored: 1, spellUsesRestored: 1, resourcesRestored: 2, skippedRecoveryKeys: ['unsupported'], changed: true });
    expect(current).toEqual(before);
  });

  it('allows a resource-only rest and does not infer legacy slot recovery', () => {
    const result = applyShortRest(state(), { healing: 0 });
    expect(result.summary.changed).toBe(true);
    expect(result.summary.hitDiceSpent).toBe(0);
    expect(result.state.spellSlots?.find((slot) => slot.level === 2)?.current).toBe(0);
  });

  it('caps healing at the effective maximum while still spending the die', () => {
    const current = state(); current.hitPoints = { current: 11, maximum: 10, maximumOverride: 12, temporary: 2 };
    const result = applyShortRest(current, { hitDieClassSourcePath: 'classes/warlock.yml', healing: 8 });
    expect(result.state.hitPoints).toEqual({ current: 12, maximum: 10, maximumOverride: 12, temporary: 2 });
    expect(result.summary).toMatchObject({ hitDiceSpent: 1, hitPointsRestored: 1 });
  });

  it.each([
    ['zero HP', () => { const current = state(); current.hitPoints!.current = 0; return applyShortRest(current, { healing: 0 }); }],
    ['healing without a die', () => applyShortRest(state(), { healing: 1 })],
    ['zero healing with a spent die', () => applyShortRest(state(), { hitDieClassSourcePath: 'classes/warlock.yml', healing: 0 })],
    ['an unknown die', () => applyShortRest(state(), { hitDieClassSourcePath: 'classes/fighter.yml', healing: 1 })],
    ['fractional healing', () => applyShortRest(state(), { hitDieClassSourcePath: 'classes/warlock.yml', healing: 1.5 })],
  ])('rejects %s', (_label, operation) => expect(operation).toThrow());
});
