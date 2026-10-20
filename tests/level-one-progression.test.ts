import { describe, expect, it } from 'vitest';
import { evaluateScaleAtLevel, getLevelOneClassProgression } from '../src/level-one-progression';
import type { ClassSourceSummary } from '../src/character-sources';

describe('evaluateScaleAtLevel', () => {
  const scale = new Map([[1, 3], [4, 4], [10, 5]]);

  it('returns the value at an exact threshold', () => expect(evaluateScaleAtLevel(scale, 4)).toBe(4));
  it('returns the value at the nearest lower threshold', () => expect(evaluateScaleAtLevel(scale, 6)).toBe(4));
  it('returns a typed value unchanged at the nearest lower threshold', () => {
    const dice = { type: 'dice' as const, number: 1, faces: 6, modifiers: [] };
    expect(evaluateScaleAtLevel(new Map([[1, dice], [5, { type: 'dice' as const, number: 2, faces: 6, modifiers: [] }]]), 4)).toBe(dice);
  });
  it('returns undefined when no threshold applies', () => expect(evaluateScaleAtLevel(scale, 0)).toBeUndefined());
  it('returns undefined for an invalid level', () => expect(evaluateScaleAtLevel(scale, -1)).toBeUndefined());
  it('uses the nearest lower threshold for an independent scale', () => {
    const independent = new Map([[1, 4], [2, 5]]);
    expect(evaluateScaleAtLevel(independent, 1)).toBe(4);
    expect(evaluateScaleAtLevel(independent, 2)).toBe(5);
    expect(evaluateScaleAtLevel(independent, 3)).toBe(5);
  });
  it.each([1.5, Number.NaN, -1])('returns undefined for invalid level %s', (level) => expect(evaluateScaleAtLevel(scale, level)).toBeUndefined());
});

describe('getLevelOneClassProgression', () => {
  it('projects Wizard level-one spellcasting without selecting prepared spells', () => {
    const summary = {
      source: { identifier: 'wizard', name: 'Wizard' },
      ruleset: '2024', hitDie: 'd6',
      spellcasting: { progression: 'full', ability: 'int' },
      features: [{ advancementId: 'spellcasting', level: 1, source: { name: 'Spellcasting' }, description: 'At 1st level, you know three cantrips. Your spellbook contains six 1st-level spells. Choose four spells from your spellbook.' }],
      scales: [], advancements: [],
    } as unknown as ClassSourceSummary;

    expect(getLevelOneClassProgression(summary)).toEqual({
      classIdentifier: 'wizard', level: 1, proficiencyBonus: 2,
      spellcasting: { spellcastingAbility: 'Intelligence', cantripsKnown: 3, spellbookSpells: 6, preparedSpells: 4, spellLists: [], spellSlots: [{ key: 'spell:1', kind: 'spell', level: 1, maximum: 2, recovery: ['long-rest'] }] },
      scales: [],
    });
  });

  it('does not invent Wizard counts when source content is incomplete', () => {
    const summary = { source: { identifier: 'wizard', name: 'Wizard' }, ruleset: '2024', hitDie: 'd6', spellcasting: { progression: 'full', ability: 'int' }, features: [], scales: [], advancements: [] } as unknown as ClassSourceSummary;
    expect(getLevelOneClassProgression(summary).spellcasting).toEqual({ spellcastingAbility: 'Intelligence', spellLists: [] });
  });

  it('projects the pinned level-one Pact Magic progression with short-rest recovery', () => {
    const summary = { source: { identifier: 'warlock', name: 'Warlock' }, ruleset: '2024', hitDie: 'd8', spellcasting: { progression: 'pact', ability: 'cha' }, features: [], scales: [], advancements: [] } as unknown as ClassSourceSummary;
    expect(getLevelOneClassProgression(summary).spellcasting?.spellSlots).toEqual([{ key: 'pact:1', kind: 'pact', level: 1, maximum: 1, recovery: ['short-rest', 'long-rest'] }]);
  });

  it('does not apply the 2024 Pact compatibility mapping to a 2014 class', () => {
    const summary = { source: { identifier: 'warlock', name: 'Warlock' }, ruleset: '2014', hitDie: 'd8', spellcasting: { progression: 'pact', ability: 'cha' }, features: [], scales: [], advancements: [] } as unknown as ClassSourceSummary;
    expect(getLevelOneClassProgression(summary).spellcasting?.spellSlots).toBeUndefined();
  });
});
