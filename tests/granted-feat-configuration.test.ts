import { describe, expect, it } from 'vitest';
import type { GrantedFeatSourceSummary } from '../src/character-sources';
import type { FoundrySourceReference } from '../src/foundry-source-catalog';
import { buildGrantedFeatConfiguration, getAvailableGrantedFeatSpellChoices, restoreGrantedFeatConfiguration, setGrantedFeatSpellChoice, setGrantedFeatSpellcastingAbility, toGrantedFeatSelection, validateGrantedFeatConfiguration, type GrantedFeatChoiceConfiguration } from '../src/granted-feat-configuration';

function ref(id: string, type = 'spell', name = id): FoundrySourceReference { return { sourcePath: `packs/_source/${type}/${id}.yml`, pack: 'dnd5e.spells', type, id, name }; }
function spell(id: string, level: number, lists: string[], name = id): FoundrySourceReference { return { ...ref(id, 'spell', name), level, spellLists: lists } as FoundrySourceReference; }
function dependency(id: string, level: number, lists: string[]): { uuid: string; source: FoundrySourceReference } { const source = spell(id, level, lists); return { uuid: `Compendium.dnd5e.spells.Item.${id}`, source }; }
const magicInitiate: GrantedFeatSourceSummary = {
  source: { sourcePath: 'packs/_source/feats24/magic-initiate.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'magic-initiate', name: 'Magic Initiate' },
  advancements: [{ id: 'cantrips', type: 'ItemChoice', title: 'Two Cantrips', hint: '', dependencies: [dependency('guidance', 0, ['cleric']), dependency('light', 0, ['cleric']), dependency('mage-hand', 0, ['wizard'])], spellLevel: 0, spellLists: ['cleric', 'wizard'], abilityOptions: ['int', 'wis', 'cha'], raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 2 } } }, { id: 'first', type: 'ItemChoice', title: 'Level 1 Spell', hint: '', dependencies: [dependency('bless', 1, ['cleric']), dependency('shield', 1, ['wizard'])], spellLevel: 1, spellLists: ['cleric', 'wizard'], abilityOptions: ['int', 'wis', 'cha'], raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 1 } } }],
};
const magicInitiateObjectCounts: GrantedFeatSourceSummary = {
  ...magicInitiate,
  advancements: magicInitiate.advancements.map((advancement, index) => ({ ...advancement, raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: { '0': { count: index === 0 ? 2 : 1 } } } } })),
};
function requireChoice(configuration: ReturnType<typeof buildGrantedFeatConfiguration>): GrantedFeatChoiceConfiguration { if (configuration.kind !== 'choice') throw new Error(`Expected choice, got ${configuration.kind}${configuration.kind === 'unsupported' ? `: ${configuration.reason}` : ''}`); return configuration; }

