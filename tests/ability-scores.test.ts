import { describe, expect, it } from 'vitest';
import { ABILITIES, calculateAbilityScores, collectAbilityBonuses, createDefaultAbilityScores, createPointBuyAbilityScores, getAbilityModifier, getAbilityScoreMethodOptions, pointBuyRemaining, pointBuyTotal, scoreFromRolls, sumAbilityBonuses, validateAbilityScores, type AbilityScoreSelection } from '../src/ability-scores';
import type { BackgroundSourceSummary } from '../src/character-sources';

describe('ability scores', () => {
  it('applies a valid saved 2024 background allocation exactly once', () => {
    const background = { ruleset: '2024', abilityScores: { advancementId: 'asi', points: 3, cap: 2, locked: ['str', 'dex', 'con'], fixed: { int: 0, wis: 0, cha: 0 } } } as unknown as BackgroundSourceSummary;
    const sources = collectAbilityBonuses(undefined, undefined, undefined, background, { advancementId: 'asi', assignments: { int: 2, wis: 1 } });
    expect(sources.background).toEqual({ str: 0, dex: 0, con: 0, int: 2, wis: 1, cha: 0 });
  });

  it('does not apply a stale or invalid background allocation', () => {
    const background = { ruleset: '2024', abilityScores: { advancementId: 'asi', points: 3, cap: 2, locked: ['str', 'dex', 'con'] } } as unknown as BackgroundSourceSummary;
    expect(collectAbilityBonuses(undefined, undefined, undefined, background, { advancementId: 'old', assignments: { int: 2, wis: 1 } }).background).toEqual({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });
  });
  it('calculates modifiers and final values from source and manual bonuses', () => {
    const selection: AbilityScoreSelection = {
      method: 'standard-array',
      base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      manual: { str: 1, dex: 0, con: -1, int: 0, wis: 0, cha: 0 },
    };
    const result = calculateAbilityScores(selection, { str: 1, dex: 0, con: 0, int: 0, wis: 2, cha: 0 });
    expect(result.str).toMatchObject({ base: 15, sourceBonus: 1, manual: 1, final: 17, modifier: 3 });
    expect(result.wis).toMatchObject({ final: 12, modifier: 1 });
    expect(getAbilityModifier(9)).toBe(-1);
  });

  it('validates standard array and point buy constraints', () => {
    expect(validateAbilityScores(createDefaultAbilityScores())).toEqual([]);
    expect(validateAbilityScores({ ...createDefaultAbilityScores(), method: 'standard-array', base: { ...createDefaultAbilityScores().base, str: 15, dex: 15 } })).toContain('Standard array values must be used exactly once.');
    expect(validateAbilityScores({ ...createDefaultAbilityScores(), method: 'point-buy', base: { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 } })).toContain('Point buy must use exactly 27 points.');
    const pointBuy = createPointBuyAbilityScores();
    expect(pointBuy.base).toEqual({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
    expect(pointBuyTotal({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 })).toBe(27);
    expect(pointBuyRemaining(pointBuy.base)).toBe(27);
  });

  it('keeps the six D&D abilities in display order', () => {
    expect(ABILITIES).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
    expect(scoreFromRolls([6, 6, 4, 2])).toBe(16);
  });

  it('provides a placeholder before a method is selected', () => {
    expect(getAbilityScoreMethodOptions()).toEqual([
      { value: '', label: 'Select an option', placeholder: true },
      { value: 'standard-array', label: 'Standard array', placeholder: false },
      { value: 'point-buy', label: 'Point buy', placeholder: false },
      { value: 'dice-rolling', label: 'Dice rolling', placeholder: false },
    ]);
  });

  it('collects fixed bonuses from species and background plus selected class increases', () => {
    const sources = collectAbilityBonuses(
      { advancements: [{ raw: { configuration: { fixed: { str: 1 } } } }] } as never,
      { advancements: [{ id: 'asi', level: 1, raw: { configuration: { fixed: { dex: 1 } } } }] } as never,
      { class: { sourcePath: 'packs/_source/classes/fighter.yml', identifier: 'fighter', id: 'fighter' }, targetLevel: 1, selections: [{ advancementId: 'asi', kind: 'ability-score', assignments: { con: 2 }, points: 2 }] },
      { abilityScores: { fixed: { wis: 1 } } } as never,
    );
    expect(sumAbilityBonuses(sources)).toEqual({ str: 1, dex: 1, con: 2, int: 0, wis: 1, cha: 0 });
  });

  it('excludes direct and nested fixed class bonuses above the selected level', () => {
    const classSummary = { advancements: [
      { id: 'level-one', type: 'AbilityScoreImprovement', level: 1, raw: { configuration: { fixed: { str: 1 } } } },
      { id: 'nested-level-five', type: 'AbilityScoreImprovement', level: 5, nested: true, raw: { configuration: { fixed: { dex: 2 } } } },
    ] } as never;
    const progression = (targetLevel: number) => ({
      class: { sourcePath: 'packs/_source/classes/test.yml', identifier: 'test', id: 'test' },
      targetLevel,
      selections: [],
    });

    expect(collectAbilityBonuses(undefined, classSummary, progression(1), undefined).class).toEqual({ str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });
    expect(collectAbilityBonuses(undefined, classSummary, progression(5), undefined).class).toEqual({ str: 1, dex: 2, con: 0, int: 0, wis: 0, cha: 0 });
  });

  it('includes a level-20 fixed class bonus only at level 20', () => {
    const classSummary = { advancements: [
      { id: 'capstone', type: 'AbilityScoreImprovement', level: 20, raw: { configuration: { fixed: { con: 4 } } } },
    ] } as never;
    const progression = (targetLevel: number) => ({
      class: { sourcePath: 'packs/_source/classes/test.yml', identifier: 'test', id: 'test' },
      targetLevel,
      selections: [],
    });

    expect(collectAbilityBonuses(undefined, classSummary, progression(19), undefined).class.con).toBe(0);
    expect(collectAbilityBonuses(undefined, classSummary, progression(20), undefined).class.con).toBe(4);
    expect(collectAbilityBonuses(undefined, classSummary, undefined, undefined).class.con).toBe(4);
  });

  it('excludes a persisted class ability selection until its advancement level', () => {
    const classSummary = { advancements: [
      { id: 'future-asi', type: 'AbilityScoreImprovement', level: 4, raw: { configuration: { points: 2 } } },
    ] } as never;
    const progression = (targetLevel: number) => ({
      class: { sourcePath: 'packs/_source/classes/test.yml', identifier: 'test', id: 'test' },
      targetLevel,
      selections: [{ advancementId: 'future-asi', kind: 'ability-score' as const, assignments: { con: 2 }, points: 2 }],
    });

    expect(collectAbilityBonuses(undefined, classSummary, progression(1), undefined).class.con).toBe(0);
    expect(collectAbilityBonuses(undefined, classSummary, progression(4), undefined).class.con).toBe(2);
  });
});
