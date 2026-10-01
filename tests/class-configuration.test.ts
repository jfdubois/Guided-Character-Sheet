import { describe, expect, it } from 'vitest';
import { buildClassConfiguration, getLevelOneDerivedSpellChoices, mergeClassSelection, restoreClassConfiguration, setClassSelection, toClassProgressionSelection, validateClassConfiguration, type ClassAdvancementSelection } from '../src/class-configuration';
import type { ClassSourceSummary } from '../src/character-sources';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };
const ref = (id: string, type: string, name = id) => ({ sourcePath: `packs/_source/${type}/${id}.yml`, pack: `dnd5e.${type}s`, type, id, name });

function summary(advancements: ClassSourceSummary['advancements']): ClassSourceSummary {
  return { source: { ...ref('wizard-id', 'class', 'Wizard'), identifier: 'wizard' }, ruleset: '2024', hitDie: 'd6', advancements };
}

describe('class configuration', () => {
  it('projects wizard level-one cantrips and spellbook choices without prepared choices', () => {
    const result = getLevelOneDerivedSpellChoices({ ...summary([]), source: { ...summary([]).source, sourcePath: 'packs/_source/classes24/wizard/wizard.yml' }, spellcasting: { ability: 'int', cantripsKnown: 3, spellbookSpells: 6, preparedSpells: 4, spellLists: ['wizard'] } });
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ selectionRole: 'cantrips-known', count: 3, level: 0, spellLists: ['wizard'], ability: 'int' }),
      expect.objectContaining({ selectionRole: 'spellbook', count: 6, level: 1, spellLists: ['wizard'], ability: 'int' }),
    ]));
    expect(result).toHaveLength(2);
    expect(result.every((choice) => choice.kind === 'spell')).toBe(true);
  });

  it('validates derived spell level and class list and restores valid selections', () => {
    const wizardCantrip = { ...ref('light', 'spells', 'Light'), type: 'spell' as const, level: 0, spellLists: ['wizard'] };
    const bardSpell = { ...ref('charm', 'spells', 'Charm Person'), type: 'spell' as const, level: 1, spellLists: ['bard'] };
    const wizardFirstLevel = { ...ref('shield', 'spells', 'Shield'), type: 'spell' as const, level: 1, spellLists: ['wizard'] };
    const result = buildClassConfiguration({ ...summary([]), source: { ...summary([]).source, identifier: 'bard' }, spellcasting: { ability: 'cha', cantripsKnown: 2, learnedSpells: 4, spellLists: ['bard'] }, spellOptions: [wizardCantrip, wizardFirstLevel, bardSpell] }, snapshot, 1);
    const choice = result.choices.find((entry): entry is Extract<ClassAdvancementSelection, { kind: 'spell' }> => entry.kind === 'spell' && entry.selectionRole === 'known-spells');
    if (choice === undefined) throw new Error('Expected derived choice');
    expect(() => setClassSelection(result, { ...choice, selected: [wizardCantrip] })).toThrow(/level/);
    expect(() => setClassSelection(result, { ...choice, selected: [wizardFirstLevel] })).toThrow(/list/);
    expect(setClassSelection(result, { ...choice, selected: [bardSpell] }).selections).toEqual(expect.arrayContaining([expect.objectContaining({ advancementId: choice.advancementId, selected: [bardSpell] })]));
    const restored = restoreClassConfiguration({ ...toClassProgressionSelection(result), selections: [{ ...choice, selected: [bardSpell] }] }, { summary: result.summary, configuration: result, class: result.class });
    expect(restored.diagnostics).not.toEqual(expect.arrayContaining([expect.stringContaining('Invalid class selection')]));
  });

  it('rejects forged and cross-class derived choice IDs during set and restore', () => {
    const source = { ...summary([]), source: { ...summary([]).source, sourcePath: 'packs/_source/classes24/bard/bard.yml', identifier: 'bard' }, spellcasting: { cantripsKnown: 2, spellLists: ['bard'] } };
    const configuration = buildClassConfiguration(source, snapshot, 1);
    const forged = { advancementId: 'derived:packs/_source/classes24/wizard/wizard.yml:cantrips-known', kind: 'spell' as const, selectionRole: 'cantrips-known' as const, selected: [], count: 2, level: 0, spellLists: ['bard'] };
    expect(() => setClassSelection(configuration, forged)).toThrow(/Unknown class advancement/);
    const restored = restoreClassConfiguration({ ...toClassProgressionSelection(configuration), selections: [forged] }, { summary: source, configuration, class: configuration.class });
    expect(restored.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining('Unknown class advancement')]));
  });

  it('rejects same-class derived choices with forged metadata during set and restore', () => {
    const bardSpell = { ...ref('charm', 'spells', 'Charm Person'), type: 'spell' as const, level: 1, spellLists: ['bard'] };
    const source = { ...summary([]), source: { ...summary([]).source, sourcePath: 'packs/_source/classes24/bard/bard.yml', identifier: 'bard' }, spellcasting: { ability: 'cha', learnedSpells: 4, spellLists: ['bard'] }, spellOptions: [bardSpell] };
    const configuration = buildClassConfiguration(source, snapshot, 1);
    const choice = configuration.choices.find((entry): entry is Extract<ClassAdvancementSelection, { kind: 'spell' }> => entry.kind === 'spell' && entry.selectionRole === 'known-spells');
    if (choice === undefined) throw new Error('Expected derived choice');
    const forgedChoices = [
      { selectionRole: 'cantrips-known' as const },
      { count: choice.count! + 1 },
      { level: 0 },
      { spellLists: ['wizard'] },
    ];
    for (const metadata of forgedChoices) {
      const forged = { ...choice, ...metadata, selected: [bardSpell] };
      expect(() => setClassSelection(configuration, forged)).toThrow(/Invalid class advancement metadata/);
      const restored = restoreClassConfiguration({ ...toClassProgressionSelection(configuration), selections: [forged] }, { summary: source, configuration, class: configuration.class });
      expect(restored.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining('Invalid class advancement metadata')]));
    }
  });

  it('projects the normalized level-one roles for every 2024 spellcasting profile', () => {
    const profiles = [
      ['wizard', 3, 6, undefined], ['bard', 2, undefined, 4], ['cleric', 0, undefined, undefined], ['druid', 2, undefined, undefined],
      ['sorcerer', 4, undefined, 4], ['warlock', 3, undefined, 2], ['paladin', 0, undefined, undefined], ['ranger', 0, undefined, 2],
    ] as const;
    for (const [identifier, cantrips, spellbook, known] of profiles) {
      const choices = getLevelOneDerivedSpellChoices({ ...summary([]), source: { ...summary([]).source, identifier, sourcePath: `packs/_source/classes24/${identifier}.yml` }, spellcasting: { ability: 'wis', cantripsKnown: cantrips, spellbookSpells: spellbook, learnedSpells: known, preparedSpells: 4, spellLists: [identifier] } });
      const spellChoices = choices.filter((choice): choice is Extract<ClassAdvancementSelection, { kind: 'spell' }> => choice.kind === 'spell');
      expect(spellChoices.map((choice) => [choice.selectionRole, choice.count])).toEqual([
        ...(cantrips > 0 ? [['cantrips-known', cantrips] as const] : []),
        ...(spellbook !== undefined ? [['spellbook', spellbook] as const] : []),
        ...(known !== undefined ? [['known-spells', known] as const] : []),
      ]);
      expect(spellChoices.map((choice) => choice.selectionRole)).not.toContain('prepared-spells');
    }
  });

  it('preserves incomplete derived spell metadata and excludes prepared assignments from persistence', () => {
    const source = { ...summary([]), source: { ...summary([]).source, identifier: 'wizard', sourcePath: 'packs/_source/classes24/wizard/wizard.yml' }, spellcasting: { ability: 'int', cantripsKnown: 3, spellbookSpells: 6, preparedSpells: 4, spellLists: ['wizard'] } };
    const configuration = buildClassConfiguration(source, snapshot, 1);
    const saved = toClassProgressionSelection(configuration);
    expect(saved.selections).toEqual(expect.arrayContaining([
      expect.objectContaining({ selectionRole: 'cantrips-known', count: 3, level: 0, spellLists: ['wizard'] }),
      expect.objectContaining({ selectionRole: 'spellbook', count: 6, level: 1, spellLists: ['wizard'] }),
    ]));
    expect(saved.selections.some((selection) => selection.kind === 'spell' && (selection.selectionRole as string) === 'prepared-spells')).toBe(false);
    expect(() => JSON.parse(JSON.stringify({ ...saved, selections: saved.selections.map((selection) => selection.kind === 'spell' ? { ...selection, selectionRole: 'prepared-spells' } : selection) }))).not.toThrow();
  });

  it('rebuilds derived spell options when restoring a saved progression', () => {
    const spell = { ...ref('light', 'spells', 'Light'), type: 'spell' as const, level: 0, spellLists: ['wizard'] };
    const source = { ...summary([]), source: { ...summary([]).source, sourcePath: 'packs/_source/classes24/wizard/wizard.yml' }, spellcasting: { ability: 'int', cantripsKnown: 1, spellLists: ['wizard'] }, spellOptions: [spell] };
    const configuration = buildClassConfiguration(source, snapshot, 1);
    const saved = toClassProgressionSelection(configuration);
    const savedChoice = saved.selections.find((entry): entry is Extract<ClassAdvancementSelection, { kind: 'spell' }> => entry.kind === 'spell');
    if (savedChoice === undefined) throw new Error('Expected saved spell choice');
    const restored = restoreClassConfiguration({ ...saved, selections: [{ ...savedChoice, selected: [spell], options: [] }] }, { summary: source, configuration, class: configuration.class });
    expect(restored.selections.find((entry) => entry.advancementId === savedChoice.advancementId)).toMatchObject({ selected: [spell], options: [{ source: { id: 'light' } }] });
  });

  it('rejects target level zero', () => {
    expect(() => buildClassConfiguration(summary([]), snapshot, 0)).toThrow('Invalid class target level');
  });

  it('diagnoses unsupported advancement types but not known passive types', () => {
    const result = buildClassConfiguration(summary([
      { id: 'hp', type: 'HitPoints', level: 1, title: '', hint: '', dependencies: [], raw: {} },
      { id: 'empty', type: 'Trait', level: 1, title: '', hint: '', dependencies: [], raw: { configuration: {} } },
      { id: 'bad', type: 'FutureType', level: 1, title: '', hint: '', dependencies: [], raw: {} },
    ]), snapshot, 1);
    expect(result.diagnostics).toEqual([expect.stringContaining('bad (FutureType)')]);
  });
  it('filters by target level and activates only primary class advancements', () => {
    const result = buildClassConfiguration(summary([
      { id: 'zero', type: 'Trait', level: 0, title: 'Origin', hint: '', dependencies: [], raw: {} },
      { id: 'one', type: 'Trait', level: 1, title: 'One', hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: ['a'] } } },
      { id: 'two', type: 'Trait', level: 2, title: 'Two', hint: '', dependencies: [], raw: {} },
      { id: 'primary', type: 'Trait', level: 1, title: 'Primary', hint: '', classRestriction: 'primary', dependencies: [], raw: {} },
      { id: 'secondary', type: 'Trait', level: 1, title: 'Secondary', hint: '', classRestriction: 'secondary', dependencies: [], raw: {} },
    ]), snapshot, 1);
    expect(result.advancements.map((entry) => entry.id)).toEqual(['zero', 'one', 'primary']);
    expect(result.choices.map((entry) => entry.advancementId)).toEqual(['one']);
  });

  it('projects exactly two level-one Rogue expertise choices and excludes later-level expertise', () => {
    const result = buildClassConfiguration(summary([
      { id: 'expertise', type: 'Trait', level: 1, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: 2, pool: ['skills:*'] } } },
      { id: 'later-expertise', type: 'Trait', level: 6, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: 2, pool: ['skills:*'] } } },
    ]), snapshot, 1);
    const expertise = result.choices.filter((choice) => choice.kind === 'expertise');
    expect(expertise).toHaveLength(1);
    expect(expertise[0]).toMatchObject({ advancementId: 'expertise', mode: 'expertise', configuredPool: ['skills:*'], selected: [] });
    expect(result.advancements.map((advancement) => advancement.id)).toEqual(['expertise']);
    const selected = setClassSelection(result, { ...expertise[0]!, selected: ['skills:arc', 'skills:ste'] });
    expect(selected.selections).toEqual(expect.arrayContaining([expect.objectContaining({ advancementId: 'expertise', kind: 'expertise', selected: ['skills:arc', 'skills:ste'] })]));
  });

  it('projects the pinned 2024 Rogue expertise advancement at level one', async () => {
    const rogue = await createPinnedSourceIndex().getClassSummary('2024', 'packs/_source/classes24/rogue/rogue.yml');
    const configuration = buildClassConfiguration(rogue, snapshot, 1);

    expect(configuration.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ advancementId: '4doj2kFD8sIYiX8X', kind: 'expertise', mode: 'expertise', configuredPool: ['skills:*'], selected: [] }),
    ]));
    expect(configuration.choices.some((choice) => choice.advancementId === 'sqWH6tnUg7jiGaEj')).toBe(false);
  });

  it('restores a newly required expertise choice when an older save omitted it', () => {
    const source = buildClassConfiguration(summary([{ id: 'expertise', type: 'Trait', level: 1, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: 2, pool: ['skills:*'] } } }]), snapshot, 1);
    const restored = restoreClassConfiguration({ class: source.class, targetLevel: 1, selections: [] }, { summary: source.summary, class: source.class, configuration: source });

    expect(restored.choices).toEqual([expect.objectContaining({ advancementId: 'expertise', kind: 'expertise', selected: [] })]);
  });

  it('keeps subclass pending and separates interactive choices from passive selections', () => {
    const result = buildClassConfiguration(summary([{ id: 'subclass', type: 'Subclass', level: 1, title: 'Subclass', hint: '', dependencies: [{ uuid: 'school', source: ref('school', 'subclasses', 'School') }], raw: { configuration: {} } }, { id: 'passive', type: 'ScaleValue', level: 1, title: 'Passive', hint: '', dependencies: [], raw: {} }]), snapshot, 1);
    expect(result.selections[0]).toMatchObject({ kind: 'subclass', options: [{ id: 'school' }] });
    expect(result.selections[0]).not.toHaveProperty('selected');
    expect(result.choices).toEqual(result.selections);
    expect(result.passiveSelections).toEqual([]);
  });

  it('rejects duplicate, over-cardinality, and unconfigured item or spell references', () => {
    const result = buildClassConfiguration(summary([{ id: 'item', type: 'ItemChoice', level: 1, title: 'Items', hint: '', dependencies: [{ uuid: 'gear', source: ref('gear', 'equipment') }], raw: { configuration: { choices: 1, type: 'equipment', pool: ['gear'] } } }]), snapshot, 1);
    expect(() => setClassSelection(result, { advancementId: 'item', kind: 'item', selected: [ref('gear', 'equipment'), ref('gear', 'equipment')] })).toThrow(/Duplicate/);
    expect(() => setClassSelection(result, { advancementId: 'item', kind: 'item', selected: [ref('gear', 'equipment'), ref('gear2', 'equipment')] })).toThrow(/cardinality/);
    expect(() => setClassSelection(result, { advancementId: 'item', kind: 'item', selected: [ref('other', 'equipment')] })).toThrow(/value/);
  });

  it('uses nested Trait pools and string or uuid spell pools as authoritative', () => {
    const result = buildClassConfiguration(summary([{ id: 'trait', type: 'Trait', level: 1, title: 'Trait', hint: '', dependencies: [{ uuid: 'in-pool', source: ref('in-pool', 'skill') }, { uuid: 'only-dependency', source: ref('only-dependency', 'skill') }], raw: { configuration: { choices: [{ count: 1, pool: ['in-pool'] }] } } }, { id: 'spell', type: 'ItemChoice', level: 1, title: 'Spell', hint: '', dependencies: [{ uuid: 'spell', source: ref('spell', 'spell') }, { uuid: 'other', source: ref('other', 'spell') }], raw: { configuration: { choices: 1, type: 'spell', pool: [{ uuid: 'spell' }] } } }]), snapshot, 1);
    expect(() => setClassSelection(result, { advancementId: 'trait', kind: 'trait', selected: ['only-dependency'] })).toThrow(/value/);
    expect(() => setClassSelection(result, { advancementId: 'spell', kind: 'spell', selectionRole: 'known-spells', selected: [ref('other', 'spell')] })).toThrow(/value/);
  });

  it('accepts item pools stored under numbered Foundry choice groups', () => {
    const source = buildClassConfiguration(summary([{ id: 'style', type: 'ItemChoice', level: 1, title: 'Fighting style', hint: '', dependencies: [{ uuid: 'Compendium.dnd5e.classfeatures.defense', source: ref('defense', 'classfeatures', 'Defense') }], raw: { configuration: { choices: { '1': { count: 1, pool: ['Compendium.dnd5e.classfeatures.defense'] } }, type: 'feat' } } }]), snapshot, 1);
    expect(() => setClassSelection(source, { advancementId: 'style', kind: 'item', selected: [ref('defense', 'classfeatures', 'Defense')] })).not.toThrow();
  });

  it('enforces cardinality for nested Trait choice arrays', () => {
    const result = buildClassConfiguration(summary([{ id: 'trait', type: 'Trait', level: 1, title: 'Trait', hint: '', dependencies: [{ uuid: 'a', source: ref('a', 'skill') }, { uuid: 'b', source: ref('b', 'skill') }], raw: { configuration: { choices: [{ count: 1, pool: ['a', 'b'] }] } } }]), snapshot, 1);
    expect(() => setClassSelection(result, { advancementId: 'trait', kind: 'trait', selected: ['a', 'b'] })).toThrow(/cardinality/);
  });

  it('enforces nested choice-group counts independently', () => {
    const result = buildClassConfiguration(summary([{ id: 'trait', type: 'Trait', level: 1, title: 'Trait', hint: '', dependencies: [{ uuid: 'a', source: ref('a', 'skill') }, { uuid: 'b', source: ref('b', 'skill') }, { uuid: 'c', source: ref('c', 'skill') }], raw: { configuration: { choices: [{ count: 1, pool: ['a', 'b'] }, { count: 1, pool: ['c'] }] } } }]), snapshot, 1);
    expect(() => setClassSelection(result, { advancementId: 'trait', kind: 'trait', selected: ['a', 'b'] })).toThrow(/cardinality/);
    expect(() => setClassSelection(result, { advancementId: 'trait', kind: 'trait', selected: ['a', 'c'] })).not.toThrow();
  });

  it('rejects invalid ASI assignments but does not enforce recommendations', () => {
    const result = buildClassConfiguration(summary([{ id: 'asi', type: 'AbilityScoreImprovement', level: 1, title: 'ASI', hint: '', dependencies: [], raw: { configuration: { points: 2, cap: 2, locked: ['int'], allowedAbilities: ['int'], recommendation: { int: 2 } } } }]), snapshot, 1);
    const base = { advancementId: 'asi' as const, kind: 'ability-score' as const, points: 2, cap: 2, locked: ['int'], recommendation: { int: 2 }, assignments: { foo: 2 } };
    expect(() => setClassSelection(result, base)).toThrow(/Unrecognized/);
    expect(() => setClassSelection(result, { ...base, assignments: { int: 2 } })).toThrow(/Locked/);
    expect(() => setClassSelection(result, { ...base, locked: [], assignments: { int: 1.5 } })).toThrow(/Invalid ASI/);
    expect(() => setClassSelection(result, { ...base, locked: [], assignments: { int: 3 } })).toThrow(/cap/);
    expect(() => setClassSelection(result, { ...base, locked: [], assignments: { int: 1 } })).toThrow(/point total/);
  });

  it('projects supported Foundry advancements into typed selections', () => {
    const result = buildClassConfiguration(summary([
      { id: 'trait', type: 'Trait', level: 1, title: 'Skills', hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: ['arcana'] } } },
      { id: 'item', type: 'ItemChoice', level: 1, title: 'Gear', hint: '', dependencies: [{ uuid: 'gear', source: ref('gear', 'equipment', 'Gear') }], raw: { configuration: { choices: 1, type: 'equipment', pool: ['gear'] } } },
      { id: 'spell', type: 'ItemChoice', level: 1, title: 'Cantrip', hint: '', dependencies: [{ uuid: 'spell', source: ref('spell', 'spells', 'Spell') }], raw: { configuration: { choices: 1, type: 'spell', pool: ['spell'] } } },
      { id: 'subclass', type: 'Subclass', level: 1, title: 'Subclass', hint: '', dependencies: [{ uuid: 'school', source: ref('school', 'subclasses', 'School') }], raw: { configuration: { choices: 1 } } },
      { id: 'asi', type: 'AbilityScoreImprovement', level: 1, title: 'ASI', hint: '', dependencies: [], raw: { configuration: { points: 2, cap: 20, abilities: ['int', 'dex'], recommendation: { int: 1 }, choices: 1 } } },
    ]), snapshot, 1);
    expect(result.selections.map((entry) => entry.kind)).toEqual(['trait', 'item', 'spell', 'subclass', 'ability-score']);
    expect(result.selections.at(-1)).toMatchObject({ advancementId: 'asi', points: 2, cap: 20, locked: undefined, recommendation: { int: 1 } });
  });

  it('projects class spells into the shared choice shape without broadening an explicit pool', () => {
    const cantrip = { ...ref('cantrip', 'spells', 'Light'), type: 'spell' as const, level: 0, spellLists: ['wizard'] };
    const result = buildClassConfiguration(summary([{ id: 'spells', type: 'ItemChoice', level: 1, title: 'Cantrips', hint: '', spellLevel: 0, spellLists: ['wizard'], abilityOptions: ['Intelligence'], dependencies: [{ uuid: 'cantrip', source: cantrip }], raw: { configuration: { choices: 1, type: 'spell', pool: ['cantrip'], spell: { ability: ['int'] }, restriction: { level: 0, list: ['class:wizard'] } } } }]), snapshot, 1);
    const choice = result.choices.find((entry): entry is Extract<ClassAdvancementSelection, { kind: 'spell' }> => entry.kind === 'spell');
    if (choice === undefined) throw new Error('Expected spell choice');
    expect(choice).toMatchObject({ kind: 'spell', count: 1, level: 0, spellLists: ['wizard'], abilityOptions: ['Intelligence'], options: [{ source: { id: 'cantrip' } }] });
    expect(() => setClassSelection(result, { ...choice, selected: [ref('other', 'spells', 'Other')] })).toThrow(/value/);
    expect(() => setClassSelection(result, { ...choice, selected: [cantrip], selectedAbility: 'Charisma' })).toThrow(/ability/);
    expect(setClassSelection(result, { ...choice, selected: [cantrip], selectedAbility: 'Intelligence' }).choices[0]).toMatchObject({ selected: [{ id: 'cantrip' }], selectedAbility: 'Intelligence' });
  });

  it('reveals a dependent cantrip only after its parent feature is selected', () => {
    const magician = ref('magician', 'classfeatures', 'Primal Order: Magician');
    const cantrip = { ...ref('cantrip', 'spells', 'Produce Flame'), type: 'spell' as const, level: 0, spellLists: ['druid'] };
    const result = buildClassConfiguration(summary([
      { id: 'primal-order', type: 'ItemChoice', level: 1, title: 'Primal Order', hint: '', dependencies: [{ uuid: 'Compendium.dnd5e.classfeatures24.Item.magician', source: magician }], raw: { configuration: { choices: 1, type: 'feat', pool: ['Compendium.dnd5e.classfeatures24.Item.magician'] } } },
      { id: 'magician-cantrip', type: 'ItemChoice', level: 1, title: 'Primal Order: Magician', hint: '', spellLevel: 0, spellLists: ['druid'], dependencies: [{ uuid: 'cantrip', source: cantrip }], requiresChoice: { key: 'class:primal-order', value: 'Compendium.dnd5e.classfeatures24.Item.magician' }, raw: { configuration: { choices: 1, type: 'spell', restriction: { level: 0, list: ['class:druid'] } } } },
    ]), snapshot, 1);
    expect(result.choices.map((entry) => entry.advancementId)).toEqual(['primal-order']);
    const selected = setClassSelection(result, { ...result.choices[0], selected: [magician] } as Extract<ClassAdvancementSelection, { kind: 'item' }>);
    expect(selected.choices.map((entry) => entry.advancementId)).toEqual(['primal-order', 'magician-cantrip']);
    const withSpell = setClassSelection(selected, { ...selected.choices[1], selected: [cantrip] } as Extract<ClassAdvancementSelection, { kind: 'spell' }>);
    const cleared = setClassSelection(withSpell, { ...withSpell.choices[0], selected: [] } as Extract<ClassAdvancementSelection, { kind: 'item' }>);
    expect(cleared.selections.find((entry) => entry.advancementId === 'magician-cantrip')).toMatchObject({ selected: [] });
  });

  it('uses the active target level when selecting a numbered spell choice group', () => {
    const spell = { ...ref('spell', 'spells', 'Spell'), type: 'spell' as const };
    const spellTwo = { ...ref('spell-two', 'spells', 'Spell two'), type: 'spell' as const };
    const advancement = { id: 'spells', type: 'ItemChoice', level: 1, title: 'Spells', hint: '', spellLevel: 1, spellLists: [], abilityOptions: [], dependencies: [{ uuid: 'spell', source: spell }, { uuid: 'spell-two', source: spellTwo }], raw: { configuration: { type: 'spell', pool: ['spell', 'spell-two'], choices: { '1': { count: 1 }, '5': { count: 2 } } } } };
    const levelOne = buildClassConfiguration(summary([advancement]), snapshot, 1);
    const levelFive = buildClassConfiguration(summary([advancement]), snapshot, 5);
    expect(levelOne.choices[0]).toMatchObject({ count: 1 });
    expect(levelFive.choices[0]).toMatchObject({ count: 2 });
    expect(() => setClassSelection(levelOne, { ...levelOne.choices[0], selected: [spell, spellTwo] } as Extract<ClassAdvancementSelection, { kind: 'spell' }>)).toThrow(/cardinality/);
    expect(() => setClassSelection(levelFive, { ...levelFive.choices[0], selected: [spell, spellTwo] } as Extract<ClassAdvancementSelection, { kind: 'spell' }>)).not.toThrow();
  });

  it('validates, restores, and serializes typed selections without dropping unresolved references', () => {
    const source = buildClassConfiguration(summary([{ id: 'trait', type: 'Trait', level: 1, title: 'Skills', hint: '', dependencies: [{ uuid: 'arcana', source: ref('arcana', 'skills', 'Arcana') }], raw: { configuration: { choices: 1, pool: ['arcana'] } } }]), snapshot, 1);
    const selected = setClassSelection(source, { advancementId: 'trait', kind: 'trait', selected: ['arcana'] });
    const saved = toClassProgressionSelection(selected);
    const restored = restoreClassConfiguration({ ...saved, selections: [...saved.selections, { advancementId: 'missing', kind: 'item', selected: [ref('gone', 'feat', 'Gone')] }] }, { summary: source.summary, snapshot, class: source.class, configuration: source });
    expect(validateClassConfiguration(restored, { summary: source.summary, snapshot, class: source.class, configuration: source })).toEqual(expect.arrayContaining([expect.stringContaining('Unknown class advancement')]));
    expect(restored.selections.at(-1)).toMatchObject({ advancementId: 'missing', selected: [{ id: 'gone' }] });
  });

  it('merges one changed selection without clearing other class choices', () => {
    const source = buildClassConfiguration(summary([
      { id: 'metamagic', type: 'ItemChoice', level: 1, title: 'Metamagic', hint: '', dependencies: [{ uuid: 'careful', source: ref('careful', 'classfeatures', 'Careful Spell') }], raw: { configuration: { choices: 1, type: 'feat', pool: ['careful'] } } },
      { id: 'origin', type: 'Subclass', level: 1, title: 'Sorcerous Origin', hint: '', dependencies: [{ uuid: 'draconic', source: ref('draconic', 'subclasses', 'Draconic Bloodline') }], raw: { configuration: {} } },
    ]), snapshot, 1);
    const withMetamagic = setClassSelection(source, { advancementId: 'metamagic', kind: 'item', selected: [ref('careful', 'classfeatures', 'Careful Spell')] });
    const merged = mergeClassSelection(toClassProgressionSelection(withMetamagic), { advancementId: 'origin', kind: 'subclass', options: [ref('draconic', 'subclasses', 'Draconic Bloodline')], selected: ref('draconic', 'subclasses', 'Draconic Bloodline') });
    expect(merged.selections).toEqual(expect.arrayContaining([
      expect.objectContaining({ advancementId: 'metamagic', selected: [expect.objectContaining({ id: 'careful' })] }),
      expect.objectContaining({ advancementId: 'origin', selected: expect.objectContaining({ id: 'draconic' }) }),
    ]));
  });

  it('keeps class choice order stable when a later choice changes', () => {
    const source = buildClassConfiguration(summary([
      { id: 'skills', type: 'Trait', level: 1, title: 'Skill proficiencies', hint: '', dependencies: [], raw: { configuration: { choices: 2, pool: ['athletics', 'insight'] } } },
      { id: 'style', type: 'ItemChoice', level: 1, title: 'Fighting style', hint: '', dependencies: [{ uuid: 'defense', source: ref('defense', 'classfeatures', 'Defense') }], raw: { configuration: { choices: 1, type: 'feat', pool: ['defense'] } } },
    ]), snapshot, 1);
    const withStyle = setClassSelection(source, { advancementId: 'style', kind: 'item', selected: [ref('defense', 'classfeatures', 'Defense')] });
    const withSkills = setClassSelection(withStyle, { advancementId: 'skills', kind: 'trait', selected: ['athletics', 'insight'] });
    expect(withSkills.choices.map((choice) => choice.advancementId)).toEqual(['skills', 'style']);
    expect(withSkills.choices[1]).toMatchObject({ advancementId: 'style', selected: [{ id: 'defense' }] });
  });

  it('reports source, class, and target-level mismatches during restoration', () => {
    const source = buildClassConfiguration(summary([]), snapshot, 1);
    const restored = restoreClassConfiguration({ class: { ...source.class, id: 'other' }, targetLevel: 2, selections: [] }, { summary: source.summary, snapshot: { ...snapshot, commit: 'b'.repeat(40) }, class: source.class, configuration: source });
    expect(restored.diagnostics).toEqual(expect.arrayContaining(['Class source snapshot differs from current source', 'Class does not match source summary']));
    expect(validateClassConfiguration(restored, { summary: source.summary, snapshot, class: source.class, configuration: source })).toEqual(expect.arrayContaining(['Class source snapshot differs from current source', 'Class does not match source summary']));
  });

  it('preserves saved later-level selections without exposing them as active choices', () => {
    const later = { id: 'later', type: 'ItemChoice', level: 2, title: 'Eldritch Invocations', hint: '', dependencies: [{ uuid: 'agonizing-blast', source: ref('agonizing-blast', 'classfeatures', 'Agonizing Blast') }], raw: { configuration: { choices: 1, type: 'feat', pool: ['agonizing-blast'] } } };
    const source = { ...summary([later]), source: { ...summary([]).source } };
    const configuration = buildClassConfiguration(source, snapshot, 1);
    const saved = { class: configuration.class, targetLevel: 1, selections: [{ advancementId: 'later', kind: 'item' as const, selected: [ref('agonizing-blast', 'classfeatures', 'Agonizing Blast')], configuredPool: ['agonizing-blast'] }] };
    const restored = restoreClassConfiguration(saved, { summary: source, configuration, class: configuration.class });
    expect(restored.selections).toEqual(expect.arrayContaining([expect.objectContaining({ advancementId: 'later' })]));
    expect(restored.choices).toEqual([]);
  });
});