describe('granted feat configuration', () => {
  it('builds one shared list choice and two dependent spell choices', () => {
    let configuration = requireChoice(buildGrantedFeatConfiguration(magicInitiate));
    configuration = setGrantedFeatSpellChoice(configuration, configuration.spellChoices[0]!.key, ['cleric']);
    expect(configuration.spellChoices.map(({ label, count, level }) => ({ label, count, level }))).toEqual([{ label: 'Spell list', count: 1, level: 0 }, { label: 'Two Cantrips', count: 2, level: 0 }, { label: 'Level 1 Spell', count: 1, level: 1 }]);
  });
  it('filters both spell choices through one selected list and one ability', () => {
    let configuration = requireChoice(buildGrantedFeatConfiguration(magicInitiate));
    configuration = setGrantedFeatSpellChoice(configuration, configuration.spellChoices[0]!.key, ['cleric']);
    const available = getAvailableGrantedFeatSpellChoices(configuration);
    expect(available.map((choice) => choice.label)).toEqual(['Spell list', 'Two Cantrips', 'Level 1 Spell']);
    expect(available.filter((choice) => choice.label !== 'Spell list').every((choice) => choice.spellLists.join() === 'cleric')).toBe(true);
    configuration = setGrantedFeatSpellcastingAbility(configuration, 'wis');
    expect(configuration.spellChoices.filter((choice) => choice.label !== 'Spell list').map((choice) => choice.selectedAbility)).toEqual(['wis', 'wis']);
  });
  it('requires the shared list before reporting complete', () => {
    const configuration = requireChoice(buildGrantedFeatConfiguration(magicInitiate));
    expect(validateGrantedFeatConfiguration(configuration)).toContain(`Choice "${configuration.spellChoices[0]!.key}" requires 1 spell`);
  });
  it('supports Foundry object-map choice counts', () => {
    const configuration = requireChoice(buildGrantedFeatConfiguration(magicInitiateObjectCounts));
    expect(configuration.spellChoices.slice(1).map((choice) => choice.count)).toEqual([2, 1]);
  });
  it('includes full feat source identity in synthetic keys', () => {
    const alternate = buildGrantedFeatConfiguration({ ...magicInitiate, source: { ...magicInitiate.source, sourcePath: 'packs/other/magic-initiate.yml' } });
    expect(requireChoice(alternate).spellChoices[0]!.key).not.toBe(requireChoice(buildGrantedFeatConfiguration(magicInitiate)).spellChoices[0]!.key);
  });
  it('clears dependent selections when changing lists and rejects invalid spells', () => {
    let configuration = requireChoice(buildGrantedFeatConfiguration(magicInitiate));
    const listKey = configuration.spellChoices[0]!.key;
    const cantripKey = configuration.spellChoices[1]!.key;
    configuration = setGrantedFeatSpellChoice(configuration, listKey, ['cleric']);
    configuration = setGrantedFeatSpellChoice(configuration, cantripKey, [spell('guidance', 0, ['cleric'])]);
    expect(() => setGrantedFeatSpellChoice(configuration, cantripKey, [spell('guidance', 1, ['cleric']), spell('guidance', 0, ['cleric'])])).toThrow();
    configuration = setGrantedFeatSpellChoice(configuration, listKey, ['wizard']);
    expect(configuration.spellChoices.find((choice) => choice.key.endsWith(':cantrips'))?.selected).toEqual([]);
  });
  it('rejects a spell with the right identity but the wrong level or selected list', () => {
    let configuration = requireChoice(buildGrantedFeatConfiguration(magicInitiate));
    const listKey = configuration.spellChoices[0]!.key;
    const cantripKey = configuration.spellChoices[1]!.key;
    configuration = setGrantedFeatSpellChoice(configuration, listKey, ['cleric']);
    expect(() => setGrantedFeatSpellChoice(configuration, cantripKey, [spell('guidance', 1, ['cleric'])])).toThrow();
    expect(() => setGrantedFeatSpellChoice(configuration, cantripKey, [spell('mage-hand', 0, ['wizard'])])).toThrow();
  });
  it('reports an unknown persisted advancement as stale', () => {
    const configuration = requireChoice(buildGrantedFeatConfiguration(magicInitiate));
    const saved = toGrantedFeatSelection(configuration);
    const restored = restoreGrantedFeatConfiguration(configuration, { ...saved, spellChoices: [...saved.spellChoices, { key: 'feat:magic-initiate:removed', advancementId: 'removed', kind: 'spell-list', selected: [] }] });
    expect(validateGrantedFeatConfiguration(restored)).toContain('A persisted granted feat advancement reference is stale');
  });
  it('diagnoses persisted choice-kind mismatches and disallowed restored lists', () => {
    const configuration = requireChoice(buildGrantedFeatConfiguration(magicInitiate));
    const saved = toGrantedFeatSelection(configuration);
    const list = saved.spellChoices[0]!;
    const restored = restoreGrantedFeatConfiguration(configuration, { ...saved, spellChoices: [{ ...list, kind: 'spell', selected: [] as FoundrySourceReference[] }] });
    expect(validateGrantedFeatConfiguration(restored)).toContain('A persisted granted feat choice kind does not match the current source');
    const disallowed = restoreGrantedFeatConfiguration(configuration, { ...saved, spellChoices: [{ ...list, kind: 'spell-list' as const, selected: ['not-a-list'] }] });
    expect(validateGrantedFeatConfiguration(disallowed)).toContain(`Choice "${configuration.spellChoices[0]!.key}" contains a spell without an authoritative option`);
  });
  it('reports incomplete selections, stale restoration, and unsupported source shapes', () => {
    let configuration = requireChoice(buildGrantedFeatConfiguration(magicInitiate));
    configuration = setGrantedFeatSpellChoice(configuration, configuration.spellChoices[0]!.key, ['cleric']);
    const cantripsKey = configuration.spellChoices[1]!.key;
    const firstKey = configuration.spellChoices[2]!.key;
    expect(validateGrantedFeatConfiguration(configuration)).toEqual(expect.arrayContaining([`Choice "${cantripsKey}" requires 2 spells`, `Choice "${firstKey}" requires 1 spell`, `Choice "${cantripsKey}" requires a spellcasting ability`, `Choice "${firstKey}" requires a spellcasting ability`]));
    const saved = toGrantedFeatSelection(configuration);
    expect(restoreGrantedFeatConfiguration(configuration, { ...saved, feat: { ...saved.feat, id: 'stale' } })).toMatchObject({ kind: 'unsupported' });
    expect(restoreGrantedFeatConfiguration(configuration, { ...saved, spellChoices: [{ ...saved.spellChoices[0]!, advancementId: 'stale' }] })).toMatchObject({ kind: 'choice' });
    expect(validateGrantedFeatConfiguration(restoreGrantedFeatConfiguration(configuration, { ...saved, spellChoices: [{ ...saved.spellChoices[0]!, advancementId: 'stale' }] }))).toEqual(expect.arrayContaining([expect.stringContaining('advancement') ]));
    expect(buildGrantedFeatConfiguration({ ...magicInitiate, advancements: [] })).toEqual({ kind: 'none' });
    expect(buildGrantedFeatConfiguration({ ...magicInitiate, advancements: [{ ...magicInitiate.advancements[0]!, type: 'Trait' }] })).toMatchObject({ kind: 'unsupported' });
    expect(buildGrantedFeatConfiguration({ ...magicInitiate, advancements: [{ ...magicInitiate.advancements[0]!, title: 'Two Cantrips', raw: { type: 'ItemChoice', configuration: { type: 'spell' } } }] })).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('choice count') });
    expect(buildGrantedFeatConfiguration({ ...magicInitiate, advancements: [{ ...magicInitiate.advancements[0]!, dependencies: [dependency('missing', 0, [])] }] })).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('metadata') });
    const missingLists = dependency('missing-lists', 0, ['cleric']);
    delete (missingLists.source as unknown as Record<string, unknown>).spellLists;
    expect(buildGrantedFeatConfiguration({ ...magicInitiate, advancements: [{ ...magicInitiate.advancements[0]!, dependencies: [missingLists] }] })).toMatchObject({ kind: 'unsupported', reason: expect.stringContaining('metadata') });
  });
});
