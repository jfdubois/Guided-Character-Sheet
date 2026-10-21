import { describe, expect, it } from 'vitest';
import type { ClassSourceSummary } from '../src/character-sources';
import { projectClassLevelProgression, trimClassProgression } from '../src/class-level-progression';
import type { ClassProgressionSelection } from '../src/class-configuration';
import { buildClassConfiguration, setClassSelection } from '../src/class-configuration';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';

const sourcePath = 'packs/_source/classes24/wizard/wizard.yml';
function summary(progression: string, extra: Record<string, unknown> = {}): ClassSourceSummary {
  return { source: { sourcePath, pack: 'dnd5e.classes24', type: 'class', id: 'wizard', name: 'Wizard', identifier: 'wizard' }, ruleset: '2024', hitDie: 'd6', spellcasting: { progression, ability: 'int', ...extra }, advancements: [], features: [] };
}

describe('class level progression', () => {
  it('projects level two from pinned 2014 and 2024 Fighter, Rogue, and Cleric sources', async () => {
    const index = createPinnedSourceIndex();
    const diagnostics: string[] = [];
    for (const ruleset of ['2014', '2024'] as const) {
      const classes = await index.listClasses(ruleset);
      for (const className of ['Fighter', 'Rogue', 'Cleric']) {
        const option = classes.find((candidate) => candidate.name.toLocaleLowerCase() === className.toLocaleLowerCase());
        if (option === undefined) {
          diagnostics.push(`${ruleset} ${className}: pinned class source is unavailable.`);
          continue;
        }
        const pinned = await index.getClassSummary(ruleset, option.sourcePath);
        const result = projectClassLevelProgression(pinned, 2, { abilityModifiers: { wis: 2, int: 2 } });
        diagnostics.push(...result.diagnostics);
        expect(pinned.hitDie).toMatch(/^d(?:4|6|8|10|12)$/);
        expect(result.diagnostics, `${ruleset} ${className} (${option.sourcePath})`).toEqual([]);
      }
    }
    expect(diagnostics).toEqual([]);
  });

  it('projects full caster spell slots from the pinned table at the requested level', () => {
    const classSummary = summary('full');
    expect(projectClassLevelProgression(classSummary, 1).spellcasting?.spellSlots).toEqual([
      { key: 'spell:1', kind: 'spell', level: 1, maximum: 2, recovery: ['long-rest'] },
    ]);
    expect(projectClassLevelProgression(classSummary, 3).spellcasting?.spellSlots).toEqual([
      { key: 'spell:1', kind: 'spell', level: 1, maximum: 4, recovery: ['long-rest'] },
      { key: 'spell:2', kind: 'spell', level: 2, maximum: 2, recovery: ['long-rest'] },
    ]);
  });

  it('keeps source advancements gated at their declared level across both rulesets', () => {
    for (const ruleset of ['2014', '2024'] as const) {
      const classSummary = { ...summary('none'), ruleset, spellcasting: undefined, advancements: Array.from({ length: 20 }, (_, index) => ({ id: `level-${index + 1}`, type: 'ItemChoice', level: index + 1, title: 'Choice', hint: '', dependencies: [], raw: { configuration: { type: 'feat', choices: 1 } } })) };
      for (let targetLevel = 1; targetLevel <= 20; targetLevel += 1) {
        const built = buildClassConfiguration(classSummary, { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' }, targetLevel);
        expect(built.advancements.every((entry) => entry.level <= targetLevel)).toBe(true);
        expect(built.advancements).toHaveLength(targetLevel);
      }
    }
  });

  it('projects pact caster slots from the pinned pact progression', () => {
    expect(projectClassLevelProgression(summary('pact'), 3).spellcasting?.spellSlots).toEqual([
      { key: 'pact:2', kind: 'pact', level: 2, maximum: 2, recovery: ['short-rest', 'long-rest'] },
    ]);
  });

  it('treats Foundry progression none as a supported noncaster', () => {
    expect(projectClassLevelProgression(summary('none'), 5)).toEqual({ spellcasting: { spellSlots: [] }, diagnostics: [] });
  });

  it('projects source scale preparation capacity at the requested level', () => {
    const classSummary = { ...summary('full'), scales: [{ advancementId: 'capacity', title: 'Maximum Prepared', identifier: 'max-prepared', level: 1, values: new Map([[1, { type: 'number' as const, value: 4 }], [3, { type: 'number' as const, value: 6 }]]), diagnostics: [] }] };
    expect(projectClassLevelProgression(classSummary, 3).spellcasting?.preparedCapacity).toBe(6);
  });

  it('resolves a pinned 2014 Cleric preparation formula from the selected ability modifier', () => {
    const cleric = { ...summary('full', { ability: 'wis', preparation: { formula: '@abilities.wis.mod + @classes.cleric.levels' } }), ruleset: '2014' as const, source: { ...summary('full').source, identifier: 'cleric', sourcePath: 'packs/_source/classes/cleric.yml' } };
    const result = projectClassLevelProgression(cleric, 3, { abilityModifiers: { wis: 3 } });
    expect(result.spellcasting?.preparedCapacity).toBe(6);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps an unknown preparation formula diagnostic', () => {
    const cleric = { ...summary('full', { ability: 'wis', preparation: { formula: '@abilities.wis.mod * 2' } }), ruleset: '2014' as const, source: { ...summary('full').source, identifier: 'cleric', sourcePath: 'packs/_source/classes/cleric.yml' } };
    const result = projectClassLevelProgression(cleric, 3, { abilityModifiers: { wis: 3 } });
    expect(result.spellcasting?.preparedCapacity).toBeUndefined();
    expect(result.diagnostics.join(' ')).toMatch(/preparation formula.*cleric\.yml/i);
  });

  it('rejects malformed explicit spell-slot tables with a source diagnostic', () => {
    const malformed = summary('unknown', { spellSlots: { '1': 2, '2': 'three' } });
    const result = projectClassLevelProgression(malformed, 3);
    expect(result.spellcasting).toBeUndefined();
    expect(result.diagnostics.join(' ')).toMatch(/spell-slot table.*wizard\.yml/i);
  });

  it('validates level-scaled derived spell selections against the target level', () => {
    const classSummary = { ...summary('full'), spellcasting: { progression: 'full', ability: 'int', spellLists: ['wizard'] }, scales: [{ advancementId: 'cantrips', title: 'Cantrips Known', identifier: 'cantrips-known', level: 1, values: new Map([[1, { type: 'number' as const, value: 3 }], [4, { type: 'number' as const, value: 4 }]]), diagnostics: [] }] };
    const configuration = buildClassConfiguration(classSummary, { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' }, 4);
    const choice = configuration.choices.find((entry) => entry.kind === 'spell' && entry.selectionRole === 'cantrips-known');
    expect(choice?.kind === 'spell' ? choice.count : undefined).toBe(4);
    expect(choice).toBeDefined();
    expect(() => setClassSelection(configuration, choice!)).not.toThrow();
  });

  it('reports an unsupported required progression with its source path and no slots', () => {
    const result = projectClassLevelProgression(summary('mystery'), 3);
    expect(result.spellcasting?.spellSlots).toBeUndefined();
    expect(result.diagnostics.join(' ')).toContain(sourcePath);
  });

  it('trims selections and subclass above the target level', () => {
    const classSummary = { ...summary('none'), advancements: [
      { id: 'subclass', type: 'Subclass', level: 3, title: 'Subclass', hint: '', dependencies: [], raw: {} },
      { id: 'feat', type: 'AbilityScoreImprovement', level: 4, title: 'Feat', hint: '', dependencies: [], raw: {} },
      { id: 'spell', type: 'ItemChoice', level: 1, title: 'Spell', hint: '', dependencies: [], raw: {} },
    ] };
    const progression = { class: { sourcePath, identifier: 'wizard', id: 'wizard' }, targetLevel: 3, subclass: { sourcePath: 'subclass.yml', pack: 'dnd5e.classes24', type: 'subclass', id: 'sub', name: 'School' }, selections: [
      { advancementId: 'subclass', kind: 'subclass', selected: undefined, options: [] },
      { advancementId: 'feat', kind: 'ability-score', assignments: {}, points: 2 },
      { advancementId: 'spell', kind: 'spell', selectionRole: 'known-spells', selected: [], count: 1 },
    ] } as unknown as ClassProgressionSelection;
    const trimmed = trimClassProgression(progression, classSummary, 1);
    expect(trimmed.targetLevel).toBe(1);
    expect(trimmed.subclass).toBeUndefined();
    expect(trimmed.selections.map((selection) => selection.advancementId)).toEqual(['spell']);
  });

  it('does not restore hidden level choices after a lower-level trim', () => {
    const classSummary = { ...summary('none'), advancements: [
      { id: 'first', type: 'ItemChoice', level: 1, title: 'First', hint: '', dependencies: [], raw: {} },
      { id: 'third', type: 'ItemChoice', level: 3, title: 'Third', hint: '', dependencies: [], raw: {} },
    ] };
    const progression = { class: { sourcePath, identifier: 'wizard', id: 'wizard' }, targetLevel: 3, selections: [
      { advancementId: 'first', kind: 'item', selected: [], configuredPool: [] },
      { advancementId: 'third', kind: 'item', selected: [], configuredPool: [] },
    ] } as unknown as ClassProgressionSelection;
    const lowered = trimClassProgression(progression, classSummary, 1);
    const raisedAgain = trimClassProgression({ ...lowered, targetLevel: 3 }, classSummary, 3);
    expect(raisedAgain.selections.map((selection) => selection.advancementId)).toEqual(['first']);
  });
});
