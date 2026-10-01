import { describe, expect, it } from 'vitest';
import type { FoundrySourceReference } from '../src/foundry-source-catalog';
import {
  isSpellChoiceAvailable,
  setSpellChoice,
  setSpellcastingAbility,
  type SpellChoice,
  validateSpellChoices,
} from '../src/spell-configuration';

function ref(id: string, type = 'spell', name = id): FoundrySourceReference {
  return { sourcePath: `packs/_source/spells/${id}.yml`, pack: 'dnd5e.spells', type, id, name };
}

function spellRef(id: string, level: number, spellLists: string[], name = id): FoundrySourceReference & { level: number; spellLists: string[] } {
  return { ...ref(id, 'spell', name), level, spellLists };
}

const clericCantrip = spellRef('cleric-cantrip', 0, ['cleric'], 'Cleric Cantrip');
const clericLevelOneSpell = spellRef('cleric-level-one', 1, ['cleric'], 'Cleric Level One Spell');
const druidLevelOneSpell = spellRef('druid-level-one', 1, ['druid'], 'Druid Level One Spell');

function choice(overrides: Partial<SpellChoice> = {}): SpellChoice {
  return {
    key: 'spells',
    advancementId: 'advancement',
    label: 'Choose spells',
    count: 1,
    level: 1,
    spellLists: ['cleric'],
    selected: [],
    abilityOptions: [],
    selectedAbility: undefined,
    parent: undefined,
    options: [
      { value: clericLevelOneSpell.id, source: clericLevelOneSpell, label: clericLevelOneSpell.name },
    ],
    raw: { configuration: { type: 'spell' } },
    ...overrides,
  };
}

