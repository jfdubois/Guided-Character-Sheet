import { describe, expect, it } from 'vitest';
import { applyLevelOne2024RestCompatibility, type LevelOne2024RestSource } from '../src/rest-state-compatibility';
import type { MutableCharacterState } from '../src/mutable-character-state';

const source: LevelOne2024RestSource = {
  classSourcePath: 'packs/_source/classes24/warlock/warlock.yml', classHitDie: 'd8', characterLevel: 1,
  spellSlots: [{ key: 'pact:1', kind: 'pact', level: 1, maximum: 1, recovery: ['short-rest', 'long-rest'] }],
};

function state(): MutableCharacterState {
  return { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [], hitPoints: { current: 6, maximum: 9 }, spellSlots: [] };
}

describe('level-one 2024 rest-state compatibility', () => {
  it('initializes source-backed Hit Dice and a previously unavailable Pact slot', () => {
    const current = state(); const before = structuredClone(current);
    const result = applyLevelOne2024RestCompatibility(current, source);
    expect(result.state.hitDice).toEqual([{ classSourcePath: source.classSourcePath, denomination: 'd8', current: 1, maximum: 1 }]);
    expect(result.state.spellSlots).toEqual([{ key: 'pact:1', kind: 'pact', level: 1, current: 1, maximum: 1, recovery: ['short-rest', 'long-rest'] }]);
    expect(result).toMatchObject({ hitDiceInitialized: true, spellSlotsInitialized: 1, spellSlotsEnriched: 0, changed: true });
    expect(current).toEqual(before);
  });

  it('enriches a matching legacy slot without resetting its current value', () => {
    const current = state(); current.spellSlots = [{ level: 1, current: 0, maximum: 1 }];
    const result = applyLevelOne2024RestCompatibility(current, source);
    expect(result.state.spellSlots).toEqual([{ key: 'pact:1', kind: 'pact', level: 1, current: 0, maximum: 1, recovery: ['short-rest', 'long-rest'] }]);
    expect(result).toMatchObject({ spellSlotsInitialized: 0, spellSlotsEnriched: 1 });
  });

  it('is idempotent once compatibility state exists', () => {
    const first = applyLevelOne2024RestCompatibility(state(), source);
    const second = applyLevelOne2024RestCompatibility(first.state, source);
    expect(second.state).toBe(first.state);
    expect(second.changed).toBe(false);
  });

  it('does not overwrite a conflicting legacy slot maximum', () => {
    const current = state(); current.spellSlots = [{ level: 1, current: 1, maximum: 2 }];
    const result = applyLevelOne2024RestCompatibility(current, source);
    expect(result.state.spellSlots).toEqual([
      { level: 1, current: 1, maximum: 2 },
      { key: 'pact:1', kind: 'pact', level: 1, current: 1, maximum: 1, recovery: ['short-rest', 'long-rest'] },
    ]);
  });

  it('reconciles exact recovery profiles, preserves current counts, and removes stale source resources', () => {
    const current = state();
    current.resources = [
      { key: 'feature:clouds-jaunt.yml', current: 1, maximum: 2, reset: 'long-rest' },
      { key: 'feature:fires-burn.yml', current: 2, maximum: 2, reset: 'long-rest' },
    ];
    current.spellUses = [{ key: 'fog-cloud', current: 0, maximum: 1, reset: 'long-rest' }];
    const authoritative: LevelOne2024RestSource = {
      ...source,
      resources: [
        { key: 'feature:clouds-jaunt.yml', current: 2, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] },
        { key: 'feature:second-wind.yml', current: 1, maximum: 1, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }, { period: 'short-rest', type: 'formula', formula: '1' }] },
      ],
      spellUses: [{ key: 'fog-cloud', current: 1, maximum: 1, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] }],
    };
    const result = applyLevelOne2024RestCompatibility(current, authoritative);
    expect(result.state.resources).toEqual([
      { key: 'feature:clouds-jaunt.yml', current: 1, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] },
      { key: 'feature:second-wind.yml', current: 1, maximum: 1, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }, { period: 'short-rest', type: 'formula', formula: '1' }] },
    ]);
    expect(result.state.spellUses).toEqual([{ key: 'fog-cloud', current: 0, maximum: 1, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] }]);
    expect(result).toMatchObject({ resourcesInitialized: 1, resourcesEnriched: 1, resourcesRemoved: 1, spellUsesInitialized: 0, spellUsesEnriched: 1, spellUsesRemoved: 0 });
  });
});
