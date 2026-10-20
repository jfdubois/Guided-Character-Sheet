import { describe, expect, it } from 'vitest';
import { collectEligibleCharacterEffects } from '../src/eligible-character-effects';
import type { CharacterDocument } from '../src/character-model';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from '../src/character-sources';
import type { FoundrySourceReference } from '../src/foundry-source-catalog';

const reference = (name: string, id = name.toLowerCase()): FoundrySourceReference => ({ sourcePath: `${id}.yml`, pack: 'dnd5e.test', type: 'feat', id, name });
const transferable = (key: string, type: string, value: unknown, id = key) => ({ _id: id, disabled: false, transfer: true, system: { changes: [{ _id: `${id}-change`, key, type, value }] } });
const document: CharacterDocument = {
  format: 1, kind: 'guided-character', name: 'Test', ruleset: '2024', step: 'background',
  foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'test' },
  origin: { sourcePath: 'species.yml', identifier: 'human', id: 'human' },
  classProgressions: [{ class: { sourcePath: 'class.yml', identifier: 'cleric', id: 'cleric' }, targetLevel: 1, selections: [] }],
  background: { sourcePath: 'background.yml', identifier: 'criminal', id: 'criminal' },
};
const species: SpeciesSourceSummary = { source: { sourcePath: 'species.yml', pack: 'dnd5e.test', type: 'race', id: 'human', name: 'Human' }, ruleset: '2024', advancements: [], features: [
  { source: reference('Chosen trait'), level: 1, automatic: false, entitlements: [{ level: 1, automatic: false, advancementId: 'choice', selection: { key: 'species:choice', value: 'feat:choice' } }], activeEffects: [transferable('flags.dnd5e.initiativeAlert', 'add', true)] },
  { source: reference('Automatic alert grant'), level: 1, automatic: true, activeEffects: [transferable('flags.dnd5e.initiativeAlert', 'add', true)] },
  { source: reference('Future trait'), level: 5, automatic: true, activeEffects: [transferable('system.bonuses.rwak.attack', 'add', 2)] },
] };
const classSource: ClassSourceSummary = { source: { sourcePath: 'class.yml', pack: 'dnd5e.test', type: 'class', id: 'cleric', name: 'Cleric' }, ruleset: '2024', hitDie: 'd8', advancements: [], features: [
  { advancementId: 'level-one', level: 1, source: reference('Level one'), activeEffects: [transferable('system.traits.armorProf.value', 'add', 'hvy')] },
  { advancementId: 'level-five', level: 5, source: reference('Level five'), activeEffects: [transferable('system.traits.weaponProf.value', 'add', 'mar')] },
] };
const background: BackgroundSourceSummary = { source: { sourcePath: 'background.yml', pack: 'dnd5e.test', type: 'background', id: 'criminal', name: 'Criminal' }, ruleset: '2024', skills: [], languages: [], languageChoices: [], tools: [], grantedFeats: [
  { source: reference('Alert'), advancementId: 'origin-feat', description: 'Stay ready.', advancements: [], activeEffects: [transferable('flags.dnd5e.initiativeAlert', 'add', true)] },
], features: [], equipment: [] };

describe('eligible passive character effects', () => {
  it('collects only currently entitled class, species, and background effects, deduplicated by source', () => {
    const result = collectEligibleCharacterEffects(document, { species, class: classSource, background, warnings: [] });
    expect(result.contributions.map(({ source, target }) => [source.name, target])).toEqual([
      ['Level one', 'armor-proficiency'],
      ['Automatic alert grant', 'initiative-proficiency'],
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps a selected eligible species grant and omits an unchosen or future grant', () => {
    const selectedDocument = structuredClone(document);
    selectedDocument.speciesConfiguration = {
      origin: { ...document.origin! }, foundry: document.foundry, grants: [],
      choices: [{ key: 'species:choice', source: reference('Choice pool'), selected: ['feat:choice'] }],
    };
    const result = collectEligibleCharacterEffects(selectedDocument, { species, class: classSource, background, warnings: [] });
    expect(result.contributions.map(({ source }) => source.name)).toContain('Chosen trait');
    expect(result.contributions.map(({ source }) => source.name)).not.toContain('Future trait');
  });

  it('does not project the 2024 Alert key under 2014 rules', () => {
    const legacyDocument = { ...structuredClone(document), ruleset: '2014' as const };
    const result = collectEligibleCharacterEffects(legacyDocument, { class: classSource, background, warnings: [] });
    expect(result.contributions.some(({ target }) => target === 'initiative-proficiency')).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({ key: 'flags.dnd5e.initiativeAlert', source: background.grantedFeats![0]!.source })]);
  });

  it('keeps a missing selected class feat source visible as a diagnostic', () => {
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [{ advancementId: 'feat-choice', kind: 'item', selected: [reference('Lost feat')] }];
    const result = collectEligibleCharacterEffects(selected, {
      class: { ...classSource, advancements: [{ id: 'feat-choice', type: 'ItemChoice', level: 1, title: 'Feat', hint: '', dependencies: [], raw: {} }] },
      selectedFeatSummaries: new Map([[`${reference('Lost feat').sourcePath}:${reference('Lost feat').pack}:feat:lost feat`, null]]),
      warnings: [],
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ source: expect.objectContaining({ name: 'Lost feat' }) }));
  });

  it('gates a selected class feat by its source prerequisite level and owning feature choice', () => {
    const selected = structuredClone(document);
    const featReference = reference("Devil's Sight");
    selected.classProgressions![0]!.selections = [{ advancementId: 'feat-choice', kind: 'item', selected: [featReference] }];
    const summary = { source: featReference, minimumLevel: 2, advancements: [], activeEffects: [transferable('system.bonuses.rwak.attack', 'add', 2)] };
    const baseClass = { ...classSource, features: [], advancements: [{ id: 'invocation', type: 'ItemChoice', level: 1, title: 'Invocation', hint: '', dependencies: [], raw: {} }, { id: 'feat-choice', type: 'ItemChoice', level: 1, title: 'Feat', hint: '', dependencies: [], requiresChoice: { key: 'class:invocation', value: `Compendium.${featReference.pack}.Item.${featReference.id}` }, raw: {} }] };
    const sources = { class: baseClass, selectedFeatSummaries: new Map([[`${featReference.sourcePath}:${featReference.pack}:${featReference.type}:${featReference.id}`, summary]]), warnings: [] };
    expect(collectEligibleCharacterEffects(selected, sources).contributions).toEqual([]);

    const levelTwoWithoutParent = structuredClone(selected);
    levelTwoWithoutParent.classProgressions![0]!.targetLevel = 2;
    expect(collectEligibleCharacterEffects(levelTwoWithoutParent, sources).contributions).toEqual([]);

    const ownedAtLevelOne = structuredClone(selected);
    ownedAtLevelOne.classProgressions![0]!.selections.push({ advancementId: 'invocation', kind: 'item', selected: [featReference] });
    expect(collectEligibleCharacterEffects(ownedAtLevelOne, sources).contributions).toEqual([]);
    const eligibleLevel = structuredClone(ownedAtLevelOne);
    eligibleLevel.classProgressions![0]!.targetLevel = 2;
    expect(collectEligibleCharacterEffects(eligibleLevel, sources).contributions.map(({ target }) => target)).toEqual(['ranged-weapon-attack-bonus']);
  });
});