describe('shared spell-choice configuration', () => {
  it('rejects a spell from the wrong level or list', () => {
    const persistedReference = ref(clericLevelOneSpell.id, 'spell', clericLevelOneSpell.name);
    const authoritativeOption = { value: persistedReference.id, source: clericLevelOneSpell, label: persistedReference.name };
    const errors = validateSpellChoices([choice({ selected: [persistedReference], level: 0, spellLists: ['wizard'], options: [authoritativeOption] })]);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('level'),
      expect.stringContaining('spell list'),
    ]));
  });

  it('clears dependent spells when the selected spell list changes', () => {
    const spellListChoice = choice({ key: 'spell-list', label: 'Spell list', count: 1, level: 0, spellLists: [], selected: ['cleric'], raw: { configuration: { type: 'spell-list' } }, options: [
      { value: 'cleric', source: ref('cleric', 'spell-list', 'Cleric'), label: 'Cleric' },
      { value: 'druid', source: ref('druid', 'spell-list', 'Druid'), label: 'Druid' },
    ] });
    const cantripChoice = choice({ key: 'cantrips', level: 0, parent: { key: 'spell-list', values: ['cleric'] }, selected: [clericCantrip], abilityOptions: ['wisdom'], selectedAbility: 'wisdom' });
    const updated = setSpellChoice([spellListChoice, cantripChoice], 'spell-list', ['druid']);
    expect(updated.find((candidate) => candidate.key === 'cantrips')?.selected).toEqual([]);
    expect(updated.find((candidate) => candidate.key === 'cantrips')?.selectedAbility).toBeUndefined();
  });

  it('rejects duplicate and over-count selections', () => {
    const configured = choice({ count: 2, options: [
      { value: clericLevelOneSpell.id, source: clericLevelOneSpell, label: clericLevelOneSpell.name },
      { value: druidLevelOneSpell.id, source: druidLevelOneSpell, label: druidLevelOneSpell.name },
    ] });
    expect(validateSpellChoices([configured, { ...configured, selected: [clericLevelOneSpell, clericLevelOneSpell] }])).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate'),
    ]));
    expect(validateSpellChoices([{ ...configured, count: 1, selected: [clericLevelOneSpell, druidLevelOneSpell] }])).toEqual(expect.arrayContaining([
      expect.stringContaining('count'),
    ]));
  });

  it('rejects invalid spellcasting abilities', () => {
    const errors = validateSpellChoices([choice({ abilityOptions: ['intelligence', 'wisdom'], selectedAbility: 'charisma' })]);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('ability')]));
    expect(() => setSpellcastingAbility([choice({ abilityOptions: ['intelligence'] })], 'spells', 'charisma')).toThrow(/ability/i);
  });

  it('hides a choice until every parent value is selected', () => {
    const parent = choice({ key: 'parent', selected: ['one'], options: [] });
    const dependent = choice({ key: 'dependent', parent: { key: 'parent', values: ['one', 'two'] } });
    expect(isSpellChoiceAvailable(dependent, [parent, dependent])).toBe(false);
    expect(isSpellChoiceAvailable(dependent, [
      { ...parent, selected: ['one', 'two'] },
      dependent,
    ])).toBe(true);
  });

  it('clears a dependent chain recursively, including abilities', () => {
    const spellListChoice = choice({ key: 'spell-list', count: 1, level: 0, spellLists: [], selected: ['cleric'], raw: { configuration: { type: 'spell-list' } }, options: [
      { value: 'cleric', source: ref('cleric', 'spell-list', 'Cleric'), label: 'Cleric' },
      { value: 'druid', source: ref('druid', 'spell-list', 'Druid'), label: 'Druid' },
    ] });
    const child = choice({ key: 'cantrips', level: 0, parent: { key: 'spell-list', values: ['cleric'] }, selected: [clericCantrip], abilityOptions: ['wisdom'], selectedAbility: 'wisdom', options: [
      { value: clericCantrip.id, source: clericCantrip, label: clericCantrip.name },
    ] });
    const grandchild = choice({ key: 'child-follow-up', parent: { key: 'cantrips', values: [clericCantrip.id] }, selected: [clericLevelOneSpell], abilityOptions: ['intelligence'], selectedAbility: 'intelligence', options: [
      { value: clericLevelOneSpell.id, source: clericLevelOneSpell, label: clericLevelOneSpell.name },
    ] });

    const updated = setSpellChoice([spellListChoice, child, grandchild], 'spell-list', ['druid']);
    expect(updated.find((candidate) => candidate.key === 'cantrips')).toMatchObject({ selected: [], selectedAbility: undefined });
    expect(updated.find((candidate) => candidate.key === 'child-follow-up')).toMatchObject({ selected: [], selectedAbility: undefined });
  });

  it('rejects stale persisted references when the option pool is empty', () => {
    const stale = ref('removed-spell', 'spell', 'Removed Spell');
    const spellChoice = choice({ selected: [stale], options: [] });
    expect(validateSpellChoices([spellChoice])).toEqual(expect.arrayContaining([expect.stringContaining('authoritative')]));
    expect(() => setSpellChoice([spellChoice], spellChoice.key, [stale])).toThrow(/authoritative/i);
  });

  it('accepts a valid three-spell selection with source references from different packs', () => {
    const skillsToolStyle = [
      ref('arcana-spell', 'spell', 'Arcana Spell'),
      ref('tool-spell', 'spell', 'Tool Spell'),
      ref('wizard-spell', 'spell', 'Wizard Spell'),
    ];
    const configured = choice({ count: 3, spellLists: [], options: skillsToolStyle.map((source) => ({ value: source.id, source, label: source.name })) });
    expect(validateSpellChoices([{ ...configured, selected: skillsToolStyle }])).toEqual([]);
  });

  it('updates only the requested choice and preserves the original arrays', () => {
    const original = [choice()];
    const updated = setSpellChoice(original, 'spells', [clericLevelOneSpell]);
    expect(original[0].selected).toEqual([]);
    expect(updated).not.toBe(original);
    expect(updated[0]).not.toBe(original[0]);
  });
});
