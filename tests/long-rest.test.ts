import { describe, expect, it } from 'vitest';
import { applyLongRest } from '../src/long-rest';
import type { MutableCharacterState } from '../src/mutable-character-state';

const state = (): MutableCharacterState => ({
  hitPoints: { current: 4, maximum: 10, maximumOverride: 12, temporary: 3 },
  inspiration: false,
  preparedSpells: [{ sourcePath: 'spells/bless.yml', pack: 'spells', type: 'spell', id: 'bless', name: 'Bless' }],
  inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
  equipmentStatus: [],
  spellSlots: [{ level: 1, current: 0, maximum: 2 }, { level: 2, current: 1, maximum: 1 }],
  hitDice: [{ classSourcePath: 'classes/fighter.yml', denomination: 'd10', current: 0, maximum: 1 }],
  spellUses: [
    { key: 'magic-initiate', current: 0, maximum: 1, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] },
    { key: 'legacy-short', current: 0, maximum: 2, reset: 'short-rest' },
    { key: 'no-reset', current: 0, maximum: 1, reset: 'none' },
  ],
  resources: [
    { key: 'rage', current: 0, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }, { period: 'short-rest', type: 'formula', formula: '1' }] },
    { key: 'adrenaline', current: 0, maximum: 2, reset: 'short-rest', recovery: [{ period: 'short-rest', type: 'recover-all' }] },
    { key: 'numeric-formula', current: 0, maximum: 3, reset: 'short-rest', recovery: [{ period: 'short-rest', type: 'formula', formula: '1' }] },
    { key: 'unsupported-formula', current: 0, maximum: 3, reset: 'short-rest', recovery: [{ period: 'short-rest', type: 'formula', formula: '@prof' }] },
    { key: 'none', current: 0, maximum: 1, reset: 'none' },
  ],
});

describe('long rest', () => {
  it('applies supported Foundry recovery in one immutable transition', () => {
    const current = state();
    const before = structuredClone(current);
    const result = applyLongRest(current);

    expect(result.state.hitPoints).toEqual({ current: 12, maximum: 10, maximumOverride: 12, temporary: 0 });
    expect(result.state.spellSlots).toEqual([{ level: 1, current: 2, maximum: 2 }, { level: 2, current: 1, maximum: 1 }]);
    expect(result.state.spellUses?.map(({ key, current: uses }) => [key, uses])).toEqual([['magic-initiate', 1], ['legacy-short', 2], ['no-reset', 0]]);
    expect(result.state.resources.map(({ key, current: uses }) => [key, uses])).toEqual([['rage', 2], ['adrenaline', 2], ['numeric-formula', 1], ['unsupported-formula', 0], ['none', 0]]);
    expect(result.state.hitDice).toEqual([{ classSourcePath: 'classes/fighter.yml', denomination: 'd10', current: 1, maximum: 1 }]);
    expect(result.summary).toEqual({ hitPointsRestored: 8, temporaryHitPointsCleared: 3, hitDiceRestored: 1, spellSlotLevelsRestored: 1, spellUsesRestored: 2, resourcesRestored: 3, skippedRecoveryKeys: ['unsupported-formula'], changed: true });
    expect(result.state.inspiration).toBe(false);
    expect(result.state.preparedSpells).toEqual(current.preparedSpells);
    expect(result.state.inventory).toEqual(current.inventory);
    expect(current).toEqual(before);
  });

  it('applies a deterministic formula once per completed rest and stops at maximum', () => {
    const first = applyLongRest(state());
    const second = applyLongRest(first.state);
    const third = applyLongRest(second.state);
    expect(first.state.resources.find(({ key }) => key === 'numeric-formula')?.current).toBe(1);
    expect(second.state.resources.find(({ key }) => key === 'numeric-formula')?.current).toBe(2);
    expect(third.state.resources.find(({ key }) => key === 'numeric-formula')?.current).toBe(3);
    expect(third.summary.skippedRecoveryKeys).toEqual(['unsupported-formula']);
  });

  it('does not initialize absent mutable categories', () => {
    const minimal: MutableCharacterState = { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] };
    expect(applyLongRest(minimal)).toEqual({ state: minimal, summary: { hitPointsRestored: 0, temporaryHitPointsCleared: 0, hitDiceRestored: 0, spellSlotLevelsRestored: 0, spellUsesRestored: 0, resourcesRestored: 0, skippedRecoveryKeys: [], changed: false } });
  });
});
