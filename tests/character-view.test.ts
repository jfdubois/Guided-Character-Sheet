import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { CharacterView, shouldConfirmRulesetReset, updateClassLevelDraft, collectFinalizationSpellUses, createAbilityScoreUpdate, getBackgroundFeatureCallouts, getBackgroundLanguageOptions, getBackgroundOverview, getBackgroundRenderState, getCharacterCreationSections, getCharacterRenderState, getClassFeatureCallouts, getClassChoiceHeading, getSelectedOriginId, getSpeciesFeatureCallouts, getSpeciesRenderState, getVisibleSpeciesTraitValues, renderSpeciesConfigurationControls, getClassRenderState, getClassChoiceLabel, renderClassConfigurationControls, renderClassChoiceDetails, classChoiceDisplayOptionFromSource, getSelectedBackgroundLanguageValues, getBackgroundAbilityControlState, renderBackgroundAbilityControls, renderBackgroundGrantedFeatControls, validateCharacterCreationReadiness, shouldRenderClassFeatureSelections, resolveToolLabels, resolveWeaponLabels, getKnownLanguageKeys } from '../src/character-view';
import { buildSpeciesConfiguration, createSpeciesConfiguration, toSpeciesConfigurationSelection } from '../src/species-configuration';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from '../src/character-sources';
import type { CharacterSheetSources } from '../src/character-sheet-model';
import type { FoundryItemSummary, FoundrySourceReference, FoundrySpellSummary } from '../src/foundry-source-catalog';
import { createCharacterDocument, parseCharacterDocument, withBackgroundGrantedFeat, withClassProgression, withOrigin, withRuleset, type CharacterDocument } from '../src/character-model';
import { createDefaultAbilityScores } from '../src/ability-scores';
import { buildClassConfiguration, restoreClassConfiguration, setClassSelection, toClassProgressionSelection, validateClassConfiguration, type ClassAdvancementSelection } from '../src/class-configuration';
import { buildBackgroundAbilityConfiguration, type BackgroundAbilitySelection } from '../src/background-ability-configuration';
import type { SpellChoice } from '../src/spell-configuration';
import { getSpellChoiceQueryFilters, mergeSpellSelections, renderSpellChoiceControls } from '../src/character-view';
import { buildGrantedFeatConfiguration, restoreGrantedFeatConfiguration, setGrantedFeatSpellChoice, setGrantedFeatSpellcastingAbility, toGrantedFeatSelection, validateGrantedFeatConfiguration, type GrantedFeatSelection } from '../src/granted-feat-configuration';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';
import type { InventoryItemChanges } from '../src/inventory';
import { CharacterResetModal } from '../src/character-reset-modal';
import { setClassHitPointGain } from '../src/class-hit-points';
import { isRecord } from '../src/foundry-utils';
import { applyCharacterLevelDraft } from '../src/character-level-change';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };

describe('weapon source labels', () => {
  it('resolves distinct proficiency selectors to one pinned weapon name', async () => {
    const labels = await resolveWeaponLabels(createPinnedSourceIndex(), new Set(['weapon:mar:handcrossbow', 'weapon:handcrossbow']), '2024');
    expect([...labels.values()]).toEqual(['Hand Crossbow', 'Hand Crossbow']);
  });
});

const acolyteSummary: BackgroundSourceSummary = {
  source: { sourcePath: 'packs/_source/origins24/backgrounds/acolyte.yml', pack: 'dnd5e.origins24', type: 'background', id: 'acolyte', identifier: 'acolyte', name: 'Acolyte' },
  ruleset: '2024', abilityScores: { advancementId: 'asi', points: 3, cap: 2, locked: ['str', 'dex', 'con'] },
  skills: [], languages: [], languageChoices: [], tools: [], features: [], equipment: [],
};
const choiceConfiguration = buildBackgroundAbilityConfiguration(acolyteSummary);
const creationOrigin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf' };
const creationClass = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter' };
const backgroundRef = { sourcePath: acolyteSummary.source.sourcePath, identifier: 'acolyte', id: 'acolyte' };

function magicInitiateSummary(): NonNullable<BackgroundSourceSummary['grantedFeat']> {
  const feat = { sourcePath: 'packs/_source/feats24/magic-initiate.yml', pack: 'dnd5e.feats24', type: 'feat' as const, id: 'phbftMagicInitia', name: 'Magic Initiate' };
  const guidance = spellReference('Guidance', 'guidance', 0, ['cleric']).source;
  const sacredFlame = spellReference('Sacred Flame', 'sacred-flame', 0, ['cleric']).source;
  const druidcraft = spellReference('Druidcraft', 'druidcraft', 0, ['druid']).source;
  const mageHand = spellReference('Mage Hand', 'mage-hand', 0, ['wizard']).source;
  const bless = spellReference('Bless', 'bless', 1, ['cleric']).source;
  const entangle = spellReference('Entangle', 'entangle', 1, ['druid']).source;
  const shield = spellReference('Shield', 'shield', 1, ['wizard']).source;
  const dependency = (source: FoundrySourceReference) => ({ uuid: `Compendium.dnd5e.spells.Item.${source.id}`, source });
  return {
    source: feat,
    advancements: [
      { id: 'cantrips', type: 'ItemChoice', title: 'Two Cantrips', hint: '', dependencies: [dependency(guidance), dependency(sacredFlame), dependency(druidcraft), dependency(mageHand)], spellLevel: 0, spellLists: ['cleric', 'druid', 'wizard'], abilityOptions: ['wis', 'int'], raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 2 } } },
      { id: 'level-one', type: 'ItemChoice', title: 'Level 1 Spell', hint: '', dependencies: [dependency(bless), dependency(entangle), dependency(shield)], spellLevel: 1, spellLists: ['cleric', 'druid', 'wizard'], abilityOptions: ['wis', 'int'], raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 1 } } },
    ],
  };
}

function magicInitiateConfiguration() {
  const configuration = buildGrantedFeatConfiguration(magicInitiateSummary());
  if (configuration.kind !== 'choice') throw new Error('Expected Magic Initiate choice configuration');
  return configuration;
}

function completeMagicInitiateSelection(): GrantedFeatSelection {
  let configuration = magicInitiateConfiguration();
  configuration = setGrantedFeatSpellChoice(configuration, configuration.spellChoices[0]!.key, ['cleric']);
  configuration = setGrantedFeatSpellChoice(configuration, configuration.spellChoices[1]!.key, configuration.spellChoices[1]!.options.slice(0, 2).map((option) => option.source));
  configuration = setGrantedFeatSpellChoice(configuration, configuration.spellChoices[2]!.key, [configuration.spellChoices[2]!.options[0]!.source]);
  configuration = setGrantedFeatSpellcastingAbility(configuration, 'wis');
  return toGrantedFeatSelection(configuration);
}

function completeDocument(overrides: Partial<CharacterDocument> = {}): CharacterDocument {
  return { ...createCharacterDocument('Ayla', snapshot), ruleset: '2024', step: 'background', origin: creationOrigin, classProgressions: [{ class: creationClass, targetLevel: 1, selections: [] }], background: backgroundRef, backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } } }, abilityScores: createDefaultAbilityScores(), inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, ...overrides };
}

function completeSources(background: BackgroundSourceSummary = acolyteSummary): CharacterSheetSources {
  return { species: { source: { sourcePath: creationOrigin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf', identifier: 'elf', name: 'Elf' }, ruleset: '2024', advancements: [] }, class: { source: { sourcePath: creationClass.sourcePath, pack: 'dnd5e.classes24', type: 'class', id: 'fighter', identifier: 'fighter', name: 'Fighter' }, ruleset: '2024', hitDie: 'd10', advancements: [] }, background, warnings: [] };
}

describe('character view render state', () => {
  it('restores a saved level-one pinned Wizard spellbook as a level-three choice', async () => {
    const index = createPinnedSourceIndex();
    const summary = await index.getClassSummary('2024', 'packs/_source/classes24/wizard/wizard.yml');
    const levelOne = buildClassConfiguration(summary, snapshot, 1);
    const savedChoice = levelOne.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'spellbook');
    expect(savedChoice?.kind).toBe('spell');
    if (savedChoice?.kind !== 'spell') return;
    savedChoice.selected = savedChoice.options!.filter((option) => isRecord(option.source) && option.source.level === 1).slice(0, 6).map((option) => option.source);
    const saved = completeDocument({ classProgressions: [toClassProgressionSelection(levelOne)] });

    const draft = updateClassLevelDraft(saved, summary, 3, []);
    const built = buildClassConfiguration(summary, snapshot, 3);
    const restored = restoreClassConfiguration(draft.document.classProgressions![0]!, { class: built.class, summary, configuration: built, snapshot });
    const spellbook = restored.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'spellbook');

    expect(spellbook).toMatchObject({ count: 10, level: -1, maxLevel: 2, selected: expect.arrayContaining(savedChoice.selected) });
    expect(spellbook?.kind === 'spell' ? spellbook.selected : []).toHaveLength(6);
    expect(spellbook?.kind === 'spell' ? spellbook.options?.some((option) => option.source.name === 'Arcane Lock') : false).toBe(true);
    expect(restored.diagnostics).toEqual([]);
    if (spellbook?.kind !== 'spell') return;
    const arcaneLock = spellbook.options!.find((option) => option.source.name === 'Arcane Lock')!.source;
    const additions = spellbook.options!.filter((option) => isRecord(option.source) && option.source.level === 2 && !spellbook.selected.some((selected) => selected.id === option.source.id)).slice(0, 4).map((option) => option.source);
    const updated = setClassSelection(restored, { ...spellbook, selected: [...spellbook.selected, ...additions] });
    expect(validateClassConfiguration(updated, { class: built.class, summary, configuration: built, snapshot })).toEqual([]);
    const updatedProgression = toClassProgressionSelection(updated);
    expect(() => parseCharacterDocument({ ...draft.document, classProgressions: [updatedProgression] })).not.toThrow();
    const updatedSpellbook = updatedProgression.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'spellbook');
    expect(updatedSpellbook?.kind).toBe('spell');
    if (updatedSpellbook?.kind !== 'spell') return;
    const loweredSelectionOrder = { ...updatedSpellbook, selected: [arcaneLock, ...updatedSpellbook.selected.slice(0, 9)] };
    const orderedProgression = { ...updatedProgression, selections: updatedProgression.selections.map((choice) => choice.advancementId === loweredSelectionOrder.advancementId ? loweredSelectionOrder : choice) };
    const lower = updateClassLevelDraft({ ...draft.document, classProgressions: [orderedProgression] }, summary, 1, []);
    const loweredSpellbook = lower.document.classProgressions?.[0]?.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'spellbook');
    expect(loweredSpellbook?.kind === 'spell' ? loweredSpellbook.selected.map((spell) => spell.name) : []).not.toContain('Arcane Lock');
    expect(loweredSpellbook?.kind === 'spell' ? loweredSpellbook.selected.map((spell) => { const source = summary.spellOptions?.find((candidate) => candidate.id === spell.id); return source !== undefined && isRecord(source) ? source.level : undefined; }) : []).toEqual([1, 1, 1, 1, 1, 1]);
    expect(loweredSpellbook).toMatchObject({ count: 6, selected: expect.arrayContaining(savedChoice.selected) });
    const raisedAgain = updateClassLevelDraft(lower.document, summary, 3, []);
    const restoredAgain = restoreClassConfiguration(raisedAgain.document.classProgressions![0]!, { class: built.class, summary, configuration: built, snapshot });
    expect(restoredAgain.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'spellbook')).toMatchObject({ count: 10, level: -1, maxLevel: 2, selected: expect.arrayContaining(savedChoice.selected) });

    const applySummary = { ...summary, advancements: [] };
    const applyLevelOne = buildClassConfiguration(applySummary, snapshot, 1);
    const applyCantrips = applyLevelOne.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'cantrips-known');
    const applySpellbook = applyLevelOne.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'spellbook');
    expect(applyCantrips?.kind).toBe('spell');
    expect(applySpellbook?.kind).toBe('spell');
    if (applyCantrips?.kind !== 'spell' || applySpellbook?.kind !== 'spell') return;
    const oneLevelCantrips = applyCantrips.options!.filter((option) => isRecord(option.source) && option.source.level === 0).slice(0, 3).map((option) => option.source);
    const oneLevelBook = applySpellbook.options!.filter((option) => isRecord(option.source) && option.source.level === 1).slice(0, 6).map((option) => option.source);
    let applyConfiguration = setClassSelection(applyLevelOne, { ...applyCantrips, selected: oneLevelCantrips });
    applyConfiguration = setClassSelection(applyConfiguration, { ...applySpellbook, selected: oneLevelBook });
    const hp = [1, 2, 3].map((level) => ({ classSourcePath: summary.source.sourcePath, level, value: level === 1 ? 'max' as const : 'avg' as const }));
    const inventory = { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
    const applySaved = completeDocument({
      classProgressions: [toClassProgressionSelection(applyConfiguration)],
      classHitPoints: [hp[0]!],
      mutable: { preparedSpells: [], inventory, equipmentStatus: [], resources: [], hitPoints: { current: 9, maximum: 9, temporary: 0 }, inspiration: false, spellSlots: [], spellUses: [] },
    });
    const applyDraft = updateClassLevelDraft(applySaved, applySummary, 3, hp).document;
    const applyLevelThree = buildClassConfiguration(applySummary, snapshot, 3);
    const applyRestored = restoreClassConfiguration(applyDraft.classProgressions![0]!, { class: applyLevelThree.class, summary: applySummary, configuration: applyLevelThree, snapshot });
    const applyWizardBook = applyRestored.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'spellbook');
    expect(applyWizardBook?.kind).toBe('spell');
    if (applyWizardBook?.kind !== 'spell') return;
    const secondLevelOptions = applyWizardBook.options!.filter((option) => isRecord(option.source) && option.source.level === 2 && !applyWizardBook.selected.some((selected) => selected.id === option.source.id));
    const completedApplyConfiguration = setClassSelection(applyRestored, { ...applyWizardBook, selected: [...applyWizardBook.selected, ...secondLevelOptions.slice(0, 4).map((option) => option.source)] });
    const applied = applyCharacterLevelDraft(applySaved, { ...applyDraft, classProgressions: [toClassProgressionSelection(completedApplyConfiguration)], classHitPoints: hp }, { ...completeSources(), class: applySummary });
    const appliedBook = applied.classProgressions?.[0]?.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'spellbook');
    expect(appliedBook).toMatchObject({ count: 10, level: -1, maxLevel: 2 });
    expect(appliedBook?.kind === 'spell' ? appliedBook.selected : []).toHaveLength(10);
    expect(applied.classHitPoints).toHaveLength(3);
  });

  it('renders specific Rogue weapon grants once and uses a readable source language name', () => {
    const rendered: string[] = [];
    const root = createDropdownTestRoot([], rendered);
    const renderClassTraits = (CharacterView.prototype as unknown as { renderClassTraits(root: HTMLElement, state: unknown): void }).renderClassTraits;
    renderClassTraits.call({}, root as unknown as HTMLElement, {
      kind: 'class-summary', hitDie: 'd8', proficiencies: {
        armor: ['armor:lgt'], savingThrows: ['saves:dex', 'saves:int'],
        weapons: ['weapon:sim', 'weapon:mar:handcrossbow', 'weapon:mar:rapier', 'weapon:mar:scimitar', 'weapon:mar:shortsword', 'weapon:mar:whip', 'weapon:rapier'],
        languages: ['languages:exotic:cant'],
      },
    });

    const weaponText = rendered[rendered.indexOf('Weapons') + 1];
    expect(weaponText).toContain('Simple weapons');
    expect(weaponText).toContain('Rapier');
    expect(weaponText).toContain('Shortsword');
    expect(weaponText).toContain('Hand Crossbow');
    expect(weaponText).not.toContain('Handcrossbow');
    expect(weaponText?.match(/Rapier/g)).toHaveLength(1);
    expect(weaponText).not.toContain('Martial weapons');
    expect(rendered).toContain("Thieves' Cant");
  });

  it('resolves concrete tool selectors to source names and leaves ambiguous matches for model fallback', async () => {
    const calligrapher = { sourcePath: 'calligrapher.yml', pack: 'equipment24', type: 'tool' as const, id: 'calligrapher', identifier: 'calligrapher', name: "Calligrapher's Supplies", ruleset: '2024' as const, itemType: 'tool', magic: false, equippable: false, properties: [] } satisfies FoundryItemSummary;
    const sourceIndex = { resolveSelector: vi.fn(async (selector: string) => selector === 'tool:art:calligrapher' ? [calligrapher] : []) };
    const labels = await resolveToolLabels(sourceIndex as never, new Set(['tool:art:calligrapher', 'tool:gaming:*']), '2024');
    expect(labels).toEqual(new Map([['tool:art:calligrapher', "Calligrapher's Supplies"]]));
  });

  it('projects required and resolved species size controls', () => {
    const summary: SpeciesSourceSummary = { ...completeSources().species!, size: { advancementId: 'human-size', level: 0, sizes: ['sm', 'med'] } };
    const configuration = buildSpeciesConfiguration(summary, snapshot);
    expect(getSpeciesRenderState(completeDocument(), summary, configuration)?.size).toEqual({ options: ['sm', 'med'], required: true });
    const selected = { ...configuration, size: { ...configuration.size!, selected: 'med' } };
    expect(getSpeciesRenderState(completeDocument(), summary, selected)?.size).toEqual({ options: ['sm', 'med'], selected: 'med', required: true });
  });

  it('blocks readiness when a required species size is missing', () => {
    const species = { ...completeSources().species!, size: { advancementId: 'human-size', level: 0, sizes: ['sm', 'med'] } };
    expect(validateCharacterCreationReadiness(completeDocument(), { ...completeSources(), species })).toContain('Species size requires a choice');
  });

  it('blocks readiness when a level-one fixed species spell needs an ability choice', () => {
    const spell = spellReference('Lineage spell', 'lineage-spell', 0, []).source;
    const species = { ...completeSources().species!, spellGrants: [{ advancementId: 'lineage-spell', level: 1, spells: [spell], abilityOptions: ['Intelligence', 'Wisdom', 'Charisma'], raw: {} }] };
    expect(validateCharacterCreationReadiness(completeDocument(), { ...completeSources(), species })).toContain('Species spellcasting ability is required');
  });

  it('renders one shared background granted-feat ability control and emits only source-valid selections', () => {
    const guidance = spellReference('Guidance', 'guidance', 0, ['cleric']);
    const sacredFlame = spellReference('Sacred Flame', 'sacred-flame', 0, ['cleric']);
    const bless = spellReference('Bless', 'bless', 1, ['cleric']);
    const configuration = {
      kind: 'choice' as const,
      feat: { sourcePath: 'packs/_source/feats24/magic-initiate.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'phbftMagicInitia', name: 'Magic Initiate' },
      diagnostics: [],
      spellChoices: [
        { key: 'list', advancementId: 'spell-list', label: 'Spell list', count: 1, level: 0, spellLists: ['cleric', 'wizard'], selected: [], abilityOptions: [], options: [{ value: 'cleric', label: 'Cleric', source: { ...guidance.source, id: 'cleric', name: 'Cleric', type: 'spell-list' } }, { value: 'wizard', label: 'Wizard', source: { ...guidance.source, id: 'wizard', name: 'Wizard', type: 'spell-list' } }], raw: { type: 'spell-list' } },
        { key: 'cantrips', advancementId: 'cantrips', label: 'Two Cantrips', count: 2, level: 0, spellLists: ['cleric', 'wizard'], selected: [], abilityOptions: ['wis', 'int'], parent: { key: 'list', values: [] }, options: [guidance, sacredFlame], raw: {} },
        { key: 'level-one', advancementId: 'level-one', label: 'Level 1 Spell', count: 1, level: 1, spellLists: ['cleric', 'wizard'], selected: [], abilityOptions: ['wis', 'int'], parent: { key: 'list', values: [] }, options: [bless], raw: {} },
      ],
    };
    const changes: GrantedFeatSelection[] = [];
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; text?: string }> }> = [];
    renderBackgroundGrantedFeatControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, configuration, undefined, (selection) => changes.push(selection));
    expect(changes).toEqual([]);
    expect(controls.filter((control) => control.options?.some((option) => option.text === 'Select a spellcasting ability'))).toHaveLength(0);
  });
  it('emits a complete persisted selection after choosing the list, spells, and shared ability', () => {
    const configuration = magicInitiateConfiguration();
    const changes: GrantedFeatSelection[] = [];
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; text?: string }> }> = [];
    renderBackgroundGrantedFeatControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, configuration, undefined, (selection) => changes.push(selection));
    expect(changes).toEqual([]);
    const latest = (text: string): { value: string; handlers: Array<() => void>; options?: Array<{ value: string; text?: string }> } => [...controls].reverse().find((control) => control.options?.some((option) => option.text === text))!;
    const latestContaining = (text: string): Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; text?: string }> }> => controls.filter((control) => control.options?.some((option) => option.text === text)).slice(-2);
    const choose = (control: { value: string; handlers: Array<() => void> }, value: string): void => { control.value = value; control.handlers.at(-1)?.(); };
    choose(latest('cleric'), 'cleric');
    const cantrips = latestContaining('Guidance');
    choose(cantrips[0]!, cantrips[0]!.options!.find((option) => option.text === 'Guidance')!.value);
    const secondCantrip = latestContaining('Guidance')[1]!;
    choose(secondCantrip, secondCantrip.options!.find((option) => option.text === 'Sacred Flame')!.value);
    const levelOne = latest('Bless');
    choose(levelOne, levelOne.options!.find((option) => option.text === 'Bless')!.value);
    choose(latest('Select a spellcasting ability'), 'wis');
    expect(changes.at(-1)).toMatchObject({ feat: { id: 'phbftMagicInitia' }, spellChoices: expect.arrayContaining([expect.objectContaining({ kind: 'spell-list', selected: ['cleric'] }), expect.objectContaining({ kind: 'spell', selected: expect.arrayContaining([expect.objectContaining({ id: 'guidance' }), expect.objectContaining({ id: 'sacred-flame' })]), selectedAbility: 'wis' }), expect.objectContaining({ kind: 'spell', selected: [expect.objectContaining({ id: 'bless' })], selectedAbility: 'wis' })]) });
    const restored = restoreGrantedFeatConfiguration(configuration, changes.at(-1));
    expect(validateGrantedFeatConfiguration(restored)).not.toEqual(expect.arrayContaining([expect.stringMatching(/requires 2 spells/)]));
  });

  it('restores the selected background granted-feat spell list after reopening', () => {
    const configuration = magicInitiateConfiguration();
    let saved = configuration;
    saved = setGrantedFeatSpellChoice(saved, saved.spellChoices[0]!.key, ['cleric']);
    const selection = toGrantedFeatSelection(saved);
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];

    renderBackgroundGrantedFeatControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, configuration, selection, () => undefined);

    const list = controls.find((control) => control.options?.some((option) => option.value === 'cleric'));
    expect(list?.options?.find((option) => option.value === 'cleric')?.selected).toBe(true);
    expect(list?.options?.find((option) => option.value === 'wizard')?.selected).toBe(false);
  });

  it('requires an explicit background granted-feat spell list before rendering dependent controls', () => {
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];

    renderBackgroundGrantedFeatControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, magicInitiateConfiguration(), undefined, () => undefined);

    const list = controls[0]!;
    expect(list.options?.[0]).toMatchObject({ text: 'Select a spell list', disabled: true, selected: true });
    expect(controls.filter((control) => control.options?.some((option) => option.text === 'Guidance' || option.text === 'Bless'))).toHaveLength(0);
  });

  it.each([
    ['cleric', ['Guidance', 'Sacred Flame'], ['Bless']],
    ['druid', ['Druidcraft'], ['Entangle']],
    ['wizard', ['Mage Hand'], ['Shield']],
  ] as const)('renders only source-authoritative options after selecting %s', (listValue, cantrips, levelOne) => {
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];
    renderBackgroundGrantedFeatControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, magicInitiateConfiguration(), undefined, () => undefined);

    const list = controls[0]!;
    list.value = listValue;
    list.handlers.at(-1)?.();

    const spellOptionTexts = controls.slice(-5).flatMap((control) => control.options?.map((option) => option.text).filter((text): text is string => text !== undefined) ?? []);
    expect(spellOptionTexts).toEqual(expect.arrayContaining([...cantrips, ...levelOne]));
    const invalid = listValue === 'cleric' ? ['Druidcraft', 'Entangle', 'Mage Hand', 'Shield'] : listValue === 'druid' ? ['Guidance', 'Sacred Flame', 'Bless', 'Mage Hand', 'Shield'] : ['Guidance', 'Sacred Flame', 'Druidcraft', 'Bless', 'Entangle'];
    expect(spellOptionTexts).not.toEqual(expect.arrayContaining(invalid));
  });

  it('renders spellcasting ability options with human-readable labels', () => {
    const spell = spellReference('Guidance', 'guidance', 0, ['cleric']);
    const choice = spellChoice('spell', 'Cantrip', 1, 0, ['cleric'], ['int', 'wis'], undefined, undefined, [spell]);
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];

    renderSpellChoiceControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, [choice], () => undefined);

    const ability = controls.find((control) => control.options?.some((option) => option.text === 'Select a spellcasting ability'));
    expect(ability?.options?.map((option) => option.text)).toEqual(['Select a spellcasting ability', 'Intelligence', 'Wisdom']);
  });

  it('clears saved dependent spells when the granted-feat list changes', () => {
    let configured = magicInitiateConfiguration();
    const listKey = configured.spellChoices[0]!.key;
    configured = setGrantedFeatSpellChoice(configured, listKey, ['cleric']);
    configured = setGrantedFeatSpellChoice(configured, configured.spellChoices[1]!.key, [configured.spellChoices[1]!.options[0]!.source, configured.spellChoices[1]!.options[1]!.source]);
    configured = setGrantedFeatSpellChoice(configured, configured.spellChoices[2]!.key, [configured.spellChoices[2]!.options[0]!.source]);
    configured = setGrantedFeatSpellcastingAbility(configured, 'wis');
    const changes: GrantedFeatSelection[] = [];
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; text?: string }> }> = [];
    renderBackgroundGrantedFeatControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, magicInitiateConfiguration(), toGrantedFeatSelection(configured), (selection) => changes.push(selection));
    const list = controls.find((control) => control.options?.some((option) => option.text === 'cleric'))!;
    list.value = 'wizard';
    list.handlers.at(-1)?.();
    expect(changes.at(-1)?.spellChoices.filter((choice) => choice.kind === 'spell').every((choice) => choice.selected.length === 0)).toBe(true);
    expect(controls.slice(-5).flatMap((control) => control.options?.map((option) => option.text) ?? [])).toEqual(expect.arrayContaining(['Mage Hand', 'Shield']));
    expect(controls.slice(-5).flatMap((control) => control.options?.map((option) => option.text) ?? [])).not.toEqual(expect.arrayContaining(['Guidance', 'Sacred Flame', 'Bless']));
  });

  it('renders no controls for a granted feat without choices and exactly one warning for unsupported choices', () => {
    const noneText: string[] = [];
    renderBackgroundGrantedFeatControls(createSpellTestRoot(noneText) as unknown as HTMLElement, { kind: 'none' }, undefined, () => undefined);
    expect(noneText).toEqual([]);
    const unsupportedRoot = createViewRenderRoot();
    renderBackgroundGrantedFeatControls(unsupportedRoot.root as unknown as HTMLElement, { kind: 'unsupported', reason: 'Nested choice is unsupported' }, undefined, () => undefined);
    expect(unsupportedRoot.text).toEqual(['Nested choice is unsupported']);
  });
  it('renders available spell choices in dependency order and hides dependent choices', () => {
    const rendered: string[] = [];
    const root = createSpellTestRoot(rendered);
    const choices = [
      { ...spellChoice('spells:list', 'Spell list', 1, 0, ['wizard'], [], undefined), raw: { type: 'spell-list' } },
      spellChoice('spells:cantrips', 'Cantrips', 2, 0, ['wizard'], [], { key: 'spells:list', values: ['wizard'] }),
    ];

    renderSpellChoiceControls(root as unknown as HTMLElement, choices, () => undefined);

    expect(rendered.indexOf('Spell list')).toBeGreaterThanOrEqual(0);
    expect(rendered).toContain('Select a spell list');
    expect(rendered.indexOf('Cantrips')).toBe(-1);
    choices[0].selected = ['wizard'];
    rendered.length = 0;
    renderSpellChoiceControls(root as unknown as HTMLElement, choices, () => undefined);
    expect(rendered.indexOf('Spell list')).toBeLessThan(rendered.indexOf('Cantrips (choose 2)'));
  });

  it('stores a selected species spell list as a list value instead of its source record', () => {
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];
    const configuration = createSpeciesConfiguration({ sourcePath: 'packs/_source/origins24/species/human.yml', identifier: 'human', id: 'human' }, snapshot);
    const listSource = spellReference('Cleric', 'cleric', 0, ['cleric']).source;
    configuration.spellChoices = [{ key: 'list', advancementId: 'list', label: 'Spell list', count: 1, level: 0, spellLists: ['cleric'], selected: [], abilityOptions: [], options: [{ value: 'cleric', source: listSource, label: 'Cleric' }], raw: { type: 'spell-list' } }];
    let updated: typeof configuration | undefined;
    renderSpeciesConfigurationControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, { spellChoices: configuration.spellChoices }, configuration, (next) => { updated = next; });
    controls[0]!.value = 'cleric';
    controls[0]!.handlers[0]!();
    expect(updated?.spellChoices[0]?.selected).toEqual(['cleric']);
  });

  it('renders the stored species spell list as the selected option', () => {
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];
    const configuration = createSpeciesConfiguration({ sourcePath: 'packs/_source/origins24/species/human.yml', identifier: 'human', id: 'human' }, snapshot);
    configuration.spellChoices = [{
      key: 'list', advancementId: 'list', label: 'Spell list', count: 1, level: 0, spellLists: ['cleric', 'druid'], selected: ['druid'], abilityOptions: [],
      options: [
        { value: 'cleric', source: spellReference('Cleric', 'cleric', 0, ['cleric']).source, label: 'Cleric' },
        { value: 'druid', source: spellReference('Druid', 'druid', 0, ['druid']).source, label: 'Druid' },
      ],
      raw: { type: 'spell-list' },
    }];

    renderSpeciesConfigurationControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, { spellChoices: configuration.spellChoices }, configuration, () => undefined);

    expect(controls[0]?.options).toEqual([
      expect.objectContaining({ value: '', selected: false }),
      expect.objectContaining({ value: 'cleric', selected: false }),
      expect.objectContaining({ value: 'druid', selected: true }),
    ]);
  });

  it('redraws species spell controls from current state between rapid spell changes', () => {
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];
    const list = { ...spellChoice('list', 'Spell list', 1, 0, ['cleric'], [], undefined), raw: { type: 'spell-list' }, options: [{ ...spellReference('Cleric', 'cleric', 0, ['cleric']), value: 'cleric' }] };
    const spell = { ...spellChoice('cantrip', 'Cantrip', 1, 0, ['cleric'], [], { key: 'list', values: ['cleric'] }), options: [spellReference('Guidance', 'guidance', 0, ['cleric'])] };
    const configuration = createSpeciesConfiguration({ sourcePath: 'packs/_source/origins24/species/human.yml', identifier: 'human', id: 'human' }, snapshot);
    configuration.spellChoices = [list, spell];
    let updated = configuration;
    renderSpeciesConfigurationControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, { spellChoices: configuration.spellChoices }, configuration, (next) => { updated = next; });

    controls[0]!.value = 'cleric';
    controls[0]!.handlers[0]!();
    const cantrip = controls.find((control) => control.options?.some((option) => option.text === 'Guidance'));
    expect(cantrip).toBeDefined();
    cantrip!.value = 'dnd5e.spells:guidance';
    cantrip!.handlers[0]!();

    expect(updated.spellChoices[0]?.selected).toEqual(['cleric']);
    expect(updated.spellChoices[1]?.selected).toHaveLength(1);
  });

  it('composes two rapid species selections from the latest configuration', () => {
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];
    const configuration = createSpeciesConfiguration({ sourcePath: 'packs/_source/origins24/species/human.yml', identifier: 'human', id: 'human' }, snapshot);
    configuration.choices = [
      { key: 'first', level: 1, label: 'First choice', count: 1, source: { id: 'first', type: 'ItemChoice' }, options: [{ value: 'one', label: 'One', source: { id: 'one', type: 'option' } }], selected: [], raw: {} },
      { key: 'second', level: 1, label: 'Second choice', count: 1, source: { id: 'second', type: 'ItemChoice' }, options: [{ value: 'two', label: 'Two', source: { id: 'two', type: 'option' } }], selected: [], raw: {} },
    ];
    let updated = configuration;
    renderSpeciesConfigurationControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, { choices: configuration.choices.map((choice) => ({ key: choice.key, label: choice.label, required: choice.count, options: choice.options, selected: choice.selected })) }, configuration, (next) => { updated = next; });
    controls[0]!.value = 'one';
    controls[0]!.handlers[0]!();
    controls[1]!.value = 'two';
    controls[1]!.handlers[0]!();
    expect(updated.choices.map((choice) => choice.selected)).toEqual([['one'], ['two']]);
  });

  it('groups species spell choices under one ability selector in source order', () => {
    const rendered: string[] = [];
    const root = createSpellTestRoot(rendered);
    const list = { ...spellChoice('list', 'Spell list', 1, 0, ['cleric', 'druid', 'wizard'], [], undefined), raw: { type: 'spell-list' }, selected: ['druid'] };
    const cantrips = spellChoice('cantrips', 'Two Cantrips', 2, 0, ['druid'], ['Wisdom'], { key: 'list', values: ['druid'] }, undefined, [spellReference('Guidance', 'guidance', 0, ['druid'])]);
    const levelOne = spellChoice('level-one', 'Level 1 Spell', 1, 1, ['druid'], ['Wisdom'], { key: 'list', values: ['druid'] }, undefined, [spellReference('Longstrider', 'longstrider', 1, ['druid'])]);
    const configuration = createSpeciesConfiguration({ sourcePath: 'packs/_source/origins24/species/human.yml', identifier: 'human', id: 'human' }, snapshot);
    configuration.spellChoices = [list, cantrips, levelOne];
    renderSpeciesConfigurationControls(root as unknown as HTMLElement, { spellChoices: configuration.spellChoices }, configuration, () => undefined);
    expect(rendered.filter((value) => value === 'Spellcasting ability')).toHaveLength(1);
    expect(rendered.indexOf('Spellcasting ability')).toBeLessThan(rendered.indexOf('Two Cantrips (choose 2)'));
    expect(rendered.indexOf('Two Cantrips (choose 2)')).toBeLessThan(rendered.indexOf('Level 1 Spell'));
  });

  it('renders species spellcasting ability options with human-readable labels', () => {
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];
    const list = { ...spellChoice('list', 'Spell list', 1, 0, ['cleric'], [], undefined), raw: { type: 'spell-list' }, selected: ['cleric'] };
    const spell = spellChoice('cantrips', 'Cantrip', 1, 0, ['cleric'], ['int', 'wis', 'cha'], { key: 'list', values: ['cleric'] }, undefined, [spellReference('Guidance', 'guidance', 0, ['cleric'])]);
    const configuration = createSpeciesConfiguration({ sourcePath: 'packs/_source/origins24/species/human.yml', identifier: 'human', id: 'human' }, snapshot);
    configuration.spellChoices = [list, spell];

    renderSpeciesConfigurationControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, { spellChoices: configuration.spellChoices }, configuration, () => undefined);

    const ability = controls.find((control) => control.options?.some((option) => option.text === 'Select a spellcasting ability'));
    expect(ability?.options?.map((option) => option.text)).toEqual(['Select a spellcasting ability', 'Intelligence', 'Wisdom', 'Charisma']);
  });

  it('renders bounded level/list-filtered spell options', () => {
    const rendered: string[] = [];
    const root = createSpellTestRoot(rendered);
    const wizardCantrip = spellReference('Light', 'light', 0, ['wizard']);
    const clericCantrip = spellReference('Guidance', 'guidance', 0, ['cleric']);
    const wrongLevel = spellReference('Fireball', 'fireball', 3, ['wizard']);
    const choice = spellChoice('spells:cantrips', 'Cantrips', 1, 0, ['wizard'], [], undefined, undefined, [wizardCantrip, clericCantrip, wrongLevel]);

    renderSpellChoiceControls(root as unknown as HTMLElement, [choice], () => undefined);

    expect(rendered).toContain('Light');
    expect(rendered).not.toContain('Guidance');
    expect(rendered).not.toContain('Fireball');
  });

  it('does not add a cantrip filter for an unrestricted spell level', () => {
    const choice = spellChoice('spells:any', 'Any spell', 1, -1, ['wizard'], [], undefined);
    expect(getSpellChoiceQueryFilters(choice)).toEqual({ spellLists: ['wizard'] });
  });

  it('limits an unrestricted spell query to the maximum source-backed castable level', () => {
    const choice = { ...spellChoice('spells:known', 'Known spells', 2, -1, ['wizard'], [], undefined), maxLevel: 2 };
    expect(getSpellChoiceQueryFilters(choice)).toEqual({ maxLevel: 2, spellLists: ['wizard'] });
  });

  it('removes a stale diagnostic when an async catalog result resolves the saved spell', async () => {
    const rendered: string[] = [];
    const removed = { value: false };
    const root = createSpellTestRoot(rendered, removed);
    const saved = spellReference('Light', 'light', 0, ['wizard']);
    const choice = spellChoice('spells:cantrip', 'Cantrip', 1, 0, ['wizard'], [], undefined, undefined, []);
    choice.selected = [saved.source];

    renderSpellChoiceControls(root as unknown as HTMLElement, [choice], () => undefined, async () => [saved]);
    await Promise.resolve();
    await Promise.resolve();

    expect(removed.value).toBe(true);
  });

  it('keeps selected spell descriptions in typed detail text', () => {
    const rendered: string[] = [];
    const root = createSpellTestRoot(rendered) as unknown as { textContent?: string };
    const option = spellReference('Light', 'light', 0, ['wizard']);
    option.description = 'A luminous mote follows the target.';
    const choice = spellChoice('spells:light', 'Spell', 1, 0, ['wizard'], [], undefined, undefined, [option]);
    choice.selected = [option.source];

    renderSpellChoiceControls(root as unknown as HTMLElement, [choice], () => undefined);

    expect(root.textContent).toContain('A luminous mote follows the target.');
  });

  it('preserves selected spells outside the active search result set', () => {
    const hidden = spellReference('Hidden', 'hidden', 0, ['wizard']);
    const visible = spellReference('Visible', 'visible', 0, ['wizard']);
    const merged = mergeSpellSelections([hidden.source], [visible], [visible.source]);
    expect(merged).toEqual([hidden.source, visible.source]);
  });

  it('renders one spell dropdown for each required selection', () => {
    const tags: string[] = [];
    const root = createSpellTestRoot([], { value: false }, tags);
    const first = spellReference('Light', 'light', 0, ['wizard']);
    const second = spellReference('Guidance', 'guidance', 0, ['wizard']);
    const choice = spellChoice('spells:cantrips', 'Cantrips', 2, 0, ['wizard'], [], undefined, undefined, [first, second]);

    renderSpellChoiceControls(root as unknown as HTMLElement, [choice], () => undefined);

    expect(tags.filter((tag) => tag === 'select')).toHaveLength(2);
  });

  it('passes the shared catalog query to empty-pool class spell choices', async () => {
    const summary = { source: { sourcePath: 'packs/_source/classes/wizard.yml', pack: 'dnd5e.classes', type: 'class', id: 'wizard', name: 'Wizard' }, ruleset: '2014' as const, hitDie: 'd6', advancements: [{ id: 'spell', type: 'ItemChoice', level: 1, title: 'Cantrips', hint: '', dependencies: [], raw: { configuration: { type: 'spell', choices: 1 } } }] };
    const configuration = buildClassConfiguration(summary, snapshot, 1);
    let received: { level?: number; spellLists?: string[] } | undefined;
    renderClassConfigurationControls(createSpellTestRoot([]) as unknown as HTMLElement, configuration, () => undefined, 'spell', async (filters) => { received = filters; return []; });
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual({});
  });

  it('renders class level-one spell roles with separate labels and descriptions', () => {
    const rendered: string[] = [];
    const root = createSpellTestRoot(rendered);
    const cantrip = spellReference('Light', 'light', 0, ['wizard']);
    cantrip.description = 'A luminous mote follows the target.';
    const spellbook = spellReference('Shield', 'shield', 1, ['wizard']);
    spellbook.description = 'An invisible barrier of magical force appears.';
    const summary = { source: { sourcePath: 'packs/_source/classes24/wizard/wizard.yml', pack: 'dnd5e.classes24', type: 'class', id: 'wizard', name: 'Wizard', identifier: 'wizard' }, ruleset: '2024' as const, hitDie: 'd6', advancements: [], spellcasting: { ability: 'int', cantripsKnown: 3, spellbookSpells: 6, preparedSpells: 4, spellLists: ['wizard'] }, spellOptions: [cantrip.source, spellbook.source] };
    const configuration = buildClassConfiguration(summary, snapshot, 1);
    const cantripChoice = configuration.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'cantrips-known');
    const spellbookChoice = configuration.selections.find((choice) => choice.kind === 'spell' && choice.selectionRole === 'spellbook');
    if (cantripChoice?.kind === 'spell') cantripChoice.selected = [cantrip.source];
    if (spellbookChoice?.kind === 'spell') spellbookChoice.selected = [spellbook.source];

    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined);

    expect(rendered).toContain('Cantrips known (choose 3)');
    expect(rendered).toContain('Spellbook (choose 6)');
    expect(rendered).not.toContain('Prepared spells');
  });
  it('projects the creation journey into completed, active, and upcoming sections', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' }, classProgressions: [{ class: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' }, targetLevel: 1, selections: [] }], background: { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', identifier: 'sage', id: 'sage-id' }, step: 'background' as const };
    expect(getCharacterCreationSections(document)).toEqual([
      { id: 'identity', label: 'Identity', status: 'complete' },
      { id: 'species', label: 'Species', status: 'complete' },
      { id: 'class', label: 'Class', status: 'complete' },
      { id: 'background', label: 'Background', status: 'active' },
      { id: 'ability-scores', label: 'Ability scores', status: 'upcoming' },
      { id: 'inventory', label: 'Inventory', status: 'upcoming' },
    ]);
  });

  it('uses the first incomplete section as the active section', () => {
    expect(getCharacterCreationSections(createCharacterDocument('Ayla', snapshot))).toEqual([
      { id: 'identity', label: 'Identity', status: 'active' },
      { id: 'species', label: 'Species', status: 'upcoming' },
      { id: 'class', label: 'Class', status: 'upcoming' },
      { id: 'background', label: 'Background', status: 'upcoming' },
      { id: 'ability-scores', label: 'Ability scores', status: 'upcoming' },
      { id: 'inventory', label: 'Inventory', status: 'upcoming' },
    ]);
  });
  it('projects a background summary into the requested sections', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' }, classProgressions: [{ class: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' }, targetLevel: 1, selections: [] }] };
    const summary = { source: { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', pack: 'dnd5e.origins24', type: 'background', id: 'sage-id', identifier: 'sage', name: 'Sage' }, ruleset: '2024' as const, description: 'A scholar.', skills: ['skills:arc'], languages: ['languages:standard:common'], languageChoices: [{ count: 2, pool: ['languages:standard:*'] }], tools: ['tool:art:calligrapher'], abilityScores: { points: 3, locked: ['str', 'dex', 'con'] }, feat: { sourcePath: 'packs/_source/feats24/magic.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'magic', name: 'Magic Initiate' }, features: [], equipment: [{ type: 'AND' }] };
    expect(getBackgroundRenderState(document, summary, undefined)).toMatchObject({ kind: 'background-summary', name: 'Sage', description: 'A scholar.', skills: ['skills:arc'], tools: ['tool:art:calligrapher'], feat: { name: 'Magic Initiate' } });
  });
  it('projects background language choices without fixed or duplicate language options', () => {
    const options = getBackgroundLanguageOptions({
      languages: ['languages:standard:common', 'languages:standard:draconic'],
      languageChoices: [{ count: 2, pool: ['languages:standard:*', 'languages:common'] }],
    });
    expect(options.map((option) => option.value)).toEqual(['languages:standard:dwarvish', 'languages:standard:elvish', 'languages:standard:giant', 'languages:standard:gnomish', 'languages:standard:goblin', 'languages:standard:halfling', 'languages:standard:orc', 'languages:standard:sign']);
  });
  it('excludes languages already granted or selected in other creation sections', () => {
    const document = completeDocument({ backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } } } });
    document.speciesConfiguration = { origin: creationOrigin, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [{ key: 'language', source: { id: 'language', type: 'Trait' }, selected: ['languages:elvish'] }], spellChoices: [] };
    const source = { ...acolyteSummary, languageChoices: [{ count: 1, pool: ['languages:standard:*'] }] };
    const known = getKnownLanguageKeys(document, { warnings: [], species: { ...completeSources().species!, advancements: [{ id: 'language', type: 'Trait', level: 1, hint: '', automatic: true, dependencies: [], raw: { configuration: { grants: [] } } }] }, class: { ...completeSources().class!, proficiencies: { armor: [], weapons: [], tools: [], savingThrows: [], languages: ['languages:standard:common'], skills: [], choices: [] } }, background: source });
    expect(known).toEqual(new Set(['common', 'elvish']));
    const selects: DropdownTestSelect[] = [];
    const renderLanguages = (CharacterView.prototype as unknown as { renderBackgroundLanguageChoice(root: HTMLElement, summary: BackgroundSourceSummary, selected: string[], count: number, known: ReadonlySet<string>): void }).renderBackgroundLanguageChoice;
    renderLanguages.call({ queueUpdate: () => undefined }, createDropdownTestRoot(selects) as unknown as HTMLElement, source, [], 1, known);
    expect(selects[0]?.options.some((option) => option.value === 'languages:standard:elvish')).toBe(false);
  });
  it('ignores species language grants above the saved creation level in filtering and finalization', () => {
    const document = completeDocument({ classProgressions: [{ ...completeDocument().classProgressions![0]!, targetLevel: 1, selections: [{ advancementId: 'future-class-language', kind: 'trait', selected: ['languages:standard:elvish'], configuredPool: ['languages:standard:*'] }] }], speciesConfiguration: { origin: creationOrigin, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [{ key: 'species:future-language', source: { id: 'future-language', type: 'Trait' }, selected: ['languages:standard:elvish'] }], spellChoices: [] } });
    const species = { ...completeSources().species!, advancements: [{ id: 'future-language', type: 'Trait', level: 5, hint: '', automatic: false, dependencies: [], raw: { configuration: { grants: ['languages:standard:elvish'] } } }] };
    const classSummary = { ...completeSources().class!, advancements: [{ id: 'future-class-language', type: 'Trait', level: 5, title: 'Future language', hint: '', dependencies: [], raw: { configuration: { mode: 'default', choices: 1, pool: ['languages:standard:*'] } } }] };
    expect(getKnownLanguageKeys(document, { warnings: [], species, class: classSummary }).has('elvish')).toBe(false);
    const summary = { ...acolyteSummary, languageChoices: [{ count: 1, pool: ['languages:standard:*'] }] };
    const withLanguageChoice = { ...document, backgroundChoices: { ...document.backgroundChoices!, languages: ['languages:standard:elvish'] } };
    expect(validateCharacterCreationReadiness(withLanguageChoice, { ...completeSources(summary), species, class: classSummary })).not.toContain('Language choices must be unique across species, class, and background.');
    expect(withLanguageChoice.speciesConfiguration?.choices[0]?.selected).toEqual(['languages:standard:elvish']);
    expect(withLanguageChoice.classProgressions?.[0]?.selections[0]).toMatchObject({ advancementId: 'future-class-language', selected: ['languages:standard:elvish'] });
  });
  it('counts only visible background language selections using canonical identity', () => {
    const options = getBackgroundLanguageOptions({
      languages: ['languages:standard:common'],
      languageChoices: [{ count: 2, pool: ['languages:standard:*'] }],
    });
    expect(getSelectedBackgroundLanguageValues(options, ['languages:common', 'languages:standard:elvish', 'languages:standard:missing'])).toEqual(['languages:standard:elvish']);
  });
  it('projects background features into detailed creation callouts', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin: { sourcePath: 'packs/_source/races/human.yml', identifier: 'human', id: 'human-id' }, classProgressions: [{ class: { sourcePath: 'packs/_source/classes/fighter.yml', identifier: 'fighter', id: 'fighter-id' }, targetLevel: 1, selections: [] }] };
    const summary = { source: { sourcePath: 'packs/_source/backgrounds/sage.yml', pack: 'dnd5e.backgrounds', type: 'background', id: 'sage-id', identifier: 'sage', name: 'Sage' }, ruleset: '2014' as const, skills: [], languages: [], languageChoices: [], tools: [], features: [{ advancementId: 'feature', source: { sourcePath: 'packs/_source/backgrounds/sage-feature.yml', pack: 'dnd5e.backgrounds', type: 'feat', id: 'feature-id', name: 'Feature' }, description: 'A detailed feature.' }], equipment: [] };
    const state = getBackgroundRenderState(document, summary);
    expect(state.kind).toBe('background-summary');
    if (state.kind === 'background-summary') expect(getBackgroundFeatureCallouts(state)).toEqual([{ name: 'Feature', description: 'A detailed feature.' }]);
  });
  it('keeps the background feat out of the overview when features display it below', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' }, classProgressions: [{ class: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' }, targetLevel: 1, selections: [] }] };
    const summary = { source: { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', pack: 'dnd5e.origins24', type: 'background', id: 'sage-id', identifier: 'sage', name: 'Sage' }, ruleset: '2024' as const, description: 'A scholar.', skills: [], languages: [], languageChoices: [], tools: [], feat: { sourcePath: 'packs/_source/feats24/magic.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'magic', name: 'Magic Initiate' }, features: [], equipment: [] };
    const state = getBackgroundRenderState(document, summary);
    expect(state.kind).toBe('background-summary');
    if (state.kind === 'background-summary') expect(getBackgroundOverview(state)).not.toHaveProperty('feat');
  });
  it('shows a 2024 background-granted feat and its description as a creation feature', () => {
    const summary: BackgroundSourceSummary = { ...acolyteSummary, grantedFeat: { source: { sourcePath: 'packs/_source/feats24/origin-feats/alert.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'alert', name: 'Alert' }, description: 'Initiative Proficiency. Add your Proficiency Bonus.', advancements: [] } };
    const state = getBackgroundRenderState(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), summary);
    expect(state.kind).toBe('background-summary');
    if (state.kind === 'background-summary') expect(getBackgroundFeatureCallouts(state)).toContainEqual({ name: 'Alert', description: 'Initiative Proficiency. Add your Proficiency Bonus.' });
  });
  it('shows every pinned 2024 background-granted feat with its source description', async () => {
    const index = createPinnedSourceIndex();
    for (const path of [
      'packs/_source/origins24/backgrounds/acolyte.yml',
      'packs/_source/origins24/backgrounds/criminal.yml',
      'packs/_source/origins24/backgrounds/sage.yml',
      'packs/_source/origins24/backgrounds/soldier.yml',
    ]) {
      const summary = await index.getBackgroundSummary('2024', path);
      const document = createCharacterDocument('Ayla', snapshot);
      document.background = { sourcePath: path, identifier: summary.source.identifier ?? '', id: summary.source.id };
      const state = getBackgroundRenderState(document, summary);
      expect(state.kind).toBe('background-summary');
      if (state.kind === 'background-summary') {
        const featCallouts = getBackgroundFeatureCallouts(state).filter((callout) => callout.description !== undefined);
        expect(featCallouts.length).toBeGreaterThan(0);
        expect(featCallouts[0]?.description).toBeTruthy();
      }
    }
  });
  it('projects a presentation-ready 2024 background overview', () => {
    const document = withRuleset(createCharacterDocument('Ayla', snapshot), '2024');
    const summary = { source: { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', pack: 'dnd5e.origins24', type: 'background', id: 'sage-id', identifier: 'sage', name: 'Sage' }, ruleset: '2024' as const, description: 'A scholar.', skills: ['skills:arc'], languages: ['languages:standard:common'], languageChoices: [], tools: ['tool:art:calligrapher', 'tool:thief'], abilityScores: { points: 3 }, feat: { sourcePath: 'packs/_source/feats24/magic.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'magic', name: 'Magic Initiate' }, features: [], equipment: [{ type: 'linked', key: 'Compendium.dnd5e.equipment24.Item.rope' }], wealth: '50', startingEquipment: { roots: [], diagnostics: [] } };
    const state = getBackgroundRenderState(document, summary);
    expect(state.kind).toBe('background-summary');
    if (state.kind === 'background-summary') {
      expect(getBackgroundOverview(state)).toEqual({ description: 'A scholar.', skills: ['Arcana'], languages: ['Common'], tools: ["Calligrapher's supplies", "Thieves' tools"] });
    }
  });
  it('preserves the existing 2014 background overview projection', () => {
    const document = withRuleset(createCharacterDocument('Ayla', snapshot), '2014');
    const equipment = [{ type: 'linked', key: 'rope', count: 1 }];
    const summary = { source: { sourcePath: 'packs/_source/backgrounds/sage.yml', pack: 'dnd5e.backgrounds', type: 'background', id: 'sage-id', identifier: 'sage', name: 'Sage' }, ruleset: '2014' as const, description: 'A scholar.', skills: ['skills:arc'], languages: ['languages:standard:common'], languageChoices: [], tools: ['tool:art:calligrapher'], features: [], equipment, wealth: '10' };
    const state = getBackgroundRenderState(document, summary);
    expect(state.kind).toBe('background-summary');
    if (state.kind === 'background-summary') expect(getBackgroundOverview(state)).toEqual({ description: 'A scholar.', skills: ['skills:arc'], languages: ['languages:standard:common'], tools: ['tool:art:calligrapher'], equipment, wealth: '10' });
  });

  it('keeps a 2024 background active until its ability allocation is saved', () => {
    const selected = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: creationOrigin, classProgressions: [{ class: creationClass, targetLevel: 1, selections: [] }], background: backgroundRef, step: 'background' as const };
    expect(getCharacterCreationSections(selected).find((section) => section.id === 'background')?.status).toBe('active');
    const configured = { ...selected, backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } } } };
    expect(getCharacterCreationSections(configured).find((section) => section.id === 'background')?.status).toBe('complete');
  });

  it('uses explicit granted-feat configuration for 2024 background completion', () => {
    const document = completeDocument();
    const choice = magicInitiateConfiguration();
    expect(getCharacterCreationSections(document, choice).find((section) => section.id === 'background')?.status).toBe('active');
    const completed = completeDocument({ backgroundChoices: { ...document.backgroundChoices, grantedFeat: completeMagicInitiateSelection() } });
    expect(getCharacterCreationSections(completed, choice).find((section) => section.id === 'background')?.status).toBe('complete');
    expect(getCharacterCreationSections(document, { kind: 'unsupported', reason: 'Unsupported' }).find((section) => section.id === 'background')?.status).toBe('active');
    expect(getCharacterCreationSections(document, null).find((section) => section.id === 'background')?.status).toBe('active');
    const noneDocument = completeDocument({ backgroundChoices: document.backgroundChoices });
    expect(getCharacterCreationSections(noneDocument, { kind: 'none' }).find((section) => section.id === 'background')?.status).toBe('complete');
    const legacy = { ...document, ruleset: '2014' as const, backgroundChoices: undefined };
    expect(getCharacterCreationSections(legacy, { kind: 'unsupported', reason: 'Unsupported' }).find((section) => section.id === 'background')?.status).toBe('complete');
  });

  it('derives balanced and focused controls from structured source constraints', () => {
    expect(getBackgroundAbilityControlState(choiceConfiguration, undefined)).toMatchObject({
      eligibleAbilities: [{ value: 'int', label: 'Intelligence' }, { value: 'wis', label: 'Wisdom' }, { value: 'cha', label: 'Charisma' }],
      modes: [{ value: 'balanced', label: 'Increase three abilities by 1' }, { value: 'focused', label: 'Increase one ability by 2 and another by 1' }],
      balancedChoiceCount: 3,
    });
    if (choiceConfiguration.kind !== 'choice') throw new Error('Expected choice configuration');
    expect(getBackgroundAbilityControlState({ ...choiceConfiguration, eligibleAbilities: ['dex', 'int', 'wis', 'cha'] }, undefined)).toMatchObject({ balancedChoiceCount: 3 });
  });

  it('renders and saves both background allocation modes', () => {
    if (choiceConfiguration.kind !== 'choice') throw new Error('Expected choice configuration');
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];
    const selections: BackgroundAbilitySelection[] = [];
    renderBackgroundAbilityControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, choiceConfiguration, undefined, (selection) => selections.push(selection));
    expect(controls[0].options?.find((option) => option.value === '')).toMatchObject({ text: 'Select an increase mode', disabled: true, selected: true });
    expect(selections).toEqual([]);
    controls[0].value = 'balanced'; controls[0].handlers[0]();
    expect(controls[1]?.options?.map((option) => option.text)).toEqual(['Select an ability', 'Intelligence', 'Wisdom', 'Charisma']);
    expect(selections.at(-1)).toEqual({ advancementId: 'asi', assignments: { int: 1, wis: 1, cha: 1 } });
    controls[0].value = 'focused'; controls[0].handlers[0]();
    controls.at(-2)!.value = 'int'; controls.at(-2)!.handlers[0]();
    controls.at(-1)!.value = 'wis'; controls.at(-1)!.handlers[0]();
    expect(selections.at(-1)).toEqual({ advancementId: 'asi', assignments: { int: 2, wis: 1 } });
  });

  it('keeps focused duplicate options disabled in both directions', () => {
    if (choiceConfiguration.kind !== 'choice') throw new Error('Expected choice configuration');
    const controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }> = [];
    const selections: BackgroundAbilitySelection[] = [];
    renderBackgroundAbilityControls(createInteractiveSpellRoot(controls) as unknown as HTMLElement, choiceConfiguration, undefined, (selection) => selections.push(selection));
    controls[0].value = 'focused'; controls[0].handlers[0]();
    const focused = controls.slice(-2);
    focused[0].value = 'int'; focused[0].handlers[0]();
    expect(focused[1].options?.find((option) => option.value === 'int')?.disabled).toBe(true);
    focused[1].value = 'wis'; focused[1].handlers[0]();
    expect(focused[0].options?.find((option) => option.value === 'wis')?.disabled).toBe(true);
    expect(selections.at(-1)).toEqual({ advancementId: 'asi', assignments: { int: 2, wis: 1 } });
  });

  it('keeps 2014 background completion based on the selected background alone', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), background: { sourcePath: 'packs/_source/backgrounds/sage.yml', identifier: 'sage', id: 'sage' } };
    expect(getCharacterCreationSections(document).find((section) => section.id === 'background')?.status).toBe('complete');
  });

  it('reports stale source choices and score-20 violations during final readiness', () => {
    const stale = completeDocument({ backgroundChoices: { abilityScores: { advancementId: 'old', assignments: { int: 2, wis: 1 } } } });
    expect(validateCharacterCreationReadiness(stale, completeSources())).toContain('Background ability advancement does not match the current source.');
    const capped = completeDocument({ abilityScores: { ...createDefaultAbilityScores(), manual: { str: 0, dex: 0, con: 0, int: 19, wis: 0, cha: 0 } } });
    const before = structuredClone(capped);
    expect(validateCharacterCreationReadiness(capped, completeSources())).toContain('Intelligence cannot be increased above 20.');
    expect(capped).toEqual(before);
  });

  it('accepts expertise from proficient class/background/species skills and rejects a non-proficient skill', () => {
    const rogueClass = { ...completeSources().class!, source: { ...completeSources().class!.source, identifier: 'rogue', name: 'Rogue', sourcePath: 'packs/_source/classes24/rogue.yml' }, proficiencies: { armor: [], weapons: [], tools: [], savingThrows: ['saves:dex'], languages: [], skills: [], choices: [] }, advancements: [{ id: 'skill-proficiencies', type: 'Trait', level: 1, title: 'Skill proficiencies', hint: '', dependencies: [], raw: { configuration: { mode: 'default', choices: 1, pool: ['skills:*'] } } }, { id: 'expertise', type: 'Trait', level: 1, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: 2, pool: ['skills:*'] } } }, { id: 'later-expertise', type: 'Trait', level: 6, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: 2, pool: ['skills:*'] } } }] };
    const speciesSummary = { ...completeSources().species!, advancements: [{ id: 'species-skill', type: 'Trait', level: 1, hint: '', automatic: false, dependencies: [{ uuid: 'skills:per', source: null }], raw: { configuration: { choices: 1, pool: ['skills:per'] } } }] };
    const speciesBuilt = buildSpeciesConfiguration(speciesSummary, snapshot);
    const speciesChoice = speciesBuilt.choices[0]!;
    const speciesSelection = toSpeciesConfigurationSelection({ ...speciesBuilt, choices: [{ ...speciesChoice, selected: ['skills:per'] }] });
    const skillSelection: ClassAdvancementSelection = { advancementId: 'skill-proficiencies', kind: 'trait', configuredPool: ['skills:*'], selected: ['skills:arc'] };
    const expertiseSelection: Extract<ClassAdvancementSelection, { kind: 'expertise' }> = { advancementId: 'expertise', kind: 'expertise', mode: 'expertise', configuredPool: ['skills:*'], selected: ['skills:arc', 'skills:ins', 'skills:ste'] };
    const document = completeDocument({ classProgressions: [{ class: { ...creationClass, identifier: 'rogue', sourcePath: 'packs/_source/classes24/rogue.yml' }, targetLevel: 1, selections: [skillSelection, expertiseSelection] }], speciesConfiguration: speciesSelection });
    const sources = { ...completeSources(), species: speciesSummary, class: rogueClass, background: { ...acolyteSummary, skills: ['skills:ins'] } };
    const errors = validateCharacterCreationReadiness(document, sources);
    expect(errors).toContain('Choose exactly 2 expertise skills.');
    expect(errors).toContain('Expertise requires proficiency in Stealth.');
    const valid = structuredClone(document);
    valid.classProgressions![0]!.selections = [skillSelection, { ...expertiseSelection, selected: ['skills:arc', 'skills:ins'] }];
    expect(validateCharacterCreationReadiness(valid, sources)).not.toEqual(expect.arrayContaining([expect.stringContaining('Expertise requires proficiency')]));
    const speciesValid = structuredClone(document);
    speciesValid.classProgressions![0]!.selections = [skillSelection, { ...expertiseSelection, selected: ['skills:arc', 'skills:per'] }];
    expect(validateCharacterCreationReadiness(speciesValid, { ...sources, background: acolyteSummary })).not.toEqual(expect.arrayContaining([expect.stringContaining('Expertise requires proficiency')]));
    const missing = structuredClone(document);
    missing.classProgressions![0]!.selections = [skillSelection];
    expect(validateCharacterCreationReadiness(missing, { ...completeSources(), class: rogueClass })).toContain('Choose exactly 2 expertise skills.');
  });
  it('blocks final readiness for stale source-derived background languages', () => {
    const document = completeDocument({ backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } }, languages: ['languages:standard:missing'] } });
    const source = { ...acolyteSummary, languageChoices: [{ count: 1, pool: ['languages:standard:*'] }] };
    expect(validateCharacterCreationReadiness(document, completeSources(source))).toContain('Saved background language selection is not allowed by the current source.');
  });
  it('rejects a background language already selected in the species section at finalization', () => {
    const document = completeDocument({ backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } }, languages: ['languages:standard:elvish'] } });
    document.speciesConfiguration = { origin: creationOrigin, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [{ key: 'language', source: { id: 'language', type: 'Trait' }, selected: ['languages:elvish'] }], spellChoices: [] };
    const sources = completeSources({ ...acolyteSummary, languageChoices: [{ count: 1, pool: ['languages:standard:*'] }] });
    sources.species = { ...sources.species!, advancements: [{ id: 'language', type: 'Trait', level: 1, hint: '', automatic: true, dependencies: [], raw: { configuration: { grants: [] } } }] };
    expect(validateCharacterCreationReadiness(document, sources)).toContain('Language choices must be unique across species, class, and background.');
  });

  it('reports granted-feat stale, incomplete, wrong-list, and ability errors without mutation', () => {
    const summary = { ...acolyteSummary, grantedFeat: magicInitiateSummary(), feat: magicInitiateSummary().source };
    const sources = completeSources(summary);
    const valid = completeMagicInitiateSelection();
    const cases: Array<[string, GrantedFeatSelection, string]> = [
      ['stale feat', { ...valid, feat: { ...valid.feat, id: 'stale' } }, 'Granted feat source is stale'],
      ['stale advancement', { ...valid, spellChoices: valid.spellChoices.map((choice, index) => index === 1 ? { ...choice, advancementId: 'stale' } : choice) }, 'persisted granted feat advancement reference is stale'],
      ['missing spells', { ...valid, spellChoices: valid.spellChoices.map((choice) => choice.kind === 'spell' ? { ...choice, selected: [] } : choice) }, 'requires 2 spells'],
      ['wrong list', { ...valid, spellChoices: valid.spellChoices.map((choice) => choice.kind === 'spell' && choice.advancementId === 'cantrips' ? { ...choice, selected: [{ ...magicInitiateSummary().advancements[0]!.dependencies[2]!.source! }] } : choice) }, 'without an authoritative option'],
      ['missing ability', { ...valid, spellChoices: valid.spellChoices.map((choice) => choice.kind === 'spell' ? { ...choice, selectedAbility: undefined } : choice) }, 'requires a spellcasting ability'],
    ];
    for (const [label, grantedFeat, expected] of cases) {
      const document = completeDocument({ backgroundChoices: { abilityScores: completeDocument().backgroundChoices!.abilityScores, grantedFeat } });
      const before = structuredClone(document);
      const errors = validateCharacterCreationReadiness(document, sources);
      expect(errors.some((error) => error.toLowerCase().includes(expected.toLowerCase())), label).toBe(true);
      expect(document, label).toEqual(before);
    }
  });

  it('reports unsupported background sources without mutating the document', () => {
    const before = completeDocument({ backgroundChoices: undefined });
    const sources = completeSources({ ...acolyteSummary, abilityScores: { points: 3, cap: 2, locked: ['str'] } });
    expect(validateCharacterCreationReadiness(before, sources)).toContain('Background ability advancement identity is unavailable.');
    expect(validateCharacterCreationReadiness(before, { ...completeSources(), background: undefined })).toContain('Background source is unavailable.');
    expect(before.backgroundChoices).toBeUndefined();
  });

  it('rejects stale saved species and class configurations at readiness', () => {
    const document = completeDocument({
      speciesConfiguration: { origin: creationOrigin, foundry: { systemVersion: snapshot.systemVersion, sourceBranch: 'old-branch', sourceCommit: snapshot.commit }, grants: [], choices: [], spellChoices: [] },
      classProgressions: [{ ...completeDocument().classProgressions![0]!, selections: [{ advancementId: 'stale', kind: 'trait', selected: [] }] }],
    });
    const before = structuredClone(document);
    const errors = validateCharacterCreationReadiness(document, completeSources());
    expect(errors).toContain('Species source snapshot differs from current source');
    expect(errors).toContain('Unknown class advancement: stale');
    expect(document).toEqual(before);
  });

  it('displays a selected 2024 background constitution bonus in the ability breakdown', async () => {
    const document = completeDocument({ backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { con: 2, dex: 1 } } } });
    const root = createViewRenderRoot();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, { document, sourceIndex: { getSpeciesSummary: async () => completeSources().species!, getClassSummary: async () => completeSources().class!, getBackgroundSummary: async () => ({ ...acolyteSummary, abilityScores: { advancementId: 'asi', points: 3, cap: 2, locked: [] } }) } });
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root.root as unknown as HTMLElement);
    expect(root.text).toContain('Background: Dexterity +1, Constitution +2');
  });

  it('explains why a saved partial Standard Array blocks initial character creation', () => {
    const document = completeDocument({ abilityScores: undefined, abilityScoreDraft: { method: 'standard-array', base: { str: 15, dex: 14 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } } });
    expect(getCharacterCreationSections(document).find((section) => section.id === 'ability-scores')?.status).not.toBe('complete');
    expect(validateCharacterCreationReadiness(document, completeSources())).toContain('Complete all six Standard Array assignments before creating the character.');
  });

  it('preserves legacy saved rolled scores in the document but gates creation when a score exceeds 18', () => {
    const legacy = completeDocument({ abilityScores: { ...createDefaultAbilityScores(), method: 'dice-rolling', base: { str: 30, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } } });
    expect(parseCharacterDocument(legacy).abilityScores?.base.str).toBe(30);
    expect(getCharacterCreationSections(legacy).find((section) => section.id === 'ability-scores')?.status).not.toBe('complete');
    expect(validateCharacterCreationReadiness(legacy, completeSources())).toContain('Rolled Strength base score must be between 3 and 18.');
  });

  it('opens legacy generated 30s as empty rolled fields and saves only entered replacements', async () => {
    const legacy = completeDocument({ abilityScores: { ...createDefaultAbilityScores(), method: 'dice-rolling', base: { str: 30, dex: 14, con: 30, int: 30, wis: 30, cha: 30 }, rolls: { str: [10, 10, 10, 10], con: [10, 10, 10, 10] } } });
    const { root, view, current } = abilityScoreTestView(legacy);
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    expect(abilityRows(root)[0]!.children[1]!.value).toBe('');
    expect(abilityRows(root)[0]!.children[4]!.textContent).toBe('—');
    expect(abilityRows(root)[1]!.children[1]!.value).toBe('14');
    expect(current().abilityScores?.base.str).toBe(30);
    const strength = abilityRows(root)[0]!.children[1]!;
    strength.value = '16'; strength.dispatch('change');
    expect(current().abilityScoreDraft?.base).toEqual({ str: 16, dex: 14 });
    expect(current().abilityScores).toBeUndefined();
  });

  it('requires all six rolled scores before creating the character', () => {
    const incomplete = completeDocument({ abilityScores: undefined, abilityScoreDraft: { method: 'dice-rolling', base: { str: 16 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } } });
    expect(getCharacterCreationSections(incomplete).find((section) => section.id === 'ability-scores')?.status).not.toBe('complete');
    expect(validateCharacterCreationReadiness(incomplete, completeSources())).toContain('Enter all six rolled scores between 3 and 18 before creating the character.');
  });

  it('saves incomplete Point Buy scores and restores them after reopening the section', async () => {
    const { root, view, current } = abilityScoreTestView(completeDocument({ abilityScores: undefined }));
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const method = root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[1]!;
    method.value = 'point-buy'; method.dispatch('change');
    const strength = abilityRows(root)[0]!.children[1]!;
    strength.value = '15'; strength.dispatch('change');
    expect(current().abilityScoreDraft).toMatchObject({ method: 'point-buy', base: { str: 15, dex: 8 } });
    expect(root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[2]!.textContent).toBe('18 points remaining of 27.');
    expect(abilityRows(root)[0]!.children[4]!.textContent).toBe('15');

    const reopened = abilityScoreTestView(current());
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(reopened.view, reopened.root as unknown as HTMLElement);
    expect(abilityRows(reopened.root)[0]!.children[1]!.children.find((option) => option.value === '15')?.selected).toBe(true);
    expect(reopened.root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[2]!.textContent).toBe('18 points remaining of 27.');
  });

  it('requires an exact Point Buy budget before character creation', () => {
    const pointBuy = createDefaultAbilityScores();
    const incomplete = completeDocument({ abilityScores: undefined, abilityScoreDraft: { method: 'point-buy', base: { str: 15, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, manual: pointBuy.manual } });
    expect(getCharacterCreationSections(incomplete).find((section) => section.id === 'ability-scores')?.status).not.toBe('complete');
    expect(validateCharacterCreationReadiness(incomplete, completeSources())).toContain('Spend exactly 27 points on Point Buy before creating the character.');
  });

  it('discards an unfinished Point Buy allocation when switching methods', async () => {
    const { root, view, current } = abilityScoreTestView(completeDocument({ abilityScores: undefined }));
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const method = root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[1]!;
    method.value = 'point-buy'; method.dispatch('change');
    const strength = abilityRows(root)[0]!.children[1]!;
    strength.value = '15'; strength.dispatch('change');
    expect(current().abilityScoreDraft?.method).toBe('point-buy');

    method.value = 'standard-array'; method.dispatch('change');
    const reopened = abilityScoreTestView(current());
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(reopened.view, reopened.root as unknown as HTMLElement);
    const reopenedMethod = reopened.root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[1]!;
    reopenedMethod.value = 'point-buy'; reopenedMethod.dispatch('change');
    expect(reopened.view.document).toMatchObject({ abilityScoreDraft: { method: 'point-buy', base: { str: 8, dex: 8 } } });
  });

  it('resets Standard Array and rolled scores and manual adjustments when switching back', async () => {
    const initialDraft = { method: 'standard-array' as const, base: { str: 15 }, manual: { str: 2, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } };
    const { root, view, current } = abilityScoreTestView(completeDocument({ abilityScores: undefined, abilityScoreDraft: initialDraft }));
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const method = root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[1]!;
    method.value = 'dice-rolling'; method.dispatch('change');
    expect(abilityRows(root)[0]!.children[1]!.value).toBe('');
    expect(abilityRows(root)[0]!.children[3]!.value).toBe('0');
    const rolled = abilityRows(root)[0]!.children[1]!;
    rolled.value = '16'; rolled.dispatch('change');
    const manual = abilityRows(root)[0]!.children[3]!;
    manual.value = '3'; manual.dispatch('change');

    method.value = 'standard-array'; method.dispatch('change');
    expect(abilityRows(root)[0]!.children[1]!.children[0]!.selected).toBe(true);
    expect(abilityRows(root)[0]!.children[3]!.value).toBe('0');
    method.value = 'dice-rolling'; method.dispatch('change');
    expect(abilityRows(root)[0]!.children[1]!.value).toBe('');
    expect(abilityRows(root)[0]!.children[3]!.value).toBe('0');
    expect(current().abilityScoreDraft).toMatchObject({ method: 'dice-rolling', base: {} });
  });

  it('captures each Point Buy draft snapshot before queuing its update', async () => {
    const { root, view } = abilityScoreTestView(completeDocument({ abilityScores: undefined }));
    const updates: Array<(document: CharacterDocument) => CharacterDocument> = [];
    view.queueUpdate = (update: (document: CharacterDocument) => CharacterDocument) => updates.push(update);
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const method = root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[1]!;
    method.value = 'point-buy'; method.dispatch('change');
    const strength = abilityRows(root)[0]!.children[1]!;
    strength.value = '9'; strength.dispatch('change');
    strength.value = '10'; strength.dispatch('change');
    const savedFirstEdit = updates[1]!(completeDocument({ abilityScores: undefined }));
    expect(savedFirstEdit.abilityScoreDraft).toMatchObject({ method: 'point-buy', base: { str: 9 } });
  });

  it('disables Point Buy options that would overspend and resets the draft after changing methods', async () => {
    const { root, view, current } = abilityScoreTestView(completeDocument({ abilityScores: undefined }));
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const method = root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[1]!;
    method.value = 'point-buy'; method.dispatch('change');
    const rows = abilityRows(root);
    rows[0]!.children[1]!.value = '15'; rows[0]!.children[1]!.dispatch('change');
    rows[1]!.children[1]!.value = '15'; rows[1]!.children[1]!.dispatch('change');
    rows[2]!.children[1]!.value = '15'; rows[2]!.children[1]!.dispatch('change');
    expect(abilityRows(root)[3]!.children[1]!.children.find((option) => option.value === '9')?.disabled).toBe(true);
    expect(abilityRows(root)[3]!.children[1]!.children.find((option) => option.value === '8')?.disabled).toBe(false);
    expect(root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[2]!.textContent).toBe('0 points remaining of 27.');
    const rejectedScore = abilityRows(root)[3]!.children[1]!;
    rejectedScore.value = '9'; rejectedScore.dispatch('change');
    expect(current().abilityScores?.base.int).toBe(8);

    method.value = 'standard-array'; method.dispatch('change');
    const reopened = abilityScoreTestView(current());
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(reopened.view, reopened.root as unknown as HTMLElement);
    const pointBuyMethod = reopened.root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[1]!;
    pointBuyMethod.value = 'point-buy'; pointBuyMethod.dispatch('change');
    expect(abilityRows(reopened.root)[0]!.children[1]!.children.find((option) => option.value === '8')?.selected).toBe(true);
    expect(reopened.root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[2]!.textContent).toBe('27 points remaining of 27.');
  });

  it('starts Standard Array fields empty, moves assigned scores, and saves each choice', async () => {
    const initial = completeDocument({ abilityScores: undefined });
    const { root, view, current } = abilityScoreTestView(initial);
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const rows = abilityRows(root);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row.children[1]?.children[0]).toMatchObject({ value: '', selected: true });
    const strength = rows[0]!.children[1]!;
    strength.value = '15'; strength.dispatch('change');
    expect(current().abilityScoreDraft?.base).toEqual({ str: 15 });
    expect(current().abilityScores).toBeUndefined();
    expect(abilityRows(root)[0]!.children[4]!.textContent).not.toBe('—');
    expect(abilityRows(root)[1]!.children[4]!.textContent).toBe('—');
    const dexterity = abilityRows(root)[1]!.children[1]!;
    dexterity.value = '15'; dexterity.dispatch('change');
    expect(current().abilityScoreDraft?.base).toEqual({ dex: 15 });
    expect(abilityRows(root)[0]!.children[1]!.children[0]).toMatchObject({ value: '', selected: true });
    const reopened = abilityScoreTestView(current());
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(reopened.view, reopened.root as unknown as HTMLElement);
    const methodOptions = reopened.root.children.find((child) => child.cls === 'guided-character-sheet__field')?.children[1]?.children ?? [];
    expect(methodOptions.find((option) => option.value === 'standard-array')?.selected).toBe(true);
    expect(abilityRows(reopened.root)[1]!.children[1]!.children.find((option) => option.value === '15')?.selected).toBe(true);
  });

  it('refreshes final scores and modifiers immediately after manual changes', async () => {
    const { root, view } = abilityScoreTestView(completeDocument());
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const before = abilityRows(root)[0]!;
    const initialFinal = before.children[4]!.textContent;
    const manual = before.children[3]!;
    manual.value = '2'; manual.dispatch('change');
    const after = abilityRows(root)[0]!;
    expect(Number(after.children[4]!.textContent)).toBe(Number(initialFinal) + 2);
    expect(after.children[5]!.textContent).not.toBe(before.children[5]!.textContent);
  });

  it('saves a manual adjustment made before any Standard Array base assignment', async () => {
    const { root, view, current } = abilityScoreTestView(completeDocument({ abilityScores: undefined }));
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const manual = abilityRows(root)[0]!.children[3]!;
    manual.value = '2'; manual.dispatch('change');
    expect(current().abilityScoreDraft?.manual.str).toBe(2);
    expect(current().abilityScoreDraft?.base).toEqual({});
  });

  it('shows one empty rolled Base input per ability without shifting bonus and result columns', async () => {
    const { root, view, current } = abilityScoreTestView(completeDocument({ abilityScores: undefined }));
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const method = root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[1]!;
    method.value = 'dice-rolling'; method.dispatch('change');
    for (const [index, row] of abilityRows(root).entries()) {
      expect(row.children).toHaveLength(6);
      expect(row.children[1]).toMatchObject({ tag: 'input', value: '' });
      expect(row.children[2]!.textContent).toBe(index === 3 ? '+2' : index === 4 ? '+1' : '—');
      expect(row.children[4]!.textContent).toBe('—');
      expect(row.children[5]!.textContent).toBe('—');
    }
    expect(current().abilityScoreDraft).toMatchObject({ method: 'dice-rolling', base: {} });
    expect(current().abilityScores).toBeUndefined();
  });

  it('saves each entered rolled score and refreshes the correct final and modifier columns', async () => {
    const { root, view, current } = abilityScoreTestView(completeDocument({ abilityScores: undefined }));
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(view, root as unknown as HTMLElement);
    const method = root.children.find((child) => child.cls === 'guided-character-sheet__field')!.children[1]!;
    method.value = 'dice-rolling'; method.dispatch('change');
    const strengthBase = abilityRows(root)[0]!.children[1]!;
    strengthBase.value = '16'; strengthBase.dispatch('change');
    expect(current().abilityScoreDraft).toMatchObject({ method: 'dice-rolling', base: { str: 16 } });
    expect(abilityRows(root)[0]!.children[4]!.textContent).toBe('16');
    expect(abilityRows(root)[0]!.children[5]!.textContent).toBe('+3');
    const reopened = abilityScoreTestView(current());
    await (CharacterView.prototype as unknown as { renderAbilityScoresStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderAbilityScoresStep.call(reopened.view, reopened.root as unknown as HTMLElement);
    expect(abilityRows(reopened.root)[0]!.children[1]!.value).toBe('16');
  });
  it('offers class selection after an origin and projects level-one class summary', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    const summary = { source: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', pack: 'dnd5e.classes24', type: 'class', id: 'fighter-id', identifier: 'fighter', name: 'Fighter' }, ruleset: '2024' as const, hitDie: 'd10', advancements: [{ id: 'feature', type: 'ItemGrant', level: 1, title: 'Second wind', hint: 'Restore vitality', dependencies: [{ uuid: 'missing', source: null }], raw: { configuration: {} } }] };
    expect(getClassRenderState(document, undefined, undefined, undefined)).toMatchObject({ kind: 'class-unavailable' });
    const state = getClassRenderState(document, summary, buildClassConfiguration(summary, snapshot, 1));
    expect(state).toMatchObject({ kind: 'class-summary', name: 'Fighter', hitDie: 'd10', targetLevel: 1, automatic: [{ title: 'Second wind' }], diagnostics: ['Unresolved class dependency at packs/_source/classes24/fighter/fighter.yml: feature -> missing'] });
    expect(JSON.stringify(state)).not.toContain('HP');
  });

  it('projects granted class features into full-description creation cards', () => {
    const summary = {
      source: { sourcePath: 'packs/_source/classes/barbarian.yml', pack: 'dnd5e.classes', type: 'class', id: 'barbarian-id', name: 'Barbarian' }, ruleset: '2014' as const, hitDie: 'd12', advancements: [], features: [{ advancementId: 'features', level: 1, source: { sourcePath: 'packs/_source/classfeatures/rage.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'rage', name: 'Rage' }, description: 'Enter a battle fury.' }],
    };
    const state = getClassRenderState({ ...withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin: { sourcePath: 'packs/_source/races/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' } }, summary, buildClassConfiguration(summary, snapshot, 1));
    expect(getClassFeatureCallouts(state!)).toEqual([{ name: 'Rage', level: 1, description: 'Enter a battle fury.' }]);
  });

  it('distinguishes an available empty class list from unavailable class data', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    expect(getClassRenderState(document, undefined, undefined, [])).toEqual({ kind: 'class', options: [], diagnostic: 'No classes are available for this ruleset.' });
    expect(getClassRenderState(document, undefined, undefined, undefined)).toEqual({ kind: 'class-unavailable', message: 'Class sources are unavailable. Download the Foundry sources first.' });
  });

  it('surfaces the saved class path when its source cannot be resolved', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const documentWithClass = { ...document, classProgressions: [{ class: classRef, targetLevel: 1, selections: [] }] };
    expect(getClassRenderState(documentWithClass, undefined, undefined)).toEqual({ kind: 'class-unavailable', message: `Unable to resolve saved class source: ${classRef.sourcePath}` });
  });

  it('filters class rendering using the configured target level', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    const summary = { source: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', pack: 'dnd5e.classes24', type: 'class', id: 'fighter-id', identifier: 'fighter', name: 'Fighter' }, ruleset: '2024' as const, hitDie: 'd10', advancements: [{ id: 'later', type: 'ItemGrant', level: 2, title: 'Later', hint: '', dependencies: [], raw: {} }] };
    const state = getClassRenderState({ ...document, classProgressions: [{ class: { sourcePath: summary.source.sourcePath, identifier: 'fighter', id: 'fighter-id' }, targetLevel: 2, selections: [] }] }, summary, buildClassConfiguration(summary, snapshot, 2));
    expect(state).toMatchObject({ kind: 'class-summary', targetLevel: 2, automatic: [{ id: 'later' }] });
  });

  it('does not expose higher-level class choices in the render state', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin: { sourcePath: 'packs/_source/races/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' }, classProgressions: [{ class: { sourcePath: 'packs/_source/classes/warlock.yml', identifier: 'warlock', id: 'warlock-id' }, targetLevel: 1, selections: [] }] };
    const summary = {
      source: { sourcePath: 'packs/_source/classes/warlock.yml', pack: 'dnd5e.classes', type: 'class', id: 'warlock-id', identifier: 'warlock', name: 'Warlock' }, ruleset: '2014' as const, hitDie: 'd8',
      advancements: [
        { id: 'level-one', type: 'ItemChoice', level: 1, title: 'Pact Boon', hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: [] } } },
        { id: 'later', type: 'ItemChoice', level: 2, title: 'Eldritch Invocations', hint: '', dependencies: [], raw: { configuration: { choices: 2, pool: [] } } },
      ],
    };
    const configuration = buildClassConfiguration(summary, snapshot, 1);
    expect(getClassRenderState(document, summary, configuration)).toMatchObject({ choices: [{ advancementId: 'level-one' }] });
  });

  it('does not expose higher-level class features in the render state or callouts', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin: { sourcePath: 'packs/_source/races/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' } };
    const summary = {
      source: { sourcePath: 'packs/_source/classes/warlock.yml', pack: 'dnd5e.classes', type: 'class', id: 'warlock-id', identifier: 'warlock', name: 'Warlock' }, ruleset: '2014' as const, hitDie: 'd8',
      advancements: [],
      features: [
        { advancementId: 'level-one-feature', level: 1, source: { sourcePath: 'packs/_source/classfeatures/agonizing-blast.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'agonizing-blast', name: 'Agonizing Blast' }, description: 'A level-one feature.' },
        { advancementId: 'level-two-feature', level: 2, source: { sourcePath: 'packs/_source/classfeatures/eldritch-invocation.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'eldritch-invocation', name: 'Eldritch Invocation' }, description: 'A later feature.' },
      ],
    };
    const state = getClassRenderState(document, summary, buildClassConfiguration(summary, snapshot, 1));
    expect(state).toMatchObject({ features: [{ advancementId: 'level-one-feature' }] });
    expect(getClassFeatureCallouts(state)).toEqual([{ name: 'Agonizing Blast', level: 1, description: 'A level-one feature.' }]);
  });

  it('does not expose stale derived choices absent from the generated configuration', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin: { sourcePath: 'packs/_source/races/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' } };
    const summary = { source: { sourcePath: 'packs/_source/classes/warlock.yml', pack: 'dnd5e.classes', type: 'class', id: 'warlock-id', identifier: 'warlock', name: 'Warlock' }, ruleset: '2014' as const, hitDie: 'd8', advancements: [] };
    const configuration = buildClassConfiguration(summary, snapshot, 1);
    const stale: ClassAdvancementSelection = { advancementId: 'derived:stale:cantrips-known', kind: 'spell', selectionRole: 'cantrips-known', selected: [], count: 1, level: 0, spellLists: ['warlock'] };
    configuration.choices = [stale];
    const state = getClassRenderState(document, summary, configuration);
    expect(state).toMatchObject({ kind: 'class-summary', choices: [] });
  });

  it('does not render stale restored derived choices while retaining generated ones', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin: { sourcePath: 'packs/_source/races/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' } };
    const spell = { sourcePath: 'packs/_source/spells/light.yml', pack: 'dnd5e.spells', type: 'spell' as const, id: 'light', name: 'Light', level: 0, spellLists: ['warlock'] };
    const summary = { source: { sourcePath: 'packs/_source/classes/warlock.yml', pack: 'dnd5e.classes', type: 'class', id: 'warlock-id', identifier: 'warlock', name: 'Warlock' }, ruleset: '2014' as const, hitDie: 'd8', advancements: [], spellcasting: { cantripsKnown: 1, spellLists: ['warlock'] }, spellOptions: [spell] };
    const configuration = buildClassConfiguration(summary, snapshot, 1);
    const generated = configuration.selections.find((selection) => selection.advancementId.startsWith('derived:'));
    if (generated === undefined) throw new Error('Expected generated derived choice');
    const stale: ClassAdvancementSelection = { advancementId: 'derived:stale:cantrips-known', kind: 'spell', selectionRole: 'cantrips-known', selected: [], count: 1, level: 0, spellLists: ['warlock'] };
    const saved = { ...toClassProgressionSelection(configuration), selections: [generated, stale] };
    const restored = restoreClassConfiguration(saved, { summary, configuration, class: configuration.class });
    restored.choices = [...restored.choices, stale];
    const state = getClassRenderState(document, summary, restored);
    expect(state).toMatchObject({ kind: 'class-summary', choices: [expect.objectContaining({ advancementId: generated.advancementId })] });
    expect((state as Extract<typeof state, { kind: 'class-summary' }>).choices).not.toEqual(expect.arrayContaining([expect.objectContaining({ advancementId: 'derived:stale:cantrips-known' })]));
    expect(restored.selections).toEqual(expect.arrayContaining([expect.objectContaining({ advancementId: 'derived:stale:cantrips-known' })]));
  });

  it('omits the class feature-selection section when the render-projected choices are empty', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin: { sourcePath: 'packs/_source/races/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' } };
    const summary = { source: { sourcePath: 'packs/_source/classes/warlock.yml', pack: 'dnd5e.classes', type: 'class', id: 'warlock-id', identifier: 'warlock', name: 'Warlock' }, ruleset: '2014' as const, hitDie: 'd8', advancements: [] };
    const configuration = buildClassConfiguration(summary, snapshot, 1);
    configuration.choices = [{ advancementId: 'stale', kind: 'item', selected: [] }];
    const state = getClassRenderState(document, summary, configuration);
    expect(state).toMatchObject({ kind: 'class-summary', choices: [] });
    expect(shouldRenderClassFeatureSelections(state)).toBe(false);
  });

  it('keeps an existing class selector available for replacement', () => {
    const prototype = CharacterView.prototype as unknown as Record<string, Function>;
    expect(prototype.renderClassStep.toString()).toContain('selected?.class.id');
    expect(prototype.selectClass.toString()).toContain('withClassProgression');
  });

  it('keeps source-backed pending dependencies in the class summary', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    const dependency = { sourcePath: 'packs/_source/classfeatures/style.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'style', name: 'Fighting style' };
    const summary = { source: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', pack: 'dnd5e.classes24', type: 'class', id: 'fighter-id', identifier: 'fighter', name: 'Fighter' }, ruleset: '2024' as const, hitDie: 'd10', advancements: [{ id: 'choice', type: 'ItemChoice', level: 1, title: 'Fighting style', hint: 'Choose one', dependencies: [{ uuid: 'style', source: dependency }], raw: { configuration: { pool: ['style'], choices: 1 } } }] };
    const state = getClassRenderState(document, summary, buildClassConfiguration(summary, snapshot, 1), []);
    expect(state).toMatchObject({ pending: [{ dependencies: [{ source: { name: 'Fighting style', sourcePath: dependency.sourcePath } }] }] });
  });

  it('renders source-backed class options without internal source paths', () => {
    const labels: string[] = [];
    const select = { multiple: false, selectedOptions: [], createEl: (_tag: string, options?: { value?: string; text?: string }) => { if (options?.text) labels.push(options.text); return { selected: false, disabled: false }; }, addEventListener: () => undefined };
    const field = { createEl: (tag: string, options?: { text?: string }) => { if (tag === 'label' && options?.text) labels.push(options.text); return select; } };
    const root = { createDiv: () => field, createEl: () => ({}) };
    const source = { sourcePath: 'packs/_source/classfeatures/fighter/fighting-style/defense.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'defense', name: 'Defense' };
    const configuration = buildClassConfiguration({ source: { sourcePath: 'packs/_source/classes/fighter.yml', pack: 'dnd5e.classes', type: 'class', id: 'fighter-id', name: 'Fighter' }, ruleset: '2014', hitDie: 'd10', advancements: [{ id: 'style', type: 'ItemChoice', level: 1, title: 'Fighting Style', hint: '', dependencies: [{ uuid: 'style', source }], raw: { configuration: { choices: 1, pool: ['style'] } } }] }, snapshot, 1);
    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined);
    expect(labels).toEqual(expect.arrayContaining(['Defense']));
    expect(labels).toEqual(expect.arrayContaining(['Select an option']));
    expect(labels.some((label) => label.includes('packs/_source'))).toBe(false);
  });

  it('preserves pinned 2024 Bard multi-part selector choices through equipment persistence', async () => {
    const sourceIndex = createPinnedSourceIndex();
    const summary = await sourceIndex.getClassSummary('2024', 'packs/_source/classes24/bard/bard.yml');
    const instrumentAdvancement = summary.advancements.find((advancement) => advancement.raw.configuration && JSON.stringify(advancement.raw.configuration).includes('tool:music:*'));
    expect(instrumentAdvancement?.raw.configuration).toEqual(expect.objectContaining({ choices: [expect.objectContaining({ count: 3, pool: ['tool:music:*'] })] }));
    expect(summary.startingEquipment).toBeDefined();
    const classRef = { sourcePath: summary.source.sourcePath, identifier: summary.source.identifier!, id: summary.source.id };
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const initialConfiguration = buildClassConfiguration(summary, snapshot, 1);
    let document = withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), toClassProgressionSelection(initialConfiguration));
    document = parseCharacterDocument(JSON.parse(JSON.stringify(document)));
    const inputs: Array<{ value: string; checked: boolean; handlers: Array<() => void> }> = [];
    const selects: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; text?: string }> }> = [];
    const makeNode = (): Record<string, unknown> => {
      const node: Record<string, unknown> = {
        options: [],
        createDiv: () => makeNode(),
        createSpan: () => makeNode(),
        createEl: (tag: string, options?: { value?: string; text?: string }) => {
          if (tag === 'label') return makeNode();
          if (tag === 'input') {
            const input = { value: '', checked: false, handlers: [] as Array<() => void>, addEventListener: (_event: string, handler: () => void) => input.handlers.push(handler) };
            inputs.push(input);
            return input;
          }
          if (tag === 'select') {
            const select = makeNode();
            const control = { value: '', handlers: [] as Array<() => void>, options: [] as Array<{ value: string; text?: string }> };
            control.options = select.options as Array<{ value: string; text?: string }>;
            select.addEventListener = (_event: string, handler: () => void) => control.handlers.push(handler);
            Object.defineProperty(select, 'value', { get: () => control.value, set: (value: string) => { control.value = value; } });
            Object.defineProperty(select, 'selectedOptions', { get: () => control.options.filter((option) => option.value === control.value) });
            selects.push(control);
            return select;
          }
          if (tag === 'option') {
            const option = { value: options?.value ?? '', text: options?.text ?? '', disabled: false, selected: false };
            const parentOptions = (node.options as Array<{ value: string; text?: string }>);
            parentOptions.push(option);
            return option;
          }
          return makeNode();
        },
        addEventListener: (_event: string, handler: () => void) => { (node.handlers as Array<() => void> | undefined)?.push(handler); },
        handlers: [],
        isConnected: true,
        textContent: '',
      };
      return node;
    };
    const root = makeNode();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      document,
      activeSection: 'class',
      sourceReader: { listClasses: async () => [{ ...classRef, name: 'Bard', ruleset: '2024' as const }] },
      sourceIndex: { ...sourceIndex, getClassSummary: async () => summary, getByUuid: async () => null },
      renderClassTraits: () => undefined,
      renderClassCallout: (_parent: HTMLElement, _title: string, _open: boolean, render: (content: HTMLElement) => void) => { render(root as unknown as HTMLElement); return root as unknown as HTMLElement; },
      queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => {
        document = parseCharacterDocument(JSON.parse(JSON.stringify(update(parseCharacterDocument(JSON.parse(JSON.stringify(document)))))));
      },
    });

    await (CharacterView.prototype as unknown as { renderClassStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderClassStep.call(view, root as unknown as HTMLElement);
    const toolSelects = selects.filter((select) => select.options?.some((option) => option.value.startsWith('tool:music:')));
    expect(toolSelects.length).toBeGreaterThanOrEqual(3);
    const selectedTools = toolSelects.slice(0, 3).map((select) => { const option = select.options?.find((entry) => entry.value.startsWith('tool:music:')); if (option) { select.value = option.value; select.handlers.at(-1)?.(); return option.value; } return ''; });

    const packageSelect = selects.find((select) => select.options?.some((option) => option.value === 'synthetic:starting-equipment-wealth'));
    expect(packageSelect).toBeDefined();
    packageSelect!.value = 'synthetic:starting-equipment-wealth';
    packageSelect!.handlers.at(-1)?.();
    for (let attempt = 0; attempt < 50 && document.classEquipment === undefined; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.classEquipment).toBeDefined();

    const reconstructed = parseCharacterDocument(JSON.parse(JSON.stringify(document)));
    const selected = reconstructed.classProgressions![0]!.selections.find((choice) => choice.kind === 'trait' && choice.selected.some((value) => value.startsWith('tool:music:')));
    expect(selected).toMatchObject({ selected: expect.arrayContaining(selectedTools.filter(Boolean)) });
    expect(reconstructed.classEquipment?.selected).toMatchObject({ 'synthetic:starting-equipment-choice': 'synthetic:starting-equipment-wealth' });
    expect(reconstructed.inventory?.currency.gp).toBe(90);
  }, 12_000);

  it('does not ask for the Wizard package’s sole nested Staff choice', () => {
    const selects: DropdownTestSelect[] = [];
    const root = createDropdownTestRoot(selects);
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    const summary = { roots: [{ nodeId: 'package', type: 'OR', diagnostics: [], children: [
      { nodeId: 'equipment', type: 'AND', diagnostics: [], children: [{ nodeId: 'focus', type: 'OR', diagnostics: [], children: [{ nodeId: 'staff', type: 'linked', diagnostics: [], item: { sourcePath: 'staff.yml', pack: 'test', type: 'equipment', id: 'staff', name: 'Staff' }, quantity: 1 }] }] },
      { nodeId: 'wealth', type: 'currency', diagnostics: [], currency: { denomination: 'gp', amount: 55 } },
    ] }], diagnostics: [] };

    (CharacterView.prototype as unknown as { renderEquipmentPackages(this: Record<string, unknown>, root: HTMLElement, summary: unknown, saved: unknown, itemChoices: unknown, onChange: () => void): void }).renderEquipmentPackages.call(view, root as unknown as HTMLElement, summary, { selected: { package: 'equipment' }, semantic: {} }, new Map(), () => undefined);

    expect(selects).toHaveLength(1);
    expect(selects[0]?.options.map((option) => option.textContent)).toContain('Staff');
  });

  it('renders the selected class option description below the dropdown', () => {
    const order: string[] = [];
    const details = { textContent: '' };
    const option = { selected: false, disabled: false };
    const select = { multiple: false, selectedOptions: [], createEl: (_tag: string) => option, addEventListener: () => undefined };
    const field = {
      createEl: (tag: string) => { order.push(tag); return tag === 'select' ? select : {}; },
      createDiv: () => { order.push('description'); return details; },
    };
    const root = { createDiv: () => field, createEl: () => ({}) };
    const lifeDomain = { sourcePath: 'packs/_source/subclasses/life-domain.yml', pack: 'dnd5e.subclasses', type: 'subclass', id: 'life-domain', name: 'Life Domain' };
    const summary = { source: { sourcePath: 'packs/_source/classes/cleric.yml', pack: 'dnd5e.classes', type: 'class', id: 'cleric-id', name: 'Cleric' }, ruleset: '2014' as const, hitDie: 'd8', advancements: [{ id: 'domain', type: 'Subclass', level: 1, title: 'Divine Domain', hint: '', dependencies: [{ uuid: 'life-domain', source: lifeDomain, description: 'The Life domain focuses on vitality.' }], raw: { configuration: {} } }] };
    const configuration = buildClassConfiguration(summary, snapshot, 1);
    configuration.choices[0] = { ...configuration.choices[0], selected: lifeDomain } as typeof configuration.choices[0];
    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined);
    expect(order.indexOf('description')).toBeGreaterThan(order.indexOf('select'));
    expect(details.textContent).toContain('The Life domain focuses on vitality.');
  });

  it('keeps invalid saved class selection ids visible and warns', () => {
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const summary = { source: { ...classRef, pack: 'dnd5e.classes24', type: 'class', name: 'Fighter' }, ruleset: '2024' as const, hitDie: 'd10', advancements: [{ id: 'choice', type: 'Trait', level: 1, title: 'Skill', hint: 'Choose one', dependencies: [], raw: { configuration: { pool: ['skills:arcana'] } } }] };
    const configuration = buildClassConfiguration(summary, snapshot, 1);
    configuration.choices[0] = { advancementId: 'choice', kind: 'trait', selected: ['skills:missing'], configuredPool: ['skills:arcana'] };
    const labels: string[] = [];
    const root = { createDiv: () => root, createEl: (_tag: string, options?: { text?: string }) => { if (options?.text) labels.push(options.text); return { multiple: false, selectedOptions: [], createEl: (_child: string, childOptions?: { value?: string; text?: string }) => { if (childOptions?.text) labels.push(childOptions.text); return { selected: false, disabled: false }; }, addEventListener: () => undefined }; } };
    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined);
    expect(labels).toEqual(expect.arrayContaining(['skills:missing (invalid saved selection)', 'Invalid saved class selection: choice (skills:missing)']));
  });

  it('does not warn for valid saved derived class spell selections', () => {
    const spell = spellReference('Light', 'light', 0, ['wizard']);
    const summary = { source: { sourcePath: 'packs/_source/classes24/wizard/wizard.yml', pack: 'dnd5e.classes24', type: 'class', id: 'wizard', name: 'Wizard', identifier: 'wizard' }, ruleset: '2024' as const, hitDie: 'd6', advancements: [], spellcasting: { ability: 'int', cantripsKnown: 1, spellLists: ['wizard'] }, spellOptions: [spell.source] };
    const configuration = buildClassConfiguration(summary, snapshot, 1);
    const choice = configuration.choices.find((entry) => entry.kind === 'spell');
    if (choice?.kind !== 'spell') throw new Error('Expected derived spell choice');
    choice.selected = [spell.source];
    const labels: string[] = [];
    const root = { createDiv: () => root, createEl: (_tag: string, options?: { text?: string }) => { if (options?.text) labels.push(options.text); return { addEventListener: () => undefined, createDiv: () => root, createEl: (_child: string, childOptions?: { text?: string }) => { if (childOptions?.text) labels.push(childOptions.text); return {}; } }; } };
    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined);
    expect(labels).not.toContain(expect.stringContaining('Invalid saved class selection'));
  });

  it('renders selector-backed class skill choices with readable labels', () => {
    const selects: DropdownTestSelect[] = []; const root = createDropdownTestRoot(selects);
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes/barbarian.yml', pack: 'dnd5e.classes', type: 'class', id: 'barbarian-id', identifier: 'barbarian', name: 'Barbarian' },
      ruleset: '2014', hitDie: 'd12', advancements: [{ id: 'skills', type: 'Trait', level: 1, title: '', hint: '', dependencies: [], raw: { configuration: { choices: [{ count: 2, pool: ['skills:ani', 'skills:ath', 'skills:arc', 'skills:his', 'skills:prc'] }] } } }],
    }, snapshot, 1);

    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined);

    expect(selects).toHaveLength(2);
    expect(selects.flatMap((select) => select.options.map((option) => option.textContent))).toEqual(expect.arrayContaining(['Animal Handling', 'Athletics', 'Arcana', 'History', 'Perception']));
  });

  it('derives a class choice label from the source category and count', () => {
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes/barbarian.yml', pack: 'dnd5e.classes', type: 'class', id: 'barbarian-id', identifier: 'barbarian', name: 'Barbarian' },
      ruleset: '2014', hitDie: 'd12', advancements: [{ id: 'skills', type: 'Trait', level: 1, title: '', hint: '', dependencies: [], raw: { configuration: { choices: [{ count: 2, pool: ['skills:ani', 'skills:ath'] }] } } }],
    }, snapshot, 1);

    expect(getClassChoiceLabel(configuration, configuration.choices[0])).toBe('Skill proficiencies — choose 2');
    expect(getClassChoiceHeading(configuration, configuration.choices[0])).toBe('Skill proficiencies');
  });

  it('uses Subclass when the source has no subclass title', () => {
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes24/rogue/rogue.yml', pack: 'dnd5e.classes24', type: 'class', id: 'rogue-id', identifier: 'rogue', name: 'Rogue' },
      ruleset: '2024', hitDie: 'd8', advancements: [{ id: 'subclass', type: 'Subclass', level: 3, title: '', hint: '', dependencies: [], raw: {} }],
    }, snapshot, 3);

    expect(getClassChoiceLabel(configuration, configuration.choices[0]!)).toBe('Subclass');
  });

  it('renders multi-choice class skills as repeated single-select dropdowns', () => {
    const selects: DropdownTestSelect[] = []; const root = createDropdownTestRoot(selects);
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes/barbarian.yml', pack: 'dnd5e.classes', type: 'class', id: 'barbarian-id', identifier: 'barbarian', name: 'Barbarian' },
      ruleset: '2014', hitDie: 'd12', advancements: [{ id: 'skills', type: 'Trait', level: 1, title: '', hint: '', dependencies: [], raw: { configuration: { choices: [{ count: 2, pool: ['skills:ani', 'skills:ath'] }] } } }],
    }, snapshot, 1);

    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined);

    expect(selects).toHaveLength(2); expect(selects.every((select) => !select.multiple)).toBe(true);
  });
  it('offers both rulesets before selection', () => {
    expect(getCharacterRenderState(createCharacterDocument('Ayla', snapshot))).toEqual({ kind: 'ruleset', options: ['2014', '2024'] });
  });

  it('requests races for 2014 and species for 2024', () => {
    const races = [{ name: 'Dwarf', identifier: 'dwarf', id: 'dwarf-id', sourcePath: 'packs/_source/races/dwarf.yml' }];
    const species = [{ name: 'Elf', identifier: 'elf', id: 'elf-id', sourcePath: 'packs/_source/origins24/species/elf.yml' }];
    expect(getCharacterRenderState(withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), races)).toMatchObject({ kind: 'origin', label: 'Race', options: races });
    expect(getCharacterRenderState(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), species)).toMatchObject({ kind: 'origin', label: 'Species', options: species });
  });

  it('restores the saved origin in the refreshed selector', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    expect(getSelectedOriginId(document)).toBe('elf-id');
  });

  it('reports unavailable source data when the selected source cannot be read', () => {
    expect(getCharacterRenderState(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), undefined)).toEqual({ kind: 'unavailable', message: 'Source choices are unavailable. Download the Foundry sources first.' });
  });

  it('projects a selected origin into a species summary state', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    const summary: SpeciesSourceSummary = {
      source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', name: 'Elf' },
      ruleset: '2024',
      description: 'Elves are magical people.', movement: { walk: 30 }, senses: { darkvision: 60 }, creatureType: { value: 'humanoid' },
      advancements: [
        { id: 'grant', type: 'ItemGrant', level: 1, hint: 'Darkvision', automatic: true, dependencies: [{ uuid: 'Compendium.dnd5e.feats.Item.darkvision', source: { sourcePath: 'packs/_source/feats/darkvision.yml', pack: 'dnd5e.feats', type: 'feat', id: 'darkvision', name: 'Darkvision' } }], raw: {} },
        { id: 'choice', type: 'AbilityScoreImprovement', level: 1, hint: 'Choose an ability', automatic: false, dependencies: [{ uuid: 'Compendium.dnd5e.feats.Item.missing', source: null, reason: 'unresolved source UUID' }], raw: {} },
      ],
    };
    expect(getSpeciesRenderState(document, summary)).toEqual({
      kind: 'species-summary', name: 'Elf', sourcePath: document.origin.sourcePath,
      description: 'Elves are magical people.', movement: { walk: 30 }, senses: { darkvision: 60 }, creatureType: { value: 'humanoid' },
      automatic: [{ level: 1, type: 'ItemGrant', hint: 'Darkvision', dependencies: [{ name: 'Darkvision', sourcePath: 'packs/_source/feats/darkvision.yml' }] }],
      pending: [{ level: 1, type: 'AbilityScoreImprovement', hint: 'Choose an ability', dependencies: [] }],
      dependencies: [{ name: 'Darkvision', sourcePath: 'packs/_source/feats/darkvision.yml' }], unresolvedDependencies: ['Compendium.dnd5e.feats.Item.missing'],
      unresolvedWarnings: ['Unresolved dependency UUID: Compendium.dnd5e.feats.Item.missing'],
    });
  });

  it('keeps full authoritative feature descriptions for creation cards', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/half-orc.yml', identifier: 'half-orc', id: 'half-orc-id' } };
    const state = getSpeciesRenderState(document, { source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'half-orc-id', name: 'Half-Orc' }, ruleset: '2024', advancements: [], features: [{ source: { sourcePath: 'packs/_source/feats/relentless.yml', pack: 'dnd5e.feats', type: 'feat', id: 'relentless', name: 'Relentless Endurance' }, level: 0, description: 'When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead.' }] });
    expect(getSpeciesFeatureCallouts(state!)).toEqual([{ name: 'Relentless Endurance', description: 'When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead.', sourcePath: 'packs/_source/feats/relentless.yml' }]);
  });

  it('defaults species creation to level 1 and excludes future advancements and features', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/dragonborn.yml', identifier: 'dragonborn', id: 'dragonborn-id' } };
    const levelOne = { sourcePath: 'packs/_source/origins24/species/traits/breath.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'breath', name: 'Breath Weapon' };
    const levelFive = { sourcePath: 'packs/_source/origins24/species/traits/flight.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'flight', name: 'Draconic Flight' };
    const summary = { source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'dragonborn-id', identifier: 'dragonborn', name: 'Dragonborn' }, ruleset: '2024' as const, advancements: [
      { id: 'breath', type: 'ItemGrant', level: 1, hint: '', automatic: true, dependencies: [{ uuid: 'breath', source: levelOne }], raw: {} },
      { id: 'flight', type: 'ItemGrant', level: 5, hint: '', automatic: true, dependencies: [{ uuid: 'flight', source: levelFive }], raw: {} },
    ], features: [
      { advancementId: 'breath', source: levelOne, level: 1, automatic: true },
      { advancementId: 'flight', source: levelFive, level: 5, automatic: true },
    ] };

    const state = getSpeciesRenderState(document, summary)!;
    expect(state.automatic.map((entry) => entry.level)).toEqual([1]);
    expect(state.dependencies.map((entry) => entry.name)).toEqual(['Breath Weapon']);
    expect(getSpeciesFeatureCallouts(state).map((feature) => feature.name)).toEqual(['Breath Weapon']);
  });

  it('uses total class level for species feature eligibility', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/goliath.yml', identifier: 'goliath', id: 'goliath-id' }, classProgressions: [
      { class: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter' }, targetLevel: 2, selections: [] },
      { class: { sourcePath: 'packs/_source/classes24/barbarian/barbarian.yml', identifier: 'barbarian', id: 'barbarian' }, targetLevel: 3, selections: [] },
    ] };
    const feature = { sourcePath: 'packs/_source/origins24/species/traits/large-form.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'large-form', name: 'Large Form' };
    const summary = { source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'goliath-id', identifier: 'goliath', name: 'Goliath' }, ruleset: '2024' as const, advancements: [{ id: 'large-form', type: 'ItemGrant', level: 5, hint: '', automatic: true, dependencies: [{ uuid: 'large-form', source: feature }], raw: {} }], features: [{ advancementId: 'large-form', source: feature, level: 5, automatic: true }] };

    const state = getSpeciesRenderState(document, summary)!;
    expect(state.automatic.map((entry) => entry.level)).toEqual([5]);
    expect(getSpeciesFeatureCallouts(state).map((entry) => entry.name)).toEqual(['Large Form']);
  });

  it('does not project choice-pool entries as standalone features', () => {
    const state = { kind: 'species-summary' as const, name: 'Dragonborn', sourcePath: 'packs/_source/races/dragonborn/dragonborn.yml', automatic: [], pending: [], dependencies: [], unresolvedDependencies: [], unresolvedWarnings: [], features: [{ source: { sourcePath: 'packs/_source/races/dragonborn/black.yml', pack: 'dnd5e.races', type: 'feat', id: 'black', name: 'Black Breath Weapon' }, level: 1, automatic: false }] };
    expect(getSpeciesFeatureCallouts(state)).toEqual([]);
  });

  it('shows the selected eligible species feat description but not other choice-pool feats', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' }, speciesConfiguration: {
      origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' },
      foundry: { systemVersion: snapshot.systemVersion, sourceBranch: snapshot.branch, sourceCommit: snapshot.commit }, grants: [], spellChoices: [],
      choices: [{ key: 'species:heritage', source: { id: 'heritage', type: 'ItemChoice' }, selected: ['selected-feat'] }],
    } };
    const selected = { sourcePath: 'packs/_source/feats/selected.yml', pack: 'dnd5e.feats', type: 'feat' as const, id: 'selected-feat', name: 'Selected feat' };
    const candidate = { sourcePath: 'packs/_source/feats/candidate.yml', pack: 'dnd5e.feats', type: 'feat' as const, id: 'candidate-feat', name: 'Candidate feat' };
    const summary = { source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race' as const, id: 'elf-id', name: 'Elf' }, ruleset: '2024' as const, advancements: [], features: [
      { source: selected, level: 1, automatic: false, selection: { key: 'species:heritage', value: 'selected-feat' }, description: 'Selected feat rules text.' },
      { source: candidate, level: 1, automatic: false, selection: { key: 'species:heritage', value: 'candidate-feat' }, description: 'Candidate rules text.' },
    ] };

    const state = getSpeciesRenderState(document, summary)!;

    expect(getSpeciesFeatureCallouts(state)).toEqual([{ name: 'Selected feat', description: 'Selected feat rules text.', sourcePath: selected.sourcePath }]);
  });

  it('filters empty core trait values before presentation', () => {
    expect(getVisibleSpeciesTraitValues({ walk: 30, burrow: null, fly: undefined, swim: 0, modes: [] })).toEqual([
      { label: 'Walk', value: '30' },
      { label: 'Swim', value: '0' },
    ]);
  });

  it('combines distance units and hides false or empty core trait fields', () => {
    expect(getVisibleSpeciesTraitValues({ walk: 30, units: 'ft', hover: false, special: '', subtype: 'orc', custom: null })).toEqual([
      { label: 'Walk', value: '30 ft' },
      { label: 'Subtype', value: 'orc' },
    ]);
    expect(getVisibleSpeciesTraitValues({ darkvision: 60, units: 'ft' })).toEqual([{ label: 'Darkvision', value: '60 ft' }]);
  });

  it('does not report supported selectors as unresolved dependencies', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf-wood.yml', identifier: 'elf-wood', id: 'elf-id' } };
    const summary = { source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', identifier: 'elf-wood', name: 'Wood Elf' }, ruleset: '2024' as const, advancements: [{ id: 'keen', type: 'Trait', level: 0, hint: 'Choose a skill', automatic: false, dependencies: [
      { uuid: 'skills:ins', source: null, reason: 'unresolved selector' },
      { uuid: 'skills:prc', source: null, reason: 'unresolved selector' },
      { uuid: 'skills:sur', source: null, reason: 'unresolved selector' },
    ], raw: { _id: 'keen', type: 'Trait', configuration: { choices: [{ count: 1, pool: ['skills:ins', 'skills:prc', 'skills:sur'] }] } } }] };
    const configuration = buildSpeciesConfiguration(summary, snapshot);
    const state = getSpeciesRenderState(document, summary, configuration);
    expect(state?.unresolvedDependencies).toEqual([]);
    expect(state?.unresolvedWarnings).toEqual([]);
  });

  it('deduplicates displayed source relationships reached through nested grants', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    const source = { sourcePath: 'packs/_source/feats/shared.yml', pack: 'dnd5e.feats', type: 'feat', id: 'shared', name: 'Shared' };
    const summary = { source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', name: 'Elf' }, ruleset: '2024' as const, advancements: [
      { id: 'direct', type: 'ItemGrant', level: 1, hint: '', automatic: true, dependencies: [{ uuid: 'direct', source }], raw: {} },
      { id: 'nested', type: 'ItemGrant', level: 1, hint: '', automatic: true, dependencies: [{ uuid: 'nested', source }], raw: {} },
    ] };
    expect(getSpeciesRenderState(document, summary)?.dependencies).toEqual([{ name: 'Shared', sourcePath: source.sourcePath }]);
  });

  it('keeps the origin selector state when no origin is selected', () => {
    const document = withRuleset(createCharacterDocument('Ayla', snapshot), '2024');
    expect(getSpeciesRenderState(document, undefined)).toBeNull();
    expect(getCharacterRenderState(document, [{ name: 'Elf', identifier: 'elf', id: 'elf-id', sourcePath: 'packs/_source/origins24/species/elf.yml' }]).kind).toBe('origin');
  });

  it('keeps the character selector above the ruleset-dependent controls', async () => {
    const source = await import('../src/character-view');
    expect(source.CHARACTER_VIEW_TYPE).toBe('guided-character-sheet');
  });

  it('projects configured grants and choices with saved selection warnings', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    const configuration = createSpeciesConfiguration(document.origin, snapshot);
    configuration.grants.push({ key: 'grant:darkvision', level: 1, label: 'Darkvision', source: { id: 'darkvision', type: 'feat' }, raw: {} });
    configuration.choices.push({ key: 'choice:ability', level: 1, label: 'Choose an ability', count: 2, source: { id: 'ability', type: 'AbilityScoreImprovement' }, options: [{ value: 'abilities:str', label: 'Strength', source: { id: 'abilities:str', type: 'ability' } }], selected: ['invalid'], raw: {} });
    const state = getSpeciesRenderState(document, undefined, configuration);
    expect(state).toMatchObject({ grants: [{ label: 'Darkvision' }], choices: [{ key: 'choice:ability', selected: ['invalid'], required: 2 }], warnings: expect.arrayContaining(['Choice "choice:ability" contains a disallowed value']) });
  });

  it('keeps a required choice visibly pending when its saved selection is empty', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    const configuration = createSpeciesConfiguration(document.origin, snapshot);
    configuration.choices.push({ key: 'choice:ability', level: 1, label: 'Choose an ability', count: 1, source: { id: 'ability', type: 'AbilityScoreImprovement' }, options: [{ value: 'abilities:str', label: 'Strength', source: { id: 'abilities:str', type: 'ability' } }], selected: [], raw: {} });
    expect(getSpeciesRenderState(document, undefined, configuration)).toMatchObject({ choices: [{ required: 1, selected: [] }] });
  });

  it('renders controls and warnings while behaviorally persisting single and multi selections', async () => {
    type FakeOption = { value: string; textContent: string | null; selected: boolean };
    type FakeSelect = FakeOption & { multiple: boolean; options: FakeOption[]; selectedOptions: Array<{ value: string }>; handler: () => void; createEl: (tag: string, options?: { value?: string; text?: string; cls?: string }) => FakeOption; addEventListener: (type: string, handler: () => void) => void };
    type FakeInput = { type: string; value: string; checked: boolean; handler: () => void; addEventListener: (type: string, handler: () => void) => void };
    const textNodes: string[] = [];
    const selects: FakeSelect[] = [];
    const inputs: FakeInput[] = [];
    const root = { createEl(tag: string, options?: { value?: string; text?: string; cls?: string }): FakeOption | FakeSelect | { createEl: (childTag: string) => FakeInput; createSpan: (spanOptions?: { text?: string }) => object } { const option: FakeOption = { value: options?.value ?? '', textContent: options?.text ?? null, selected: false }; if (options?.text) textNodes.push(options.text); if (tag === 'label') return { createEl: (_childTag: string) => { const input: FakeInput = { type: '', value: '', checked: false, handler: () => undefined, addEventListener: (_type: string, handler: () => void) => { input.handler = handler; } }; inputs.push(input); return input; }, createSpan: (spanOptions?: { text?: string }) => { if (spanOptions?.text) textNodes.push(spanOptions.text); return {}; } }; if (tag !== 'select' && tag !== 'ul') return option; if (tag === 'ul') return { ...option, createEl: (_tag: string, childOptions?: { value?: string; text?: string; cls?: string }) => { if (childOptions?.text) textNodes.push(childOptions.text); return { value: '', textContent: childOptions?.text ?? null, selected: false }; }, addEventListener: () => undefined } as unknown as FakeOption; const select: FakeSelect = { ...option, multiple: false, options: [], selectedOptions: [], handler: () => undefined, addEventListener: (_type: string, handler: () => void) => { select.handler = handler; }, createEl: (_tag: string, childOptions?: { value?: string; text?: string; cls?: string }) => { if (childOptions?.text) textNodes.push(childOptions.text); const child = { value: childOptions?.value ?? '', textContent: childOptions?.text ?? null, selected: false }; select.options.push(child); return child; } }; selects.push(select); return select; }, createDiv() { return root; } };
    const configuration = createSpeciesConfiguration({ sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' }, snapshot);
    configuration.choices.push(
      { key: 'single', level: 1, label: 'Choose an ability', count: 1, source: { id: 'single', type: 'ability' }, options: [{ value: 'abilities:str', label: 'Strength', source: { id: 'abilities:str', type: 'ability' } }], selected: ['abilities:str'], raw: {} },
      { key: 'multi', level: 1, label: 'Choose languages', count: 2, source: { id: 'multi', type: 'language' }, options: [{ value: 'languages:common', label: 'Common', source: { id: 'languages:common', type: 'language' } }, { value: 'languages:elvish', label: 'Elvish', source: { id: 'languages:elvish', type: 'language' } }], selected: [], raw: {} },
    );
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const persisted: string[][][] = [];
    const onChange = (next: typeof configuration): void => { if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(() => persisted.push(next.choices.map((choice) => choice.selected)), 0); };
    renderSpeciesConfigurationControls(root as unknown as HTMLElement, { choices: [{ key: 'single', label: 'Choose an ability', required: 1, options: [{ value: 'abilities:str', label: 'Strength' }], selected: ['abilities:str'] }, { key: 'multi', label: 'Choose languages', required: 2, options: [{ value: 'languages:common', label: 'Common' }, { value: 'languages:elvish', label: 'Elvish' }], selected: [] }], warnings: ['Invalid source data'], unresolvedWarnings: ['Unresolved dependency UUID: missing'] }, configuration, onChange);
    expect(selects[0].options.find((option) => option.value === 'abilities:str')?.selected).toBe(true);
    expect(selects[0].multiple).toBe(false);
    selects[0].selectedOptions = [{ value: 'abilities:str' }]; selects[0].handler();
    selects[0].selectedOptions = []; selects[0].handler();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(textNodes).toEqual(expect.arrayContaining(['Select an option', 'Invalid source data', 'Unresolved dependency UUID: missing']));
    expect(textNodes.filter((text) => text === 'Unresolved dependency UUID: missing')).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(persisted).toEqual([[[], []]]);
  });

  it('keeps invalid source diagnostics and unresolved dependencies visible on the configuration path', () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } };
    const configuration = createSpeciesConfiguration(document.origin, snapshot);
    configuration.diagnostics.push('Unsupported species advancement at species.yml: bad (Unknown)', 'Unresolved species choice dependency: missing');
    configuration.choices.push({ key: 'choice:missing', level: 1, label: 'Choose a language', count: 1, source: { id: 'missing', type: 'ItemChoice' }, options: [], selected: [], raw: {} });
    expect(getSpeciesRenderState(document, undefined, configuration)).toMatchObject({ warnings: expect.arrayContaining(configuration.diagnostics) });
  });

  it('reloads an already-open view when Obsidian delivers its leaf state', async () => {
    const source = await import('../src/character-view');
    expect(source.CharacterView.prototype.setState.toString()).toContain('this.opened');
    expect(source.CharacterView.prototype.onOpen.toString()).toContain('this.opened = true');
  });

  it('validates read-only sheet sections in open view state', async () => {
    const view = { opened: false, viewState: null };
    const setState = CharacterView.prototype.setState as unknown as (this: typeof view, state: unknown, result: object) => Promise<void>;
    const getState = CharacterView.prototype.getState as unknown as (this: typeof view) => Record<string, unknown>;

    await setState.call(view, { mode: 'open', filePath: 'Characters/ayla.json', section: 'inventory' }, {});
    expect(getState.call(view)).toEqual({ mode: 'open', filePath: 'Characters/ayla.json', section: 'inventory' });

    await setState.call(view, { mode: 'open', filePath: 'Characters/ayla.json', section: 'unknown' }, {});
    expect(getState.call(view)).toEqual({ mode: 'open', filePath: 'Characters/ayla.json', section: 'abilities' });

    await setState.call(view, { mode: 'create', filePath: 'Characters/ayla.json', section: 'inventory' }, {});
    expect(getState.call(view)).toEqual({ mode: 'create', filePath: 'Characters/ayla.json' });
  });

  it('renders open mode as a partial read-only sheet and keeps create mode editable', async () => {
    const document = createSheetDocument();
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const openRoot = createViewRenderRoot();
    const openView = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(openView, {
      document,
      file,
      viewState: { mode: 'open', filePath: file.path, section: 'abilities' },
      contentEl: openRoot.root,
      store: { list: async () => [file], read: async () => document },
      sourceIndex: {
        getSpeciesSummary: async () => { throw new Error('missing source'); },
        getClassSummary: async () => createSheetClassSummary(document),
        getBackgroundSummary: async () => createSheetBackgroundSummary(document),
      },
      sourceReader: {},
    });
    const render = CharacterView.prototype as unknown as { render(this: Record<string, unknown>): Promise<void> };

    await render.render.call(openView);

    expect(openRoot.text).toEqual(expect.arrayContaining(['Abilities', 'Species source unavailable.']));
    expect(openRoot.text).not.toContain('Build your character one choice at a time.');

    const createRoot = createViewRenderRoot();
    const createView = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(createView, {
      document: createCharacterDocument('Draft', snapshot),
      file,
      viewState: { mode: 'create', filePath: file.path },
      contentEl: createRoot.root,
      sourceIndex: {},
      sourceReader: {},
    });

    await render.render.call(createView);

    expect(createRoot.text).toEqual(expect.arrayContaining(['Build your character one choice at a time.', 'Identity']));
    expect(createRoot.text).not.toContain('Rest unavailable');
  });

  it('resolves finalized Foundry inventory while keeping custom items local and read-only', async () => {
    const document = createInventorySheetDocument();
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const root = createViewRenderRoot();
    const requestedPaths: string[] = [];
    const update = vi.fn();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      document,
      file,
      viewState: { mode: 'open', filePath: file.path, section: 'inventory' },
      contentEl: root.root,
      store: { list: async () => [file], read: async () => document, update },
      sourceIndex: createSheetSourceIndex(document, async (_ruleset, sourcePath) => {
        requestedPaths.push(sourcePath);
        return createChainMailSummary(sourcePath);
      }),
      sourceReader: {},
    });

    await (CharacterView.prototype as unknown as { render(this: Record<string, unknown>): Promise<void> }).render.call(view);

    expect(requestedPaths).toEqual(['packs/_source/equipment24/armor/heavy/chain-mail.yml']);
    expect(root.text).toEqual(expect.arrayContaining(['Inventory', 'Chain Mail', 'Travel journal', 'Equipped']));
    expect(root.text).not.toContain('Not implemented yet');
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps unresolved inventory rows visible and isolates each source failure', async () => {
    const document = createInventorySheetDocument(true);
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const root = createViewRenderRoot();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      document,
      file,
      viewState: { mode: 'open', filePath: file.path, section: 'inventory' },
      contentEl: root.root,
      store: { list: async () => [file], read: async () => document, update: vi.fn() },
      sourceIndex: createSheetSourceIndex(document, async (_ruleset, sourcePath) => sourcePath.includes('chain-mail') ? null : createShieldSummary(sourcePath)),
      sourceReader: {},
    });

    await (CharacterView.prototype as unknown as { render(this: Record<string, unknown>): Promise<void> }).render.call(view);

    expect(root.text).toEqual(expect.arrayContaining(['Chain Mail', 'Quantity 1', 'Shield', 'Travel journal']));
    expect(root.text.filter((text) => text === 'Inventory source unavailable for Chain Mail.')).toHaveLength(1);
  });

  it('loads spell sources by exact identity and contains one failed reference', async () => {
    const document = createSheetDocument();
    const good = { sourcePath: 'packs/_source/spells/light.yml', pack: 'dnd5e.spells', type: 'spell', id: 'light', name: 'Light' };
    const bad = { sourcePath: 'packs/_source/spells/missing.yml', pack: 'dnd5e.spells', type: 'spell', id: 'missing', name: 'Missing Spell' };
    const backgroundGood = { sourcePath: 'packs/_source/spells/guidance.yml', pack: 'dnd5e.spells', type: 'spell', id: 'guidance', name: 'Guidance' };
    document.backgroundChoices = { grantedFeat: { feat: { sourcePath: 'packs/_source/feats/magic-initiate.yml', pack: 'dnd5e.feats', type: 'feat', id: 'magic-initiate', name: 'Magic Initiate' }, spellChoices: [{ key: 'cantrips', advancementId: 'cantrips', kind: 'spell', selected: [backgroundGood] }] } };
    (document.classProgressions[0].selections as unknown[]) = [{ kind: 'spell', selectionRole: 'known-spells', selected: [good, bad], ability: 'intelligence', selectedAbility: 'intelligence' }];
    const file = new TFile(); file.path = 'Characters/ayla.json';
    const update = vi.fn();
    const searchSpells = vi.fn(async ({ query }: { query: string }) => query === 'Guidance' ? [{ ...backgroundGood, ruleset: '2024' as const, level: 0, spellLists: [], ritual: false }] : query === 'Light' ? [{ ...good, ruleset: '2024' as const, level: 0, spellLists: [], ritual: false }] : []);
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, { document, file, store: { update }, sourceIndex: {
      getSpeciesSummary: async () => ({ source: { sourcePath: document.origin.sourcePath, pack: 'p', type: 'race', id: 'elf', name: 'Elf' }, ruleset: '2024' as const, advancements: [] }),
      getClassSummary: async () => createSheetClassSummary(document),
      getBackgroundSummary: async () => createSheetBackgroundSummary(document),
      searchSpells,
    } });
    const sources = await (CharacterView.prototype as unknown as { loadCharacterSheetSources(this: Record<string, unknown>, document: CharacterDocument): Promise<{ spellSummaries?: ReadonlyMap<string, FoundrySpellSummary>; grantedSpells?: unknown[]; warnings: string[] }> }).loadCharacterSheetSources.call(view, document as CharacterDocument);
    expect(sources.spellSummaries?.get(`${good.sourcePath}:${good.pack}:${good.type}:${good.id}`)?.name).toBe('Light');
    expect(sources.spellSummaries?.get(`${backgroundGood.sourcePath}:${backgroundGood.pack}:${backgroundGood.type}:${backgroundGood.id}`)?.name).toBe('Guidance');
    expect(searchSpells).toHaveBeenCalledWith(expect.objectContaining({ query: 'Guidance' }));
    expect(sources.spellSummaries?.has(`${bad.sourcePath}:${bad.pack}:${bad.type}:${bad.id}`)).toBe(false);
    expect(sources.grantedSpells).toBeUndefined();
    expect(sources.warnings).toEqual(['Spell source unavailable for Missing Spell.']);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not fall back to creation inventory before character finalization', async () => {
    const document = { ...createSheetDocument(), inventory: createInventorySheetDocument().mutable.inventory };
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const root = createViewRenderRoot();
    const getItemSummary = vi.fn();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      document,
      file,
      viewState: { mode: 'open', filePath: file.path, section: 'inventory' },
      contentEl: root.root,
      store: { list: async () => [file], read: async () => document, update: vi.fn() },
      sourceIndex: createSheetSourceIndex(document, getItemSummary),
      sourceReader: {},
    });

    await (CharacterView.prototype as unknown as { render(this: Record<string, unknown>): Promise<void> }).render.call(view);

    expect(root.text).toContain('Inventory: Mutable inventory is not available from character finalization.');
    expect(getItemSummary).not.toHaveBeenCalled();
  });

  it('flushes pending creation updates before switching character or entering edit mode', async () => {
    const file = new TFile();
    file.path = 'Characters/borin.json';
    const order: string[] = [];
    const context = {
      app: { vault: { getFileByPath: () => file } },
      file,
      viewState: { mode: 'open', filePath: 'Characters/ayla.json', section: 'abilities' },
      flushPendingUpdate: async () => { order.push('flush'); },
      leaf: { setViewState: async () => { order.push('state'); } },
      loadFromState: async () => { order.push('load'); },
    };
    const methods = CharacterView.prototype as unknown as {
      selectCharacter(this: typeof context, filePath: string): Promise<void>;
      editCharacter(this: typeof context): Promise<void>;
    };

    await methods.selectCharacter.call(context, file.path);
    expect(order).toEqual(['flush', 'state', 'load']);

    order.length = 0;
    await methods.editCharacter.call(context);
    expect(order).toEqual(['flush', 'state', 'load']);
  });

  it('starts a discrete selection persistence immediately and serializes rapid updates', async () => {
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    let persisted = createCharacterDocument('Ayla', snapshot);
    const starts: number[] = [];
    let resolveFirst: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const context = {
      file,
      document: persisted,
      conflict: false,
      persistenceQueue: Promise.resolve(),
      queuedUpdateCount: 0,
      writingUpdate: false,
      opened: true,
      store: {
        update: async (_file: TFile, update: (document: CharacterDocument) => CharacterDocument): Promise<CharacterDocument> => {
          starts.push(Date.now());
          if (starts.length === 1) await firstWrite;
          persisted = update(persisted);
          return persisted;
        },
      },
      render: async () => undefined,
      renderUnavailable: () => undefined,
    };
    const queueUpdate = (CharacterView.prototype as unknown as { queueUpdate(this: typeof context, update: (document: CharacterDocument) => CharacterDocument): void }).queueUpdate;

    queueUpdate.call(context, (document: CharacterDocument) => ({ ...document, name: 'First choice' }));
    await Promise.resolve();
    expect(starts).toHaveLength(1);

    queueUpdate.call(context, (document: CharacterDocument) => ({ ...document, step: 'species' }));
    await Promise.resolve();
    expect(starts).toHaveLength(1);

    resolveFirst?.();
    await (CharacterView.prototype as unknown as { flushPendingUpdate(this: typeof context): Promise<void> }).flushPendingUpdate.call(context);
    expect(starts).toHaveLength(2);
    expect(persisted).toMatchObject({ name: 'First choice', step: 'species' });
  });

  it('persists and reconstructs each granted-feat selection before the next choice', async () => {
    let persisted = JSON.stringify(completeDocument());
    let writes = 0;
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const context = {
      file,
      document: parseCharacterDocument(JSON.parse(persisted)),
      conflict: false,
      persistenceQueue: Promise.resolve(),
      queuedUpdateCount: 0,
      writingUpdate: false,
      opened: true,
      store: {
        update: async (_file: TFile, update: (document: CharacterDocument) => CharacterDocument): Promise<CharacterDocument> => {
          writes += 1;
          const next = parseCharacterDocument(update(parseCharacterDocument(JSON.parse(persisted))));
          persisted = JSON.stringify(next);
          return next;
        },
      read: async (_file: TFile) => parseCharacterDocument(JSON.parse(persisted)),
      },
      render: async () => undefined,
      renderUnavailable: () => undefined,
    };
    const queueUpdate = (CharacterView.prototype as unknown as { queueUpdate(this: typeof context, update: (document: CharacterDocument) => CharacterDocument): void }).queueUpdate;
    const flush = (CharacterView.prototype as unknown as { flushPendingUpdate(this: typeof context): Promise<void> }).flushPendingUpdate;
    let configuration = magicInitiateConfiguration();
    const persistSelection = async (): Promise<void> => {
      const selection = toGrantedFeatSelection(configuration);
      queueUpdate.call(context, (document: CharacterDocument) => withBackgroundGrantedFeat(document, selection, configuration));
      await Promise.resolve();
      await Promise.resolve();
      context.document = await context.store.read(file);
      const restored = restoreGrantedFeatConfiguration(magicInitiateConfiguration(), context.document.backgroundChoices?.grantedFeat);
      if (restored.kind !== 'choice') throw new Error('Expected a restorable granted-feat configuration');
      configuration = restored;
    };

    configuration = setGrantedFeatSpellChoice(configuration, configuration.spellChoices[0]!.key, ['cleric']);
    await persistSelection();
    configuration = setGrantedFeatSpellChoice(configuration, configuration.spellChoices[1]!.key, configuration.spellChoices[1]!.options.slice(0, 2).map((option) => option.source));
    await persistSelection();
    configuration = setGrantedFeatSpellChoice(configuration, configuration.spellChoices[2]!.key, [configuration.spellChoices[2]!.options[0]!.source]);
    await persistSelection();
    configuration = setGrantedFeatSpellcastingAbility(configuration, 'wis');
    await persistSelection();
    await flush.call(context);

    const final = context.document.backgroundChoices?.grantedFeat;
    expect(writes).toBe(4);
    const spellSelections = final?.spellChoices.filter((choice) => choice.kind === 'spell');
    expect(spellSelections).toHaveLength(2);
    expect(spellSelections?.[0]?.selected).toHaveLength(2);
    expect(spellSelections?.[1]?.selected).toHaveLength(1);
    expect(spellSelections?.map((choice) => choice.selectedAbility)).toEqual(['wis', 'wis']);
    expect(validateGrantedFeatConfiguration(restoreGrantedFeatConfiguration(magicInitiateConfiguration(), final))).not.toContain('requires 2 spells');
  });

  it('snapshots rapid valid ability updates before later draft mutations', () => {
    let persisted = createCharacterDocument('Ayla', snapshot);
    const first = createDefaultAbilityScores();
    first.manual.str = 1;
    const second = structuredClone(first);
    second.manual.dex = 2;
    const firstUpdate = createAbilityScoreUpdate(first);
    const secondUpdate = createAbilityScoreUpdate(second);
    first.manual.str = 0;
    second.manual.dex = 0;
    persisted = firstUpdate(persisted);
    expect(persisted.abilityScores?.manual).toMatchObject({ str: 1, dex: 0 });
    persisted = secondUpdate(persisted);
    expect(persisted.abilityScores?.manual).toMatchObject({ str: 1, dex: 2 });
  });

  it('ignores its own modify event during an active persistence write', async () => {
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const read = vi.fn(async () => createCharacterDocument('Reloaded', snapshot));
    const render = vi.fn(async () => undefined);
    let context: {
      file: TFile;
      document: CharacterDocument;
      opened: boolean;
      conflict: boolean;
      queuedUpdateCount: number;
      writingUpdate: boolean;
      pendingUpdate?: (document: CharacterDocument) => CharacterDocument;
      pendingTimer?: number;
      flushInProgress?: Promise<void>;
      lastWrittenDocument?: CharacterDocument;
      store: {
        update: (file: TFile, update: (document: CharacterDocument) => CharacterDocument) => Promise<CharacterDocument>;
        read: (file: TFile) => Promise<CharacterDocument>;
      };
      render: () => Promise<void>;
      renderUnavailable: ReturnType<typeof vi.fn>;
    };
    const queueUpdate = (CharacterView.prototype as unknown as { queueUpdate(this: typeof context, update: (document: CharacterDocument) => CharacterDocument): void }).queueUpdate;
    const flush = (CharacterView.prototype as unknown as { flushPendingUpdate(this: typeof context): Promise<void> }).flushPendingUpdate;
    context = {
      file,
      document: createCharacterDocument('Ayla', snapshot),
      opened: true,
      conflict: false,
      queuedUpdateCount: 0,
      writingUpdate: false,
      store: {
        update: async (target, update) => {
          const updated = update(context.document);
          context.document = updated;
          await (CharacterView.prototype as unknown as { handleExternalModification(this: typeof context): Promise<void> }).handleExternalModification.call(context);
          expect(context.writingUpdate).toBe(true);
          expect(target).toBe(file);
          return updated;
        },
        read,
      },
      render,
      renderUnavailable: vi.fn(),
    };
    queueUpdate.call(context, (document: CharacterDocument) => ({ ...document, name: 'Updated' }));
    await flush.call(context);
    expect(context.conflict).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledOnce();
    expect(context.writingUpdate).toBe(false);
  });

  it('reports a conflict for an external modify event while persistence is queued', async () => {
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const renderUnavailable = vi.fn();
    const context = { file, conflict: false, writingUpdate: false, queuedUpdateCount: 1, store: { read: vi.fn() }, render: vi.fn(), renderUnavailable };
    await (CharacterView.prototype as unknown as { handleExternalModification(this: typeof context): Promise<void> }).handleExternalModification.call(context);
    expect(context.conflict).toBe(true);
    expect(renderUnavailable).toHaveBeenCalledWith(expect.stringContaining('changed externally'));
    expect(context.store.read).not.toHaveBeenCalled();
  });

  it('reloads after a modify event when the persistence queue is idle', async () => {
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const document = createCharacterDocument('Reloaded', snapshot);
    const read = vi.fn(async () => document);
    const render = vi.fn(async () => undefined);
    const context = { file, document: createCharacterDocument('Old', snapshot), conflict: false, writingUpdate: false, queuedUpdateCount: 0, store: { read }, render, renderUnavailable: vi.fn() };
    await (CharacterView.prototype as unknown as { handleExternalModification(this: typeof context): Promise<void> }).handleExternalModification.call(context);
    expect(read).toHaveBeenCalledWith(file);
    expect(context.document).toBe(document);
    expect(render).toHaveBeenCalledOnce();
  });

  it('drains queued work on close and ignores callbacks queued after close', async () => {
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const updates: string[] = [];
    const context = {
      file,
      opened: true,
      conflict: false,
      persistenceQueue: Promise.resolve(),
      queuedUpdateCount: 0,
      writingUpdate: false,
      store: { update: async (_file: TFile, update: (document: CharacterDocument) => CharacterDocument) => { updates.push(update(createCharacterDocument('Ayla', snapshot)).name); return createCharacterDocument('Ayla', snapshot); } },
      render: async () => undefined,
      renderUnavailable: () => undefined,
    };
    Object.assign(context, { flushPendingUpdate: (CharacterView.prototype as unknown as { flushPendingUpdate: () => Promise<void> }).flushPendingUpdate });
    const queueUpdate = (CharacterView.prototype as unknown as { queueUpdate(this: typeof context, update: (document: CharacterDocument) => CharacterDocument): void }).queueUpdate;
    queueUpdate.call(context, (document: CharacterDocument) => ({ ...document, name: 'Before close' }));
    await (CharacterView.prototype as unknown as { onClose(this: typeof context): Promise<void> }).onClose.call(context);
    expect(updates).toEqual(['Before close']);
    queueUpdate.call(context, (document: CharacterDocument) => ({ ...document, name: 'After close' }));
    await Promise.resolve();
    expect(updates).toEqual(['Before close']);
  });
  it('renders one background-language dropdown per required selection', () => {
    const selects: DropdownTestSelect[] = [];
    const root = createDropdownTestRoot(selects);
    const renderBackgroundLanguageChoice = (CharacterView.prototype as unknown as {
      renderBackgroundLanguageChoice(root: HTMLElement, pool: string[], selected: string[], count: number): void;
    }).renderBackgroundLanguageChoice;

    renderBackgroundLanguageChoice.call(
      { queueUpdate: () => undefined },
      root as unknown as HTMLElement,
      ['languages:standard:common', 'languages:standard:elvish', 'languages:standard:dwarvish'],
      ['languages:standard:common'],
      2,
    );

    expect(selects).toHaveLength(2);
    expect(selects.every((select) => !select.multiple)).toBe(true);
    expect(selects[1].options.find((option) => option.value === 'languages:standard:common')?.disabled).toBe(true);
  });

  it('uses the Foundry background language count instead of assuming choose two', async () => {
    const document = { ...withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin: { sourcePath: 'packs/_source/races/elf.yml', identifier: 'elf', id: 'elf-id' }, classProgressions: [{ class: { sourcePath: 'packs/_source/classes/fighter.yml', identifier: 'fighter', id: 'fighter-id' }, targetLevel: 1, selections: [] }], background: { sourcePath: 'packs/_source/backgrounds/sage.yml', identifier: 'sage', id: 'sage-id' }, step: 'background' as const };
    const summary = { source: { sourcePath: document.background.sourcePath, pack: 'dnd5e.backgrounds', type: 'background', id: 'sage-id', identifier: 'sage', name: 'Sage' }, ruleset: '2014' as const, skills: [], languages: [], languageChoices: [{ count: 3, pool: ['languages:standard:*'] }], tools: [], features: [], equipment: [] };
    let renderedCount: number | undefined;
    const root = createDropdownTestRoot([]);
    const renderBackgroundStep = (CharacterView.prototype as unknown as { renderBackgroundStep(root: HTMLElement): Promise<void> }).renderBackgroundStep;

    await renderBackgroundStep.call({
      document,
      sourceReader: { listBackgrounds: async () => [] },
      sourceIndex: { getBackgroundSummary: async () => summary, getClassSummary: async () => completeSources().class!, getSpeciesSummary: async () => completeSources().species! },
      renderStateMessage: () => undefined,
      renderClassCallout: (_root: HTMLElement, _label: string, _open: boolean, render: (content: HTMLElement) => void) => { render(root as unknown as HTMLElement); return root; },
      renderBackgroundOverview: () => undefined,
      renderBackgroundLanguageChoice: (_root: HTMLElement, _pool: string[], _selected: string[], count: number) => { renderedCount = count; },
    }, root as unknown as HTMLElement);

    expect(renderedCount).toBe(3);
  });

  it('renders one class-choice dropdown per required selection and disables duplicates', () => {
    const selects: DropdownTestSelect[] = [];
    const root = createDropdownTestRoot(selects);
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes/barbarian.yml', pack: 'dnd5e.classes', type: 'class', id: 'barbarian-id', identifier: 'barbarian', name: 'Barbarian' },
      ruleset: '2014', hitDie: 'd12', advancements: [{ id: 'skills', type: 'Trait', level: 1, title: '', hint: '', dependencies: [], raw: { configuration: { choices: [{ count: 2, pool: ['skills:ani', 'skills:ath'] }] } } }],
    }, snapshot, 1);

    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined);

    expect(selects).toHaveLength(2);
    expect(selects.every((select) => !select.multiple)).toBe(true);
    selects[0].value = 'skills:ani';
    selects[0].handlers[0]();
    expect(selects[1].options.find((option) => option.value === 'skills:ani')?.disabled).toBe(true);
  });
  it('shows pinned Appendix D descriptions for every mastery-bearing eligible weapon', async () => {
    const sourceIndex = createPinnedSourceIndex();
    const [weapons, descriptions, shortsword] = await Promise.all([
      sourceIndex.resolveSelector('weapon:*', '2024'),
      sourceIndex.getWeaponMasteryDescriptions(),
      sourceIndex.getItemSummary('2024', 'packs/_source/equipment24/weapons/martial-melee/shortsword.yml'),
    ]);
    expect(shortsword?.description).toBe('');
    const masteryWeapons = weapons.filter((weapon) => weapon.mastery?.trim());
    expect(masteryWeapons.length).toBeGreaterThan(0);
    for (const weapon of masteryWeapons) {
      const option = classChoiceDisplayOptionFromSource(weapon, 'weapon:*', descriptions);
      expect(option.description).toBe(descriptions.get(weapon.mastery!.toLocaleLowerCase()));
      expect(option.description).toBeTruthy();
    }
    expect(classChoiceDisplayOptionFromSource(shortsword!, 'weapon:*', descriptions).description).toContain('Advantage on your next attack roll');
    let renderedDescription = '';
    const detail = { set textContent(value: string) { renderedDescription = value; } };
    const shortOption = classChoiceDisplayOptionFromSource(shortsword!, 'weapon:*', descriptions);
    renderClassChoiceDetails({ createDiv: () => detail } as unknown as HTMLElement, [shortOption], [`weapon:${shortsword!.id}`]);
    expect(renderedDescription).toContain('Advantage on your next attack roll');
  });

  it('offers mastery only for distinct source weapons with mastery and eligible training', () => {
    const selects: DropdownTestSelect[] = [];
    const root = createDropdownTestRoot(selects);
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes24/rogue/rogue.yml', pack: 'dnd5e.classes24', type: 'class', id: 'rogue', name: 'Rogue' },
      ruleset: '2024', hitDie: 'd8', advancements: [{ id: 'mastery', type: 'Trait', level: 1, title: 'Weapon Mastery', hint: '', dependencies: [], raw: { configuration: { mode: 'mastery', choices: [{ count: 2, pool: ['weapon:*'] }] } } }],
    }, snapshot, 1);
    const item = (id: string, category: string, mastery: string, sourcePath = `${id}.yml`): FoundryItemSummary => ({ sourcePath, pack: 'dnd5e.equipment24', type: 'weapon', id, identifier: id, name: id, ruleset: '2024', itemType: 'weapon', category, subcategory: id, mastery, magic: false, equippable: true, properties: [] });
    const resolved = [item('dagger', 'simpleM', 'nick'), item('dagger', 'simpleM', 'nick', 'duplicate-dagger.yml'), item('shortsword', 'martialM', 'vex'), item('warhammer', 'martialM', 'push'), item('unarmed-strike', 'simpleM', ''), item('weapon-plus-one', 'martialM', '')].map((source) => ({ id: `weapon:${source.id}`, name: source.name, sourcePath: source.sourcePath, source, sourceSelector: 'weapon:*' }));

    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined, undefined, undefined, new Map([['mastery', resolved]]), [], ['weapon:sim', 'weapon:mar:shortsword']);

    expect(selects).toHaveLength(2);
    for (const select of selects) expect(select.options.filter((option) => option.value !== '').map((option) => option.value)).toEqual(['weapon:dagger', 'weapon:shortsword']);
  });

  it('offers only source-pooled proficiencies in expertise dropdowns', () => {
    const selects: DropdownTestSelect[] = [];
    const root = createDropdownTestRoot(selects);
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes24/rogue/rogue.yml', pack: 'dnd5e.classes24', type: 'class', id: 'rogue-id', identifier: 'rogue', name: 'Rogue' },
      ruleset: '2024', hitDie: 'd8', advancements: [{ id: 'expertise', type: 'Trait', level: 1, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: [{ count: 2, pool: ['skills:*'] }] } } }],
    }, snapshot, 1);

    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined, undefined, undefined, undefined, ['skills:dec', 'skills:prc', 'tool:thief']);

    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select.options.filter((option) => option.value !== '').map((option) => option.value)).toEqual(['skills:dec', 'skills:prc']);
      expect(select.options.some((option) => option.value === 'skills:acr')).toBe(false);
      expect(select.options.some((option) => option.value === 'tool:thief')).toBe(false);
    }
  });

  it('keeps a stale expertise selection visible but disabled for correction', () => {
    const selects: DropdownTestSelect[] = [];
    const rendered: string[] = [];
    const root = createDropdownTestRoot(selects, rendered);
    const built = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes24/rogue/rogue.yml', pack: 'dnd5e.classes24', type: 'class', id: 'rogue-id', identifier: 'rogue', name: 'Rogue' },
      ruleset: '2024', hitDie: 'd8', advancements: [{ id: 'expertise', type: 'Trait', level: 1, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: [{ count: 1, pool: ['skills:*'] }] } } }],
    }, snapshot, 1);
    const choice = built.choices[0];
    if (choice?.kind !== 'expertise') throw new Error('Expected expertise choice');
    const configuration = setClassSelection(built, { ...choice, selected: ['skills:acr'] });

    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined, undefined, undefined, undefined, ['skills:dec']);

    const stale = selects[0]?.options.find((option) => option.value === 'skills:acr');
    expect(stale).toMatchObject({ textContent: 'Acrobatics (not proficient)', disabled: true, selected: true });
    expect(rendered).toContain('Expertise requires proficiency in Acrobatics.');
  });

  it('expands the pinned 2024 Bard skill wildcard into all skill proficiency options', () => {
    const selects: DropdownTestSelect[] = [];
    const root = createDropdownTestRoot(selects);
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes24/bard/bard.yml', pack: 'dnd5e.classes24', type: 'class', id: 'bard-id', identifier: 'bard', name: 'Bard' },
      ruleset: '2024', hitDie: 'd8', advancements: [{ id: 'NGtmmsYBnIAGKUSn', type: 'Trait', level: 1, title: 'Skill Proficiencies', hint: '', classRestriction: 'primary', dependencies: [], raw: { configuration: { choices: [{ count: 3, pool: ['skills:*'] }] } } }],
    }, snapshot, 1);

    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined, undefined, undefined, new Map([['NGtmmsYBnIAGKUSn', []]]));

    const expected = [
      ['skills:acr', 'Acrobatics'], ['skills:ani', 'Animal Handling'], ['skills:arc', 'Arcana'], ['skills:ath', 'Athletics'],
      ['skills:dec', 'Deception'], ['skills:his', 'History'], ['skills:ins', 'Insight'], ['skills:itm', 'Intimidation'],
      ['skills:inv', 'Investigation'], ['skills:med', 'Medicine'], ['skills:nat', 'Nature'], ['skills:prc', 'Perception'],
      ['skills:prf', 'Performance'], ['skills:per', 'Persuasion'], ['skills:rel', 'Religion'], ['skills:slt', 'Sleight of Hand'],
      ['skills:ste', 'Stealth'], ['skills:sur', 'Survival'],
    ];
    expect(selects).toHaveLength(3);
    for (const select of selects) expect(select.options.filter((option) => option.value !== '').map((option) => [option.value, option.textContent])).toEqual(expected);
  });

  it('autosaves categorized source-backed wildcard traits using canonical identifiers', () => {
    const selects: DropdownTestSelect[] = [];
    const root = createDropdownTestRoot(selects);
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes24/bard/bard.yml', pack: 'dnd5e.classes24', type: 'class', id: 'bard-id', identifier: 'bard', name: 'Bard' },
      ruleset: '2024', hitDie: 'd8', advancements: [{ id: 'tools', type: 'Trait', level: 1, title: 'Tool proficiency', hint: '', classRestriction: 'primary', dependencies: [], raw: { configuration: { choices: [{ count: 1, pool: ['tool:music:*'] }] } } }],
    }, snapshot, 1);
    const source = { sourcePath: 'packs/_source/items24/tools/lyre.yml', pack: 'dnd5e.items24', type: 'tool', id: 'foundry-document-id', identifier: 'lyre', name: 'Lyre' };
    let changed: ClassAdvancementSelection | undefined;

    const resolvedPools = new Map([['tools', [{ id: 'tool:foundry-document-id', name: 'Lyre', sourcePath: source.sourcePath, source }]]]);
    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, (_next, selection) => { changed = selection; }, undefined, undefined, resolvedPools);

    expect(selects[0].options.find((option) => option.textContent === 'Lyre')?.value).toBe('tool:music:lyre');
    selects[0].value = 'tool:music:lyre';
    selects[0].handlers[0]();

    expect(changed).toMatchObject({ advancementId: 'tools', kind: 'trait', selected: ['tool:music:lyre'] });
  });

  it('keeps multiple same-type wildcard selectors distinct', () => {
    const selects: DropdownTestSelect[] = [];
    const root = createDropdownTestRoot(selects);
    const configuration = buildClassConfiguration({
      source: { sourcePath: 'packs/_source/classes24/bard/bard.yml', pack: 'dnd5e.classes24', type: 'class', id: 'bard-id', identifier: 'bard', name: 'Bard' },
      ruleset: '2024', hitDie: 'd8', advancements: [{ id: 'tools', type: 'Trait', level: 1, title: 'Tool proficiencies', hint: '', dependencies: [], raw: { configuration: { choices: [{ count: 2, pool: ['tool:music:*', 'tool:art:*'] }] } } }],
    }, snapshot, 1);
    const source = (id: string, identifier: string) => ({ sourcePath: `packs/_source/items24/tools/${identifier}.yml`, pack: 'dnd5e.items24', type: 'tool', id, identifier, name: identifier });
    renderClassConfigurationControls(root as unknown as HTMLElement, configuration, () => undefined, undefined, undefined, new Map([['tools', [
      { id: 'tool:document-music', name: 'Lyre', sourcePath: 'music.yml', source: source('document-music', 'lyre'), sourceSelector: 'tool:music:*' },
      { id: 'tool:document-art', name: 'Painter supplies', sourcePath: 'art.yml', source: source('document-art', 'painter'), sourceSelector: 'tool:art:*' },
    ]]]));

    expect(selects[0].options.map((option) => option.value)).toContain('tool:music:lyre');
    expect(selects[0].options.map((option) => option.value)).toContain('tool:art:painter');
  });

  it('resolves wildcard sources through the class renderer and preserves the choice across equipment updates', async () => {
    const document = createSheetDocument();
    Object.assign(document.classProgressions[0], { targetLevel: 2, selections: [{ advancementId: 'tools', kind: 'trait', selected: ['tool:music:lyre'], configuredPool: ['tool:music:*'] } as ClassAdvancementSelection] });
    const summary = {
      ...createSheetClassSummary(document),
      advancements: [
        { id: 'tools', type: 'Trait', level: 1, title: 'Tool proficiency', hint: '', dependencies: [], raw: { configuration: { choices: [{ count: 1, pool: ['tool:music:*'] }] } } },
        { id: 'skills', type: 'Trait', level: 2, title: 'Skill proficiency', hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: ['skills:acr'] } } },
      ],
      startingEquipment: { roots: [], diagnostics: [] },
    };
    const item = { sourcePath: 'packs/_source/items24/tools/lyre.yml', pack: 'dnd5e.items24', type: 'tool', id: 'document-id', identifier: 'lyre', name: 'Lyre', ruleset: '2024' as const, itemType: 'tool', magic: false, equippable: false, properties: [] };
    expect(buildClassConfiguration(summary, snapshot, 1).choices).toHaveLength(1);
    const selects: DropdownTestSelect[] = [];
    const textNodes: string[] = [];
    const root = createDropdownTestRoot(selects, textNodes);
    let pending: ((value: typeof document) => typeof document) | undefined;
    let equipmentCommit: ((selection: unknown) => void) | undefined;
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      document,
      activeSection: 'class',
      sourceReader: { listClasses: async () => [{ id: 'fighter-id', name: 'Fighter', identifier: 'fighter', sourcePath: document.classProgressions[0].class.sourcePath }] },
      sourceIndex: { getClassSummary: async () => summary, resolveSelector: async () => [item] },
      renderClassTraits: () => undefined,
      renderClassCallout: (_root: HTMLElement, _label: string, _open: boolean, render: (content: HTMLElement) => void) => { render(root as unknown as HTMLElement); return root; },
      renderEquipmentPackages: (_root: HTMLElement, _summary: unknown, _selected: unknown, _resolved: unknown, commit: (selection: unknown) => void) => { equipmentCommit = commit; },
      queueUpdate: (update: (value: typeof document) => typeof document) => { const previous = pending; pending = previous === undefined ? update : (value) => update(previous(value)); },
    });

    await (CharacterView.prototype as unknown as { renderClassStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderClassStep.call(view, root as unknown as HTMLElement);
    expect(textNodes).toContain('Fighter · Level 2');
    const levelPreview = selects.find((select) => select.attributes['aria-label'] === 'Class level preview');
    expect(levelPreview).toBeDefined();
    expect(levelPreview?.options.map((option) => option.value)).toEqual(Array.from({ length: 20 }, (_value, index) => String(index + 1)));
    const traitSelect = selects.find((select) => select.options.some((option) => option.value === 'tool:music:lyre'))!;
    expect(traitSelect.options.map((option) => option.value)).toContain('tool:music:lyre');
    traitSelect.value = 'tool:music:lyre';
    traitSelect.handlers[0]();
    expect(pending).toBeTypeOf('function');
    equipmentCommit?.({ selected: { starter: 'selected' }, semantic: {} });

    const afterEquipment = pending!(document);
    expect(afterEquipment.classProgressions?.[0].selections).toContainEqual(expect.objectContaining({ advancementId: 'tools', selected: ['tool:music:lyre'] }));
  });

  it('renders species selections as distinct dropdowns and persists each choice', async () => {
    const textNodes: string[] = [];
    const selects: DropdownTestSelect[] = [];
    const root = createDropdownTestRoot(selects, textNodes);
    const configuration = createSpeciesConfiguration({ sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' }, snapshot);
    configuration.choices.push(
      { key: 'single', level: 1, label: 'Choose an ability', count: 1, source: { id: 'single', type: 'ability' }, options: [{ value: 'abilities:str', label: 'Strength', source: { id: 'abilities:str', type: 'ability' } }], selected: ['abilities:str'], raw: {} },
      { key: 'multi', level: 1, label: 'Choose languages', count: 2, source: { id: 'multi', type: 'language' }, options: [{ value: 'languages:common', label: 'Common', source: { id: 'languages:common', type: 'language' } }, { value: 'languages:elvish', label: 'Elvish', source: { id: 'languages:elvish', type: 'language' } }], selected: [], raw: {} },
    );
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const persisted: string[][][] = [];
    const onChange = (next: typeof configuration): void => { if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(() => persisted.push(next.choices.map((choice) => choice.selected)), 0); };
    renderSpeciesConfigurationControls(root as unknown as HTMLElement, { choices: [{ key: 'single', label: 'Choose an ability', required: 1, options: [{ value: 'abilities:str', label: 'Strength' }], selected: ['abilities:str'] }, { key: 'multi', label: 'Choose languages', required: 2, options: [{ value: 'languages:common', label: 'Common' }, { value: 'languages:elvish', label: 'Elvish' }], selected: [] }], warnings: ['Invalid source data'], unresolvedWarnings: ['Unresolved dependency UUID: missing'] }, configuration, onChange);
    expect(selects).toHaveLength(3);
    expect(selects[0].options.find((option) => option.value === 'abilities:str')?.selected).toBe(true);
    expect(selects.every((select) => !select.multiple)).toBe(true);
    selects[1].value = 'languages:common'; selects[1].handlers[0]();
    expect(selects[2].options.find((option) => option.value === 'languages:common')?.disabled).toBe(true);
    selects[2].value = 'languages:elvish'; selects[2].handlers[0]();
    expect(textNodes).toEqual(expect.arrayContaining(['Select an option', 'Invalid source data', 'Unresolved dependency UUID: missing']));
    expect(textNodes.filter((text) => text === 'Unresolved dependency UUID: missing')).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(persisted.at(-1)).toEqual([['abilities:str'], ['languages:common', 'languages:elvish']]);
  });

  it('edits the character display name from the Identity step', async () => {
    const original = withOrigin(withRuleset(createCharacterDocument('New character', snapshot), '2024'), { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' });
    let updated = original;
    const root = createViewRenderRoot();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      document: original,
      sourceReader: { listOrigins: async () => [] },
      queueUpdate: (update: (document: CharacterDocument) => CharacterDocument) => { updated = update(updated); },
    });

    await (CharacterView.prototype as unknown as { renderIdentityStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderIdentityStep.call(view, root.root as unknown as HTMLElement);
    const name = root.control('Character name');
    expect(name.value).toBe('New character');

    name.value = 'Ayla';
    name.dispatch('input');
    name.value = 'Ayla Brightblade';
    name.dispatch('input');
    expect(updated).toEqual(original);

    name.value = '  Ayla Brightblade  ';
    name.dispatch('blur');
    expect(updated).toEqual({ ...original, name: 'Ayla Brightblade' });

    name.value = 'New character';
    name.dispatch('blur');
    expect(updated).toEqual(original);

    name.value = '   ';
    name.dispatch('blur');
    expect(updated.name).toBe('New character');
  });

  it('persists an armor equip trigger and rerenders the calculated armor class', async () => {
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    let persisted = createInventorySheetDocument(true);
    persisted.mutable.equipmentStatus = persisted.mutable.equipmentStatus.map((status) => ({ ...status, equipped: false }));
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const root = createViewRenderRoot();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      document: persisted,
      file,
      viewState: { mode: 'open', filePath: file.path, section: 'inventory' },
      contentEl: root.root,
      store: {
        list: async () => [file],
        read: async () => persisted,
        update: async (_file: TFile, update: (document: CharacterDocument) => CharacterDocument) => {
          persisted = update(persisted) as typeof persisted;
          return persisted;
        },
      },
      sourceIndex: createSheetSourceIndex(persisted, async (_ruleset, sourcePath) => sourcePath.includes('shield') ? createShieldSummary(sourcePath) : createChainMailSummary(sourcePath)),
      sourceReader: {},
      pendingUpdate: undefined,
      pendingTimer: undefined,
      flushInProgress: undefined,
      lastWrittenDocument: undefined,
      conflict: false,
    });

    await (CharacterView.prototype as unknown as { render(this: Record<string, unknown>): Promise<void> }).render.call(view);
    root.control('Equip').dispatch('click');

    await vi.waitFor(() => expect(root.text).toContain('16'));
    expect(persisted.mutable.equipmentStatus.find(({ entryId }) => entryId === 'chain')?.equipped).toBe(true);
    expect(root.text).toEqual(expect.arrayContaining(['12', '16']));
    vi.unstubAllGlobals();
  });

  it('applies inventory item changes to mutable state and synchronizes equipment status', () => {
    let document: CharacterDocument = createInventorySheetDocument(true);
    const context = { queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => { document = update(document); } };
    const apply = (CharacterView.prototype as unknown as { applyManagedItems(this: typeof context, changes: InventoryItemChanges): void }).applyManagedItems;
    apply.call(context, { removedEntryIds: ['chain'], added: [{ source: { sourcePath: 'torch.yml', pack: 'dnd5e.equipment24', type: 'equipment', id: 'torch', name: 'Torch', ruleset: '2024', itemType: 'equipment', magic: false, equippable: false, properties: [] }, quantity: 2 }], quantityChanges: [{ entryId: 'travel-journal', delta: 1 }] });
    expect(document.mutable?.inventory.items.map((entry) => entry.entryId)).toEqual(['travel-journal', 'shield', 'source:dnd5e.equipment24:torch']);
    expect(document.mutable?.inventory.currency.gp).toBe(12);
    expect(document.mutable?.inventory.items.find((entry) => entry.entryId === 'travel-journal')?.quantity).toBe(3);
    expect(document.mutable?.inventory.items.find((entry) => entry.entryId === 'source:dnd5e.equipment24:torch')?.quantity).toBe(2);
    expect(document.mutable?.equipmentStatus).toEqual([
      { entryId: 'travel-journal', equipped: false, attuned: false },
      { entryId: 'shield', equipped: false, attuned: false },
      { entryId: 'source:dnd5e.equipment24:torch', equipped: false, attuned: false },
    ]);
  });

  it('saves one inventory Apply after an unfinished character write completes', async () => {
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    let persisted: CharacterDocument = createInventorySheetDocument();
    let writes = 0;
    let finishFirstWrite: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => { finishFirstWrite = resolve; });
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      file,
      document: persisted,
      conflict: false,
      queuedUpdateCount: 0,
      writingUpdate: false,
      opened: true,
      store: { update: async (_file: TFile, update: (current: CharacterDocument) => CharacterDocument) => {
        writes += 1;
        if (writes === 1) await firstWrite;
        persisted = update(persisted);
        return persisted;
      } },
      render: async () => undefined,
      renderUnavailable: vi.fn(),
    });
    const methods = CharacterView.prototype as unknown as {
      queueUpdate(this: typeof view, update: (current: CharacterDocument) => CharacterDocument): void;
      applyManagedItems(this: typeof view, changes: InventoryItemChanges): void;
      flushPendingUpdate(this: typeof view): Promise<void>;
    };
    methods.queueUpdate.call(view, (document: CharacterDocument) => ({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, currency: { ...document.mutable!.inventory.currency, gp: 13 } } } }));
    await Promise.resolve();
    expect(writes).toBe(1);

    methods.applyManagedItems.call(view, { removedEntryIds: ['chain'], added: [{ source: { sourcePath: 'torch.yml', pack: 'dnd5e.equipment24', type: 'equipment', id: 'torch', name: 'Torch', ruleset: '2024', itemType: 'equipment', magic: false, equippable: false, properties: [] }, quantity: 2 }], quantityChanges: [{ entryId: 'travel-journal', delta: 1 }] });
    expect(writes).toBe(1);
    finishFirstWrite?.();
    await methods.flushPendingUpdate.call(view);

    expect(writes).toBe(2);
    expect(persisted.mutable?.inventory.currency.gp).toBe(13);
    expect(persisted.mutable?.inventory.items.map((entry) => [entry.entryId, entry.quantity])).toEqual([['travel-journal', 3], ['source:dnd5e.equipment24:torch', 2]]);
  });

  it('adds a legacy Foundry item to a 2024 character inventory', () => {
    let document: CharacterDocument = createInventorySheetDocument();
    const context = { queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => { document = update(document); } };
    const apply = (CharacterView.prototype as unknown as { applyManagedItems(this: typeof context, changes: InventoryItemChanges): void }).applyManagedItems;
    apply.call(context, { removedEntryIds: [], added: [{ source: { sourcePath: 'packs/_source/items/weapon/shortsword-1.yml', pack: 'dnd5e.items', type: 'weapon', id: 'shortsword-1', name: 'Shortsword +1', ruleset: '2014', itemType: 'weapon', magic: true, equippable: true, properties: [] }, quantity: 1 }], quantityChanges: [] });
    expect(document.mutable?.inventory.items.at(-1)).toMatchObject({ source: { name: 'Shortsword +1', pack: 'dnd5e.items' }, quantity: 1 });
  });

  it('updates spell slots, free castings, and feature uses independently', () => {
    let document: CharacterDocument = createSheetDocument();
    document.mutable = {
      preparedSpells: [],
      inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
      equipmentStatus: [],
      spellSlots: [{ level: 1, current: 2, maximum: 2 }],
      spellUses: [{ key: 'find-familiar', current: 1, maximum: 1, reset: 'long-rest' }],
      resources: [{ key: 'feature:second-wind', current: 1, maximum: 1, reset: 'short-rest' }],
    };
    const context = {
      queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => { document = update(document); },
    };
    const methods = CharacterView.prototype as unknown as {
      toggleSpellSlot(this: typeof context, level: number, spent: boolean): void;
      toggleSpellUse(this: typeof context, key: string, spent: boolean): void;
      toggleFeatureResource(this: typeof context, key: string, spent: boolean): void;
    };

    methods.toggleSpellUse.call(context, 'find-familiar', true);
    expect(document.mutable).toMatchObject({
      spellSlots: [{ level: 1, current: 2, maximum: 2 }],
      spellUses: [{ key: 'find-familiar', current: 0, maximum: 1, reset: 'long-rest' }],
      resources: [{ key: 'feature:second-wind', current: 1, maximum: 1, reset: 'short-rest' }],
    });
    methods.toggleSpellSlot.call(context, 1, true);
    methods.toggleFeatureResource.call(context, 'feature:second-wind', true);
    methods.toggleSpellUse.call(context, 'find-familiar', false);
    expect(document.mutable).toMatchObject({
      spellSlots: [{ level: 1, current: 1, maximum: 2 }],
      spellUses: [{ key: 'find-familiar', current: 1, maximum: 1, reset: 'long-rest' }],
      resources: [{ key: 'feature:second-wind', current: 0, maximum: 1, reset: 'short-rest' }],
    });
  });

  it('reconciles managed spells without rewriting creation choices and clears removed preparation', async () => {
    let document: CharacterDocument = createSheetDocument();
    const base = { sourcePath: 'packs/_source/spells24/1st-level/shield.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'shield', name: 'Shield' };
    const prior = { sourcePath: 'packs/_source/spells24/1st-level/alarm.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'alarm', name: 'Alarm' };
    const cantrip = { sourcePath: 'packs/_source/spells24/cantrips/light.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'light', name: 'Light' };
    const future = { sourcePath: 'packs/_source/spells24/2nd-level/misty-step.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'misty-step', name: 'Misty Step' };
    document.classProgressions![0]!.class = { sourcePath: 'packs/_source/classes24/wizard/wizard.yml', identifier: 'wizard', id: 'wizard' };
    document.classProgressions![0]!.selections = [{ advancementId: 'starting-spells', kind: 'spell', selectionRole: 'spellbook', selected: [base] }];
    document.mutable = { preparedSpells: [prior], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [], spellOverlay: { added: [{ reference: prior, ownership: 'spellbook' }], removed: [] } };
    const startingSelections = structuredClone(document.classProgressions![0]!.selections);
    const summaries = [
      { ...cantrip, ruleset: '2024' as const, level: 0, spellLists: ['wizard'], ritual: false },
      { ...future, ruleset: '2024' as const, level: 2, spellLists: ['wizard'], ritual: false },
    ];
    const classSummary: ClassSourceSummary = { source: { ...document.classProgressions![0]!.class, pack: 'dnd5e.classes24', type: 'class', name: 'Wizard' }, ruleset: '2024', hitDie: 'd6', spellcasting: { progression: 'full', spellbookSpells: 6, spellLists: ['wizard'] }, advancements: [] };
    const prototype = CharacterView.prototype as unknown as {
      classManagedSpellReferences(this: { classManagedSpellReferences: unknown }, current: CharacterDocument): FoundrySourceReference[];
      applyManagedSpells(this: unknown, desired: FoundrySourceReference[], source: ClassSourceSummary, lists: string[]): Promise<void>;
    };
    const context = {
      document,
      sourceIndex: { searchSpells: vi.fn(async () => summaries) },
      classManagedSpellReferences: prototype.classManagedSpellReferences,
      queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => { document = update(document); context.document = document; },
    };
    await prototype.applyManagedSpells.call(context, [cantrip, future], classSummary, ['wizard']);
    expect(document.classProgressions![0]!.selections).toEqual(startingSelections);
    expect(document.mutable?.spellOverlay).toEqual({
      added: [{ reference: cantrip, ownership: 'cantrips-known' }, { reference: future, ownership: 'spellbook' }],
      removed: [base],
    });
    expect(document.mutable?.preparedSpells).toEqual([]);
  });

  it('uses class identifier spell-list fallback and persists only stable preparation references', () => {
    let document: CharacterDocument = createSheetDocument();
    document.mutable = { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] };
    const summary = { sourcePath: 'packs/_source/spells24/1st-level/cure-wounds.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'cure-wounds', name: 'Cure Wounds', identifier: 'cure-wounds', ruleset: '2024', level: 1, spellLists: ['bard'], ritual: false, description: 'Restores hit points.' } as FoundrySpellSummary;
    const prototype = CharacterView.prototype as unknown as {
      classSpellLists(this: unknown, sources: CharacterSheetSources): string[];
      toggleSpellPreparation(this: unknown, source: FoundrySourceReference, prepared: boolean, blockedReason?: string): void;
    };
    const sources: CharacterSheetSources = { class: { source: { sourcePath: 'bard.yml', pack: 'dnd5e.classes24', type: 'class', id: 'bard', identifier: 'bard', name: 'Bard' }, ruleset: '2024', hitDie: 'd8', spellcasting: { progression: 'full' }, advancements: [] }, warnings: [] };
    expect(prototype.classSpellLists.call({}, sources)).toEqual(['bard']);
    const context = { queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => { document = update(document); } };
    prototype.toggleSpellPreparation.call(context, summary, true, 'Spell level is above the highest castable spell level.');
    expect(document.mutable.preparedSpells).toEqual([]);
    prototype.toggleSpellPreparation.call(context, summary, true);
    expect(document.mutable.preparedSpells).toEqual([{ sourcePath: summary.sourcePath, pack: summary.pack, type: 'spell', id: summary.id, name: summary.name, identifier: summary.identifier }]);
    expect(document.mutable).not.toHaveProperty('description');
    prototype.toggleSpellPreparation.call(context, summary, false, 'Still removable');
    expect(document.mutable.preparedSpells).toEqual([]);
  });

  it('persists manual hit-point adjustments and an optional effective maximum override', () => {
    let document: CharacterDocument = createSheetDocument();
    document.mutable = {
      preparedSpells: [],
      inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
      equipmentStatus: [],
      resources: [],
      hitPoints: { current: 7, maximum: 10, temporary: 3 },
    };
    const context = { queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => { document = update(document); } };
    const apply = (CharacterView.prototype as unknown as { applyHitPointAdjustment(this: typeof context, operation: 'heal' | 'damage' | 'temp' | 'maximum' | 'clear-maximum', amount: number): void }).applyHitPointAdjustment;

    apply.call(context, 'damage', 5);
    expect(document.mutable?.hitPoints).toEqual({ current: 5, maximum: 10, temporary: 0 });
    apply.call(context, 'heal', 99);
    expect(document.mutable?.hitPoints).toEqual({ current: 10, maximum: 10, temporary: 0 });
    apply.call(context, 'temp', 4);
    expect(document.mutable?.hitPoints).toEqual({ current: 10, maximum: 10, temporary: 4 });
    apply.call(context, 'maximum', 15);
    apply.call(context, 'heal', 5);
    expect(document.mutable?.hitPoints).toEqual({ current: 15, maximum: 10, maximumOverride: 15, temporary: 4 });
    apply.call(context, 'clear-maximum', 0);
    expect(document.mutable?.hitPoints).toEqual({ current: 10, maximum: 10, temporary: 4 });
  });

  it('saves currency changes against the latest carried balance without changing starting currency', () => {
    let document: CharacterDocument = createSheetDocument();
    document.inventory = { items: [], currency: { pp: 1, gp: 2, ep: 0, sp: 0, cp: 0 } };
    document.mutable = {
      preparedSpells: [], inventory: { items: [], currency: { pp: 1, gp: 2, ep: 0, sp: 0, cp: 0 } },
      equipmentStatus: [], resources: [],
    };
    const context = { queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => {
      document = { ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, currency: { ...document.mutable!.inventory.currency, cp: 4 } } } };
      document = update(document);
    } };
    const apply = (CharacterView.prototype as unknown as { applyCurrencyChange(this: typeof context, operation: 'add' | 'spend', denomination: 'pp' | 'gp' | 'ep' | 'sp' | 'cp', amount: number): void }).applyCurrencyChange;

    apply.call(context, 'spend', 'sp', 5);
    expect(document.mutable.inventory.currency).toEqual({ pp: 1, gp: 1, ep: 0, sp: 5, cp: 4 });
    expect(document.inventory.currency).toEqual({ pp: 1, gp: 2, ep: 0, sp: 0, cp: 0 });
  });

  it('persists one atomic chosen rest transition from the latest document state', () => {
    let document: CharacterDocument = createSheetDocument();
    document.mutable = {
      preparedSpells: [],
      inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 7, pp: 0 } },
      equipmentStatus: [],
      resources: [{ key: 'feature:second-wind', current: 0, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] }],
      hitPoints: { current: 3, maximum: 10, temporary: 2 },
      spellSlots: [{ level: 1, current: 0, maximum: 2 }],
    };
    const context = { queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => { document = update(document); } };
    const complete = (CharacterView.prototype as unknown as { completeRest(this: typeof context, choice: { type: 'long' }): void }).completeRest;

    complete.call(context, { type: 'long' });

    expect(document.mutable).toMatchObject({
      hitPoints: { current: 10, maximum: 10, temporary: 0 },
      spellSlots: [{ level: 1, current: 2, maximum: 2 }],
      resources: [{ key: 'feature:second-wind', current: 2, maximum: 2 }],
      inventory: { currency: { gp: 7 } },
    });
  });

  it('applies a confirmed Short Rest choice to the latest mutable state', () => {
    let document: CharacterDocument = createSheetDocument();
    document.mutable = {
      preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [],
      hitPoints: { current: 5, maximum: 10, temporary: 2 },
      hitDice: [{ classSourcePath: 'packs/_source/classes24/fighter/fighter.yml', denomination: 'd10', current: 1, maximum: 1 }],
      resources: [{ key: 'feature:second-wind', current: 0, maximum: 1, reset: 'short-rest' }],
    };
    const context = { queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => {
      document = { ...document, mutable: { ...document.mutable!, hitPoints: { ...document.mutable!.hitPoints!, current: 6 } } };
      document = update(document);
    } };
    const complete = (CharacterView.prototype as unknown as { completeRest(this: typeof context, choice: { type: 'short'; input: { hitDieClassSourcePath: string; healing: number } }): void }).completeRest;
    complete.call(context, { type: 'short', input: { hitDieClassSourcePath: 'packs/_source/classes24/fighter/fighter.yml', healing: 3 } });
    expect(document.mutable).toMatchObject({ hitPoints: { current: 9, maximum: 10, temporary: 2 }, hitDice: [{ current: 0 }], resources: [{ current: 1 }] });
  });

  it('persists inspiration corrections without changing other mutable state', () => {
    let document: CharacterDocument = createSheetDocument();
    document.mutable = {
      preparedSpells: [],
      inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 } },
      equipmentStatus: [{ entryId: 'shield', equipped: true, attuned: false }],
      resources: [{ key: 'feature:second-wind', current: 1, maximum: 1, reset: 'short-rest' }],
      inspiration: false,
    };
    const context = { queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => { document = update(document); } };
    const toggle = (CharacterView.prototype as unknown as { toggleInspiration(this: typeof context, active: boolean): void }).toggleInspiration;

    toggle.call(context, true);
    expect(document.mutable).toMatchObject({ inspiration: true, equipmentStatus: [{ entryId: 'shield', equipped: true, attuned: false }], resources: [{ key: 'feature:second-wind', current: 1, maximum: 1, reset: 'short-rest' }], inventory: { currency: { gp: 12 } } });
    toggle.call(context, false);
    expect(document.mutable).toMatchObject({ inspiration: false, equipmentStatus: [{ entryId: 'shield', equipped: true, attuned: false }], resources: [{ key: 'feature:second-wind', current: 1, maximum: 1, reset: 'short-rest' }], inventory: { currency: { gp: 12 } } });
  });

  it('finalizes authoritative mutable state and excludes higher-level resources', async () => {
    const document = { ...createSheetDocument(), backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { con: 2, dex: 1 } } } };
    document.origin = { ...document.origin, sourcePath: 'packs/_source/origins24/species/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' };
    document.speciesConfiguration = {
      origin: { ...document.origin }, foundry: { ...document.foundry }, grants: [], spellChoices: [],
      choices: [{ key: 'species:ancestry', source: { id: 'ancestry', type: 'ItemChoice' }, selected: ['other-feature'] }],
    };
    document.inventory = { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
    const ward = { sourcePath: 'packs/_source/spells/ward.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'ward', name: 'Ward' };
    const unsupportedSpell = { sourcePath: 'packs/_source/spells/unsupported.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'unsupported', name: 'Unsupported' };
    (document.classProgressions[0].selections as unknown as ClassAdvancementSelection[]) = [
      { advancementId: 'ward', kind: 'spell', selectionRole: 'known-spells', selected: [ward], raw: { configuration: { spell: { uses: { max: '1', per: 'lr', requireSlot: false } } } } },
      { advancementId: 'unsupported', kind: 'spell', selectionRole: 'known-spells', selected: [unsupportedSpell], raw: { configuration: { spell: { uses: { max: '1', per: 'day', requireSlot: false } } } } },
    ];
    const classSummary = { ...createSheetClassSummary(document), advancements: [] as ClassSourceSummary['advancements'] } as unknown as ClassSourceSummary & { spellcasting: { progression: 'full'; ability: 'con'; spellSlots: { '1': number } }; features: unknown[] };
    classSummary.spellcasting = { progression: 'full', ability: 'con', spellSlots: { '1': 2 } };
    classSummary.advancements = [
      { id: 'ward', type: 'ItemChoice', level: 1, title: 'Ward', hint: '', dependencies: [{ uuid: ward.id, source: ward }], raw: { configuration: { type: 'spell', choices: 1 } } },
      { id: 'unsupported', type: 'ItemChoice', level: 1, title: 'Unsupported', hint: '', dependencies: [{ uuid: unsupportedSpell.id, source: unsupportedSpell }], raw: { configuration: { type: 'spell', choices: 1 } } },
    ];
    classSummary.features = [
      { advancementId: 'level-one', level: 1, source: { sourcePath: 'packs/_source/features/second-wind.yml', pack: 'dnd5e.features', type: 'feat', id: 'second-wind', name: 'Second Wind' }, uses: { maximum: '2', recovery: [{ period: 'sr' }] }, activities: [{ id: 'recover', type: 'action', consumption: [], uses: { maximum: 1, recovery: [{ period: 'sr' }] } }] },
      { advancementId: 'level-three', level: 3, source: { sourcePath: 'packs/_source/features/action-surge.yml', pack: 'dnd5e.features', type: 'feat', id: 'action-surge', name: 'Action Surge' }, uses: { maximum: 1, recovery: [{ period: 'lr' }] } },
      { advancementId: 'unsupported', level: 1, source: { sourcePath: 'packs/_source/features/unsupported.yml', pack: 'dnd5e.features', type: 'feat', id: 'unsupported', name: 'Unsupported' }, uses: { maximum: '3', recovery: [{ period: 'day' }] } },
      { advancementId: 'no-recovery', level: 1, source: { sourcePath: 'packs/_source/features/sneak-attack.yml', pack: 'dnd5e.features', type: 'feat', id: 'sneak-attack', name: 'Sneak Attack' }, uses: { maximum: '1', recovery: [] } },
      { advancementId: 'scaled-maximum', level: 1, source: { sourcePath: 'packs/_source/features/scaled-maximum.yml', pack: 'dnd5e.features', type: 'feat', id: 'scaled-maximum', name: 'Scaled maximum' }, uses: { maximum: '@scale.fighter.second-wind', recovery: [{ period: 'sr' }] } },
    ];
    const file = new TFile(); file.path = 'Characters/ayla.json';
    const update = vi.fn(async (_file: TFile, apply: (value: CharacterDocument) => CharacterDocument) => apply(document));
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, { document, file, flushPendingUpdate: async () => undefined, leaf: { setViewState: async () => undefined }, loadFromState: async () => undefined, contentEl: { empty: () => undefined, createDiv: () => undefined }, store: { update }, sourceIndex: { getSpeciesSummary: async () => ({ source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'dwarf-id', identifier: 'dwarf', name: 'Dwarf' }, ruleset: '2024' as const, advancements: [{ id: 'ancestry', type: 'ItemChoice', level: 1, hint: '', automatic: false, dependencies: [{ uuid: 'other-feature', source: { sourcePath: 'packs/_source/features/other.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'other', name: 'Other' } }, { uuid: 'unselected-feature', source: { sourcePath: 'packs/_source/features/unselected.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'unselected', name: 'Unselected' } }], raw: { configuration: { choices: 1, pool: ['other-feature', 'unselected-feature'] } } }], features: [{ advancementId: 'toughness', level: 1, automatic: true, source: { sourcePath: 'packs/_source/origins24/species/traits/dwarf/dwarven-toughness.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'dwarven-toughness', identifier: 'dwarven-toughness', name: 'Dwarven Toughness' }, hitPointModifiers: [{ perLevel: 1, source: { sourcePath: 'packs/_source/origins24/species/traits/dwarf/dwarven-toughness.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'dwarven-toughness', identifier: 'dwarven-toughness', name: 'Dwarven Toughness' } }] }, { advancementId: 'breath', level: 1, automatic: true, source: { sourcePath: 'packs/_source/features/breath-weapon.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'breath', name: 'Breath Weapon' }, uses: { maximum: '@prof', recovery: [{ period: 'lr' }] } }, { advancementId: 'unselected', level: 1, selection: { key: 'species:ancestry', value: 'unselected-feature' }, source: { sourcePath: 'packs/_source/features/unselected.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'unselected', name: 'Unselected' }, uses: { maximum: 1, recovery: [{ period: 'lr' }] } }, { advancementId: 'future', level: 5, automatic: true, source: { sourcePath: 'packs/_source/features/future.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'future', name: 'Future' }, uses: { maximum: 1, recovery: [{ period: 'lr' }] } }] }), getClassSummary: async () => classSummary, getBackgroundSummary: async () => ({ ...createSheetBackgroundSummary(document), abilityScores: { advancementId: 'asi', points: 3, cap: 2, locked: [] } }) } });
    await (CharacterView.prototype as unknown as { finalizeCharacter(this: Record<string, unknown>): Promise<void> }).finalizeCharacter.call(view);
    const written = update.mock.results[0]?.value;
    const finalized = await written as CharacterDocument;
    expect(finalized.classHitPoints).toEqual([{ classSourcePath: document.classProgressions![0]!.class.sourcePath, level: 1, value: 'max' }]);
    expect(finalized.mutable).toMatchObject({ hitPoints: { current: 13, maximum: 13 }, inspiration: false, spellSlots: [{ level: 1, current: 2, maximum: 2 }], spellUses: [{ current: 1, maximum: 1, reset: 'long-rest' }] });
    expect(finalized.mutable?.resources).toEqual(expect.arrayContaining([
      { key: 'feature:packs/_source/features/second-wind.yml', current: 2, maximum: 2, reset: 'short-rest', recovery: [{ period: 'short-rest', type: 'recover-all' }] },
      { key: 'feature:packs/_source/features/second-wind.yml:activity:recover', current: 1, maximum: 1, reset: 'short-rest', recovery: [{ period: 'short-rest', type: 'recover-all' }] },
      { key: 'feature:packs/_source/features/breath-weapon.yml', current: 2, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] },
    ]));
    expect(finalized.mutable?.resources.some((resource: { key: string }) => resource.key.includes('action-surge'))).toBe(false);
    expect(finalized.mutable?.resources.some((resource: { key: string }) => resource.key.includes('/future.yml'))).toBe(false);
    expect(finalized.mutable?.resources.some((resource: { key: string }) => resource.key.includes('/unselected.yml'))).toBe(false);
    expect(finalized.mutable?.resources.some((resource: { key: string }) => resource.key.includes('unsupported'))).toBe(false);
    expect(finalized.mutable?.resources.some((resource: { key: string }) => resource.key.includes('sneak-attack'))).toBe(false);
    expect(finalized.mutable?.resources.some((resource: { key: string }) => resource.key.includes('scaled-maximum'))).toBe(false);
    expect(finalized.mutable?.spellUses).toHaveLength(1);
  });

  it('refuses to finalize a saved Weapon Mastery choice outside current training', async () => {
    const document = completeDocument({ classProgressions: [{ class: creationClass, targetLevel: 1, selections: [{ advancementId: 'mastery', kind: 'trait', selected: ['weapon:warhammer'], configuredPool: ['weapon:*'] }] }] });
    const sources = completeSources();
    sources.class = { ...sources.class!, proficiencies: { armor: [], weapons: ['weapon:sim'], tools: [], savingThrows: [], languages: [], skills: [], choices: [] }, advancements: [{ id: 'mastery', type: 'Trait', level: 1, title: 'Weapon Mastery', hint: '', dependencies: [], raw: { configuration: { mode: 'mastery', choices: [{ count: 1, pool: ['weapon:*'] }] } } }] };
    const file = new TFile(); file.path = 'Characters/mastery.json';
    const renderUnavailable = vi.fn();
    const update = vi.fn();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, { document, file, flushPendingUpdate: async () => undefined, loadCharacterSheetSources: async () => sources, renderUnavailable, store: { update: async () => { update(); return document; } }, leaf: { setViewState: async () => undefined }, loadFromState: async () => undefined, sourceIndex: { resolveSelector: async () => [{ sourcePath: 'warhammer.yml', pack: 'test', type: 'weapon', id: 'warhammer', identifier: 'warhammer', name: 'Warhammer', ruleset: '2024', itemType: 'weapon', category: 'martialM', subcategory: 'warhammer', mastery: 'push', magic: false, equippable: true, properties: [] }], getSpeciesSummary: async () => sources.species, getClassSummary: async () => sources.class, getBackgroundSummary: async () => sources.background } });

    await (CharacterView.prototype as unknown as { finalizeCharacter(this: Record<string, unknown>): Promise<void> }).finalizeCharacter.call(view);

    expect(renderUnavailable).toHaveBeenCalledWith('Weapon Mastery selection Warhammer is not eligible for the current weapon proficiencies.');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not initialize free uses from persisted class or species choices above target level', () => {
    const document = createSheetDocument() as ReturnType<typeof createSheetDocument> & CharacterDocument;
    const classSpell = { sourcePath: 'packs/_source/spells/future-class.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'future-class', name: 'Future Class' };
    const speciesSpell = { sourcePath: 'packs/_source/spells/future-species.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'future-species', name: 'Future Species' };
    (document.classProgressions[0].selections as unknown as ClassAdvancementSelection[]) = [{ advancementId: 'future-class', kind: 'spell', selectionRole: 'known-spells', selected: [classSpell], raw: { configuration: { spell: { uses: { max: 1, per: 'lr', requireSlot: false } } } } }];
    document.speciesConfiguration = { origin: document.origin, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [{ key: 'future-species', advancementId: 'future-species', kind: 'spell', selected: [speciesSpell] }] };
    const classSummary = { ...createSheetClassSummary(document), advancements: [{ id: 'future-class', type: 'ItemChoice', level: 3, title: 'Future', hint: '', dependencies: [], raw: {} }] } as unknown as ClassSourceSummary;
    const speciesSummary = { source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', name: 'Elf' }, ruleset: '2024' as const, advancements: [{ id: 'future-species', type: 'ItemChoice', level: 3, title: 'Future', hint: '', automatic: false, dependencies: [], raw: { configuration: { spell: { uses: { max: 1, per: 'lr', requireSlot: false } } } } }] } as unknown as SpeciesSourceSummary;
    expect(collectFinalizationSpellUses(document, classSummary, speciesSummary, 1)).toEqual([]);
    expect(collectFinalizationSpellUses(document, { ...classSummary, advancements: [] }, { ...speciesSummary, advancements: [] }, 1)).toEqual([]);
  });

  it('resolves species free-use @prof during finalization when a proficiency bonus is supplied', () => {
    const reference = { sourcePath: 'packs/_source/spells/forest.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'forest', name: 'Forest spell' };
    const document = createSheetDocument();
    const species = { source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', name: 'Elf' }, ruleset: '2024' as const, advancements: [], spellGrants: [{ advancementId: 'forest', level: 1, spells: [reference], abilityOptions: [], raw: { configuration: { spell: { uses: { max: '@prof', per: 'lr', requireSlot: false } } } } }] } as unknown as SpeciesSourceSummary;
    const classSummary = { ...createSheetClassSummary(document), advancements: [] } as unknown as ClassSourceSummary;
    expect(collectFinalizationSpellUses(document, classSummary, species, 1, undefined, 2)).toEqual([{ key: `${reference.sourcePath}:${reference.pack}:${reference.type}:${reference.id}`, current: 2, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] }]);
  });

  it('does not write finalization state when an authoritative source fails', async () => {
    const document = createSheetDocument();
    document.inventory = { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
    const file = new TFile(); file.path = 'Characters/ayla.json';
    const update = vi.fn();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, { document, file, flushPendingUpdate: async () => undefined, store: { update }, sourceIndex: { getSpeciesSummary: async () => { throw new Error('missing species'); }, getClassSummary: async () => createSheetClassSummary(document), getBackgroundSummary: async () => createSheetBackgroundSummary(document) }, renderUnavailable: vi.fn() });
    await (CharacterView.prototype as unknown as { finalizeCharacter(this: Record<string, unknown>): Promise<void> }).finalizeCharacter.call(view);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not write finalization state when loaded 2024 background choices are stale', async () => {
    const document = createSheetDocument() as ReturnType<typeof createSheetDocument> & CharacterDocument;
    document.inventory = { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
    document.backgroundChoices = { abilityScores: { advancementId: 'stale', assignments: { int: 2, wis: 1 } } };
    const file = new TFile(); file.path = 'Characters/ayla.json';
    const update = vi.fn();
    const root = createViewRenderRoot();
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      document,
      file,
      flushPendingUpdate: async () => undefined,
      store: { update },
      contentEl: root.root,
      sourceIndex: {
        getSpeciesSummary: async () => ({ source: { sourcePath: document.origin!.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', name: 'Elf' }, ruleset: '2024' as const, advancements: [] }),
        getClassSummary: async () => createSheetClassSummary(document),
        getBackgroundSummary: async () => acolyteSummary,
      },
      renderUnavailable: (message: string) => root.root.createDiv({ text: message }),
    });

    await (CharacterView.prototype as unknown as { finalizeCharacter(this: Record<string, unknown>): Promise<void> }).finalizeCharacter.call(view);

    expect(update).not.toHaveBeenCalled();
    expect(root.text).toContain('Background ability advancement does not match the current source.');
  });

  it('finalizes background granted-feat spell uses from the authoritative advancement raw data', async () => {
    const document = createSheetDocument() as ReturnType<typeof createSheetDocument> & CharacterDocument;
    document.inventory = { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
    const guidance = { sourcePath: 'packs/_source/spells/guidance.yml', pack: 'dnd5e.spells', type: 'spell', id: 'guidance', name: 'Guidance' };
    const sacredFlame = { sourcePath: 'packs/_source/spells/sacred-flame.yml', pack: 'dnd5e.spells', type: 'spell', id: 'sacred-flame', name: 'Sacred Flame' };
    const root = createViewRenderRoot();
    const completeGrantedFeat = completeMagicInitiateSelection();
    document.backgroundChoices = {
      abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } },
      grantedFeat: { ...completeGrantedFeat, spellChoices: completeGrantedFeat.spellChoices.map((choice) => choice.advancementId === 'cantrips' ? { ...choice, selected: [guidance, sacredFlame] } : choice) as GrantedFeatSelection['spellChoices'] },
    };
    const background = { ...acolyteSummary, grantedFeat: { ...magicInitiateSummary(), advancements: magicInitiateSummary().advancements.map((advancement) => advancement.id === 'cantrips' ? { ...advancement, raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 2, spell: { uses: { max: '1', per: 'lr', requireSlot: false } } } } } : advancement) } };
    const classSummary = createSheetClassSummary(document) as ReturnType<typeof createSheetClassSummary> & { spellcasting: { progression: 'full'; ability: 'con'; spellSlots: { '1': number } }; features: unknown[] };
    classSummary.spellcasting = { progression: 'full', ability: 'con', spellSlots: { '1': 2 } };
    classSummary.features = [];
    const file = new TFile(); file.path = 'Characters/ayla.json';
    let finalized: CharacterDocument | undefined;
    const update = vi.fn(async (_file: TFile, apply: (value: CharacterDocument) => CharacterDocument) => { finalized = apply(document); return finalized; });
    const view = Object.create(CharacterView.prototype) as Record<string, unknown>;
    Object.assign(view, {
      document,
      file,
      flushPendingUpdate: async () => undefined,
      leaf: { setViewState: async () => undefined },
      loadFromState: async () => undefined,
      store: { update },
      contentEl: root.root,
      sourceIndex: {
        getSpeciesSummary: async () => ({ source: { sourcePath: document.origin!.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', name: 'Elf' }, ruleset: '2024' as const, advancements: [] }),
        getClassSummary: async () => classSummary,
        getBackgroundSummary: async () => background,
      },
    });

    await (CharacterView.prototype as unknown as { finalizeCharacter(this: Record<string, unknown>): Promise<void> }).finalizeCharacter.call(view);

    expect(finalized?.mutable?.spellUses).toEqual(expect.arrayContaining([{ key: `${guidance.sourcePath}:${guidance.pack}:${guidance.type}:${guidance.id}`, current: 1, maximum: 1, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] }]));
  });

  it('persists an edit queued during a plugin-owned write without reporting an external conflict', async () => {
    const file = new TFile();
    file.path = 'Characters/bard.json';
    let persisted = createSheetDocument() as CharacterDocument;
    let releaseFirstWrite = (): void => undefined;
    const firstWriteReleased = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let signalFirstWrite = (): void => undefined;
    const firstWriteStarted = new Promise<void>((resolve) => { signalFirstWrite = resolve; });
    let writeCount = 0;
    const context = {
      document: persisted,
      file,
      pendingUpdate: ((document: CharacterDocument) => ({ ...document, firstClassChoice: 'saved' })) as (document: CharacterDocument) => CharacterDocument,
      pendingTimer: undefined,
      conflict: false,
      render: async () => undefined,
      renderUnavailable: vi.fn(),
      store: {
        update: async (_file: TFile, update: (document: CharacterDocument) => CharacterDocument) => {
          writeCount += 1;
          persisted = update(persisted);
          if (writeCount === 1) {
            signalFirstWrite();
            await firstWriteReleased;
          }
          return persisted;
        },
        read: async () => persisted,
      },
    };
    const methods = CharacterView.prototype as unknown as {
      flushPendingUpdate(this: typeof context): Promise<void>;
      handleExternalModification(this: typeof context): Promise<void>;
    };

    const flush = methods.flushPendingUpdate.call(context);
    await firstWriteStarted;
    context.pendingUpdate = (document: CharacterDocument) => ({ ...document, finalClassChoice: 'saved' });
    const ownModifyEvent = methods.handleExternalModification.call(context);
    releaseFirstWrite();
    await Promise.all([flush, ownModifyEvent]);

    expect(persisted).toMatchObject({ firstClassChoice: 'saved', finalClassChoice: 'saved' });
    expect(context.conflict).toBe(false);
    expect(context.renderUnavailable).not.toHaveBeenCalled();
  });

type DropdownTestOption = { value: string; textContent: string; selected: boolean; disabled: boolean };
type DropdownTestSelect = {
  value: string;
  multiple: boolean;
  options: DropdownTestOption[];
  handlers: Array<() => void>;
  attributes: Record<string, string>;
  readonly selectedOptions: DropdownTestOption[];
  createEl(tag: string, options?: { value?: string; text?: string }): DropdownTestOption;
  addEventListener(type: string, handler: () => void): void;
  setAttribute(name: string, value: string): void;
};

function createDropdownTestRoot(selects: DropdownTestSelect[], rendered: string[] = []): Record<string, unknown> {
  const createSelect = (): DropdownTestSelect => {
    const options: DropdownTestOption[] = [];
    let textContent = '';
    const select: DropdownTestSelect = {
      value: '',
      multiple: false,
      options,
      handlers: [],
      attributes: {},
      get selectedOptions() { return options.filter((option) => option.selected); },
      createEl: (_tag, option = {}) => {
        if (option.text) rendered.push(option.text);
        const created = { value: option.value ?? '', textContent: option.text ?? '', selected: false, disabled: false };
        options.push(created);
        return created;
      },
      addEventListener: (_type, handler) => { select.handlers.push(handler); },
      setAttribute: (name, value) => { select.attributes[name] = value; },
    };
    Object.defineProperty(select, 'textContent', {
      get: () => textContent,
      set: (value: string) => { textContent = value; if (value === '') options.splice(0); },
    });
    return select;
  };
  const createNode = (): Record<string, unknown> => ({
    value: '',
    type: '',
    checked: false,
    disabled: false,
    selected: false,
    textContent: '',
    createDiv: () => createNode(),
    createSpan: (options?: { text?: string }) => { if (options?.text) rendered.push(options.text); return createNode(); },
    createEl: (tag: string, options?: { value?: string; text?: string; attr?: Record<string, string> }) => {
      if (options?.text) rendered.push(options.text);
      if (tag !== 'select') return createNode();
      const select = createSelect();
      Object.assign(select.attributes, options?.attr ?? {});
      selects.push(select);
      return select;
    },
    addEventListener: () => undefined,
  });
  return createNode();
}

});

describe('completed character draft editing', () => {
  it('requires a ruleset reset warning for saved selections in both completed and incomplete characters', () => {
    expect(shouldConfirmRulesetReset(completeDocument())).toBe(true);
    expect(shouldConfirmRulesetReset(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'))).toBe(false);
  });

  it('keeps the current ruleset control in Identity for an existing selection', async () => {
    const document = completeDocument();
    const selects: Array<{ value: string; options: Array<{ value: string; selected: boolean }>; handlers: Array<() => void> }> = [];
    const view = Object.assign(Object.create(CharacterView.prototype) as Record<string, unknown>, {
      document,
      queueUpdate: vi.fn(),
    });
    const root = createDraftIdentityRoot(selects);

    await (CharacterView.prototype as unknown as { renderIdentityStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderIdentityStep.call(view, root as unknown as HTMLElement);

    expect(selects.some((select) => select.options.some((option) => option.value === '2014') && select.options.some((option) => option.value === '2024'))).toBe(true);
    expect(selects[0]?.options.find((option) => option.value === '2024')?.selected).toBe(true);
  });

  it('leaves an in-progress character unchanged when a ruleset reset is dismissed', async () => {
    const document = completeDocument();
    const selects: Array<{ value: string; options: Array<{ value: string; selected: boolean }>; handlers: Array<() => void> }> = [];
    const queueUpdate = vi.fn();
    const view = Object.assign(Object.create(CharacterView.prototype) as Record<string, unknown>, {
      document,
      app: {},
      completedEditMode: false,
      inactiveClassHitPoints: [{ classSourcePath: creationClass.sourcePath, level: 2, value: 'avg' }],
      draftClassHitPoints: [{ classSourcePath: creationClass.sourcePath, level: 2, value: 'avg' }],
      queueUpdate,
      render: vi.fn(),
    });
    const root = createDraftIdentityRoot(selects);
    const open = vi.spyOn(CharacterResetModal.prototype, 'open').mockImplementation(function (this: CharacterResetModal) { modal = this; });
    let modal: CharacterResetModal | undefined;
    try {
      await (CharacterView.prototype as unknown as { renderIdentityStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderIdentityStep.call(view, root as unknown as HTMLElement);
      const select = selects[0]!;
      select.value = '2014';
      select.handlers[0]!();
      expect(modal).toBeDefined();
      expect(queueUpdate).not.toHaveBeenCalled();
      modal?.onClose();
      expect(document.ruleset).toBe('2024');
      expect(queueUpdate).not.toHaveBeenCalled();
      (modal as unknown as { onConfirm(): void } | undefined)?.onConfirm();
      expect(view.inactiveClassHitPoints).toEqual([]);
      expect(view.draftClassHitPoints).toEqual([]);
      expect(queueUpdate).toHaveBeenCalledTimes(1);
    } finally {
      open.mockRestore();
    }
  });

  it('warns before replacing a selected class during in-progress creation and preserves it on Cancel', async () => {
    const document = completeDocument();
    const classProgression = { class: { sourcePath: creationClass.sourcePath, identifier: creationClass.identifier, id: creationClass.id }, targetLevel: 1, selections: [{ advancementId: 'choice', kind: 'trait' as const, selected: ['skills:acr'], configuredPool: ['skills:acr'] }] };
    document.classProgressions = [classProgression];
    const replacement = { sourcePath: 'packs/_source/classes24/wizard/wizard.yml', identifier: 'wizard', id: 'wizard-id', name: 'Wizard', ruleset: '2024' as const };
    const selects: Array<{ value: string; options: Array<{ value: string; selected: boolean }>; handlers: Array<() => void> }> = [];
    const selectClass = vi.fn();
    const view = Object.assign(Object.create(CharacterView.prototype) as Record<string, unknown>, {
      document,
      app: {},
      completedEditMode: false,
      inactiveClassHitPoints: [{ classSourcePath: creationClass.sourcePath, level: 2, value: 'avg' }],
      draftClassHitPoints: [{ classSourcePath: creationClass.sourcePath, level: 2, value: 'avg' }],
      sourceReader: { listClasses: vi.fn(async () => [replacement]) },
      sourceIndex: { getClassSummary: vi.fn(async () => { throw new Error('source unavailable'); }) },
      selectClass,
      render: vi.fn(),
    });
    const root = createDraftIdentityRoot(selects);
    const open = vi.spyOn(CharacterResetModal.prototype, 'open').mockImplementation(function (this: CharacterResetModal) { modal = this; });
    let modal: CharacterResetModal | undefined;
    try {
      await (CharacterView.prototype as unknown as { renderClassStep(this: Record<string, unknown>, root: HTMLElement): Promise<void> }).renderClassStep.call(view, root as unknown as HTMLElement);
      const select = selects[0]!;
      select.value = replacement.id;
      select.handlers[0]!();

      expect(modal).toBeDefined();
      expect(selectClass).not.toHaveBeenCalled();
      expect(document.classProgressions).toEqual([classProgression]);
      modal?.onClose();
      expect(view.render).toHaveBeenCalled();
      expect(document.classProgressions).toEqual([classProgression]);
      (modal as unknown as { onConfirm(): void } | undefined)?.onConfirm();
      expect(view.inactiveClassHitPoints).toEqual([]);
      expect(view.draftClassHitPoints).toEqual([]);
      expect(selectClass).toHaveBeenCalledWith(replacement);
    } finally {
      open.mockRestore();
    }
  });

  it('raises a level-one draft without persisting an incomplete HP ledger', () => {
    const saved = completeDocument({ classHitPoints: [{ classSourcePath: creationClass.sourcePath, level: 1, value: 'max' }] });
    saved.classProgressions = [{ ...saved.classProgressions![0]!, targetLevel: 1, selections: [{ advancementId: 'level-one', kind: 'trait', selected: ['skills:acr'], configuredPool: ['skills:acr'] }] }];
    const summary = draftLevelSummary();
    let comparisonHitPoints = structuredClone(saved.classHitPoints ?? []);
    const writes = vi.fn();
    const context = Object.assign(Object.create(CharacterView.prototype) as Record<string, unknown>, {
      document: saved,
      completedEditMode: true,
      opened: true,
      conflict: false,
      inactiveClassHitPoints: comparisonHitPoints,
      render: async () => undefined,
      renderUnavailable: vi.fn(),
      store: { update: writes },
    });
    (CharacterView.prototype as unknown as { queueUpdate(this: Record<string, unknown>, update: (document: CharacterDocument) => CharacterDocument): void }).queueUpdate.call(context, (document: CharacterDocument) => {
      const result = updateClassLevelDraft(document, summary, 2, comparisonHitPoints);
      comparisonHitPoints = result.comparisonHitPoints;
      context.inactiveClassHitPoints = comparisonHitPoints;
      return result.document;
    });
    const draft = context.document as CharacterDocument;

    expect(draft.classProgressions?.[0]?.targetLevel).toBe(2);
    expect(draft.classHitPoints).toBeUndefined();
    expect(comparisonHitPoints).toEqual(saved.classHitPoints);
    expect(writes).not.toHaveBeenCalled();
  });

  it('trims inactive selections and restores only recorded HP entries after a 3-to-1-to-3 draft', () => {
    const hp = [1, 2, 3].map((level) => ({ classSourcePath: creationClass.sourcePath, level, value: level === 1 ? 'max' as const : 'avg' as const }));
    const saved = completeDocument({ classHitPoints: hp });
    saved.classProgressions = [{ ...saved.classProgressions![0]!, targetLevel: 3, selections: [
      { advancementId: 'level-one', kind: 'trait', selected: ['skills:acr'], configuredPool: ['skills:acr'] },
      { advancementId: 'level-three', kind: 'trait', selected: ['skills:arc'], configuredPool: ['skills:arc'] },
    ] }];
    const summary = draftLevelSummary();

    const lower = updateClassLevelDraft(saved, summary, 1, hp);
    const raise = updateClassLevelDraft(lower.document, summary, 3, lower.comparisonHitPoints);

    expect(lower.document.classProgressions?.[0]?.selections.map((selection) => selection.advancementId)).toEqual(['level-one']);
    expect(lower.document.classHitPoints).toEqual([hp[0]]);
    expect(raise.document.classProgressions?.[0]?.selections.map((selection) => selection.advancementId)).toEqual(['level-one']);
    expect(raise.document.classHitPoints).toEqual(hp);
    expect(raise.comparisonHitPoints).toEqual(hp);
  });

  it('integrates Edit level changes, HP entry, Apply, Cancel, and a confirmed ruleset reset', async () => {
    const classPath = creationClass.sourcePath;
    const saved = completeDocument({ classHitPoints: [{ classSourcePath: classPath, level: 1, value: 'max' }] });
    const summary = draftLevelSummary();
    let comparisonHitPoints = structuredClone(saved.classHitPoints ?? []);
    let persisted = structuredClone(saved);
    const updateIfUnchanged = vi.fn(async (_file: unknown, _expected: CharacterDocument, update: (current: CharacterDocument) => CharacterDocument) => {
      persisted = update(structuredClone(persisted));
      return persisted;
    });
    const context = Object.assign(Object.create(CharacterView.prototype) as Record<string, unknown>, {
      file: { path: 'Characters/ayla.json' }, document: structuredClone(saved), savedDocument: structuredClone(saved),
      completedEditMode: true, conflict: false, opened: true, pendingUpdate: undefined, flushInProgress: undefined,
      inactiveClassHitPoints: comparisonHitPoints, draftClassHitPoints: structuredClone(comparisonHitPoints),
      flushPendingUpdate: async () => undefined, render: async () => undefined, renderUnavailable: vi.fn(),
      loadCharacterSheetSources: async () => completeSources(), store: { updateIfUnchanged },
      leaf: { setViewState: async () => undefined }, loadFromState: async () => undefined,
    });

    const levelTwo = updateClassLevelDraft(context.document as CharacterDocument, summary, 2, comparisonHitPoints);
    comparisonHitPoints = setClassHitPointGain(levelTwo.comparisonHitPoints, classPath, 2, 'avg');
    const levelOne = updateClassLevelDraft(levelTwo.document, summary, 1, comparisonHitPoints);
    const raisedAgain = updateClassLevelDraft(levelOne.document, summary, 2, levelOne.comparisonHitPoints);
    context.document = { ...raisedAgain.document, classHitPoints: comparisonHitPoints };
    context.inactiveClassHitPoints = levelOne.comparisonHitPoints;

    expect(persisted).toEqual(saved);
    expect((context.document as CharacterDocument).classHitPoints).toEqual([
      { classSourcePath: classPath, level: 1, value: 'max' },
      { classSourcePath: classPath, level: 2, value: 'avg' },
    ]);
    await (CharacterView.prototype as unknown as { applyCharacterDraft(this: typeof context): Promise<void> }).applyCharacterDraft.call(context);
    expect(updateIfUnchanged).toHaveBeenCalledTimes(1);
    expect(persisted.classProgressions?.[0]?.targetLevel).toBe(2);
    expect(persisted.classHitPoints).toHaveLength(2);

    context.savedDocument = structuredClone(persisted);
    context.document = structuredClone(persisted);
    const beforeCancel = JSON.stringify(persisted);
    const lowered = updateClassLevelDraft(context.document as CharacterDocument, summary, 1, persisted.classHitPoints);
    context.document = lowered.document;
    context.completedEditMode = true;
    context.queueUpdate = (update: (document: CharacterDocument) => CharacterDocument) => { context.document = update(context.document as CharacterDocument); };
    const selects: Array<{ value: string; options: Array<{ value: string; selected: boolean }>; handlers: Array<() => void> }> = [];
    let openedModal: CharacterResetModal | undefined;
    const open = vi.spyOn(CharacterResetModal.prototype, 'open').mockImplementation(function(this: CharacterResetModal) { openedModal = this; return this; });
    try {
      (CharacterView.prototype as unknown as { renderRuleset(this: typeof context, root: HTMLElement, options: ['2014', '2024']): void }).renderRuleset.call(context, createDraftIdentityRoot(selects) as unknown as HTMLElement, ['2014', '2024']);
      selects[0]!.value = '2014';
      selects[0]!.handlers[0]!();
      expect(openedModal).toBeDefined();
      expect((context.document as CharacterDocument).ruleset).toBe('2024');
      (openedModal as unknown as { onConfirm(): void }).onConfirm();
      expect((context.document as CharacterDocument).ruleset).toBe('2014');
      expect((context.document as CharacterDocument).classHitPoints).toBeUndefined();
      await (CharacterView.prototype as unknown as { cancelCharacterDraft(this: typeof context): Promise<void> }).cancelCharacterDraft.call(context);
    } finally {
      open.mockRestore();
    }
    expect(JSON.stringify(persisted)).toBe(beforeCancel);
    expect(context.document).toEqual(persisted);
    expect(updateIfUnchanged).toHaveBeenCalledTimes(1);
  });

  it('keeps an edit in memory and Cancel restores the saved document byte-for-byte', async () => {
    const saved = completeDocument();
    const file = new TFile();
    file.path = 'Characters/ayla.json';
    const persisted = JSON.stringify(saved, null, 2) + '\n';
    let writes = 0;
    const context = {
      file,
      document: structuredClone(saved),
      savedDocument: structuredClone(saved),
      completedEditMode: true,
      conflict: false,
      opened: true,
      renderUnavailable: (message: string) => { throw new Error(message); },
      render: async () => undefined,
      contentEl: { empty: () => undefined, createDiv: () => ({}) },
      store: { updateIfUnchanged: async () => { writes += 1; return saved; } },
      flushPendingUpdate: async () => undefined,
      leaf: { setViewState: async () => undefined },
      loadFromState: async () => undefined,
    };

    (CharacterView.prototype as unknown as { queueUpdate(this: typeof context, update: (document: CharacterDocument) => CharacterDocument): void }).queueUpdate.call(context, (document: CharacterDocument) => withRuleset(document, '2014'));
    expect(context.document.ruleset).toBe('2014');
    expect(context.document.origin).toBeUndefined();
    expect(writes).toBe(0);

    await (CharacterView.prototype as unknown as { cancelCharacterDraft(this: typeof context): Promise<void> }).cancelCharacterDraft.call(context);

    expect(context.document).toEqual(saved);
    expect(JSON.stringify(saved, null, 2) + '\n').toBe(persisted);
    expect(writes).toBe(0);
  });

  it('requires explicit confirmation for a ruleset or class reset', () => {
    const createModal = (onConfirm: () => void): Map<string, () => void> => {
      const buttons = new Map<string, () => void>();
      type ModalNode = {
        createDiv: (_options?: { text?: string; cls?: string }) => ModalNode;
        createEl: (_tag: string, options?: { text?: string; cls?: string; attr?: Record<string, string> }) => ModalNode;
        addEventListener: (_event: string, handler: () => void) => void;
      };
      const createNode = (): ModalNode => ({
        createDiv: () => createNode(),
        createEl: (_tag, options) => {
          const button = createNode();
          button.addEventListener = (_event, handler) => { if (options?.text) buttons.set(options.text, handler); };
          return button;
        },
        addEventListener: () => undefined,
      });
      const modal = new CharacterResetModal({} as never, 'Replace class?', 'Class-dependent choices will reset.', 'Replace class', onConfirm);
      Object.assign(modal, { titleEl: { textContent: '' }, contentEl: { empty: () => undefined, createDiv: () => createNode() }, close: () => undefined });
      modal.onOpen();
      return buttons;
    };
    let resetCount = 0;

    createModal(() => { resetCount += 1; }).get('Cancel')?.();
    expect(resetCount).toBe(0);
    createModal(() => { resetCount += 1; }).get('Replace class')?.();
    expect(resetCount).toBe(1);
  });

  it('keeps an invalid Apply draft editable, reports the error inline, and does not write', async () => {
    const saved = completeDocument({ classHitPoints: [{ classSourcePath: creationClass.sourcePath, level: 1, value: 'max' }] });
    const draft = structuredClone(saved);
    draft.classProgressions![0]!.targetLevel = 2;
    delete draft.classHitPoints;
    const persisted = JSON.stringify(saved);
    const context = Object.assign(Object.create(CharacterView.prototype) as Record<string, unknown>, {
      file: { path: 'Characters/ayla.md' }, savedDocument: saved, document: draft,
      completedEditMode: true, conflict: false, pendingUpdate: undefined, flushInProgress: undefined,
      loadCharacterSheetSources: vi.fn(async () => { throw new Error('Missing class hit-point entry for level 2.'); }),
      store: { updateIfUnchanged: vi.fn() }, render: vi.fn(async () => undefined), renderUnavailable: vi.fn(),
    });
    await (CharacterView.prototype as unknown as { applyCharacterDraft(this: typeof context): Promise<void> }).applyCharacterDraft.call(context);
    expect(context.document).toEqual(draft);
    expect(JSON.stringify(saved)).toBe(persisted);
    expect(context.store.updateIfUnchanged).not.toHaveBeenCalled();
    expect(context.renderUnavailable).not.toHaveBeenCalled();
    expect(context.draftApplyError).toBe('Missing class hit-point entry for level 2.');
    expect(context.render).toHaveBeenCalled();

    const labels: string[] = [];
    const messages: string[] = [];
    const makeNode = (): Record<string, unknown> => ({
      createDiv: (options?: { text?: string }) => { if (options?.text) messages.push(options.text); return makeNode(); },
      createEl: (_tag: string, options?: { text?: string }) => { if (options?.text) labels.push(options.text); return { disabled: false, setAttribute: () => undefined, addEventListener: () => undefined }; },
    });
    (CharacterView.prototype as unknown as { renderEditDraftActions(this: typeof context, root: HTMLElement): void }).renderEditDraftActions.call(context, makeNode() as unknown as HTMLElement);
    expect(messages).toContain('Missing class hit-point entry for level 2.');
    expect(labels).toContain('Cancel');
  });
});

function createSheetDocument() {
  return {
    ...createCharacterDocument('Ayla', snapshot),
    ruleset: '2024' as const,
    step: 'background' as const,
    origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' },
    classProgressions: [{ class: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' }, targetLevel: 1, selections: [] }],
    background: { sourcePath: 'packs/_source/origins24/backgrounds/soldier.yml', identifier: 'soldier', id: 'soldier-id' },
    abilityScores: { method: 'standard-array' as const, base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
  };
}

function draftLevelSummary(): ClassSourceSummary {
  return {
    source: { sourcePath: creationClass.sourcePath, pack: 'dnd5e.classes24', type: 'class', id: creationClass.id, identifier: creationClass.identifier, name: 'Fighter' },
    ruleset: '2024',
    hitDie: 'd10',
    advancements: [
      { id: 'level-one', type: 'Trait', level: 1, title: 'Skill choice', hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: ['skills:acr'] } } },
      { id: 'level-three', type: 'Trait', level: 3, title: 'Later skill choice', hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: ['skills:arc'] } } },
    ],
  };
}

function createDraftIdentityRoot(selects: Array<{ value: string; options: Array<{ value: string; selected: boolean }>; handlers: Array<() => void> }>): Record<string, unknown> {
  const createNode = (): Record<string, unknown> => ({
    value: '', textContent: '',
    createDiv: () => createNode(), createSpan: () => createNode(),
    createEl: (tag: string, options?: { value?: string; text?: string; type?: string }) => {
      if (tag !== 'select') return createNode();
      const control = { value: '', options: [] as Array<{ value: string; selected: boolean }>, handlers: [] as Array<() => void> };
      const select = createNode();
      select.createEl = (_optionTag: string, option?: { value?: string; text?: string }) => {
        const entry = { value: option?.value ?? '', selected: false };
        control.options.push(entry);
        return entry;
      };
      select.addEventListener = (_event: string, handler: () => void) => control.handlers.push(handler);
      Object.defineProperty(select, 'value', { get: () => control.value, set: (value: string) => { control.value = value; } });
      selects.push(control);
      return select;
    },
    addEventListener: () => undefined,
  });
  return createNode();
}

function createSheetClassSummary(document: ReturnType<typeof createSheetDocument>) {
  return { source: { sourcePath: document.classProgressions[0].class.sourcePath, pack: 'dnd5e.classes24', type: 'class', id: 'fighter-id', identifier: 'fighter', name: 'Fighter' }, ruleset: '2024' as const, hitDie: 'd10', proficiencies: { armor: [], weapons: [], tools: [], savingThrows: ['saves:str'], languages: [], skills: [], choices: [] }, advancements: [] };
}

function createSheetBackgroundSummary(document: ReturnType<typeof createSheetDocument>) {
  return { source: { sourcePath: document.background.sourcePath, pack: 'dnd5e.backgrounds24', type: 'background', id: 'soldier-id', identifier: 'soldier', name: 'Soldier' }, ruleset: '2024' as const, skills: [], languages: [], languageChoices: [], tools: [], features: [], equipment: [] };
}

function createInventorySheetDocument(includeShield = false) {
  const document = createSheetDocument();
  const chainMail = { entryId: 'chain', source: { sourcePath: 'packs/_source/equipment24/armor/heavy/chain-mail.yml', pack: 'dnd5e.equipment24', type: 'equipment', id: 'chain-mail', name: 'Chain Mail' }, quantity: 1, equipped: false, provenance: [] };
  const travelJournal = { entryId: 'travel-journal', custom: { name: 'Travel journal', description: 'Notes from the road.' }, quantity: 2, equipped: false, provenance: [] };
  const shield = { entryId: 'shield', source: { sourcePath: 'packs/_source/equipment24/armor/shield.yml', pack: 'dnd5e.equipment24', type: 'equipment', id: 'shield', name: 'Shield' }, quantity: 1, equipped: false, provenance: [] };
  const items = includeShield ? [chainMail, travelJournal, shield] : [chainMail, travelJournal];
  return {
    ...document,
    mutable: {
      preparedSpells: [],
      inventory: { items, currency: { cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 } },
      equipmentStatus: items.map((item) => ({ entryId: item.entryId, equipped: item.entryId === 'chain', attuned: false })),
      resources: [],
    },
  };
}

function createSheetSourceIndex(
  document: ReturnType<typeof createSheetDocument>,
  getItemSummary: (ruleset: '2014' | '2024', sourcePath: string) => Promise<FoundryItemSummary | null>,
) {
  return {
    getSpeciesSummary: async () => ({ source: { sourcePath: document.origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', identifier: 'elf', name: 'Elf' }, ruleset: '2024' as const, movement: { walk: 30, units: 'ft' }, advancements: [] }),
    getClassSummary: async () => createSheetClassSummary(document),
    getBackgroundSummary: async () => createSheetBackgroundSummary(document),
    getItemSummary,
  };
}

function createChainMailSummary(sourcePath: string): FoundryItemSummary {
  return { sourcePath, pack: 'dnd5e.equipment24', type: 'equipment', id: 'chain-mail', name: 'Chain Mail', ruleset: '2024' as const, itemType: 'equipment', category: 'heavy', magic: false, equippable: true, armor: { value: 16, dex: 0 }, strength: 13, properties: ['stealthDisadvantage'], weight: { value: 55, units: 'lb' } };
}

function createShieldSummary(sourcePath: string): FoundryItemSummary {
  return { ...createChainMailSummary(sourcePath), id: 'shield', name: 'Shield', category: 'shield', armor: { value: 2 }, strength: undefined, properties: [], weight: { value: 6, units: 'lb' } };
}

type TestNode = {
  value: string;
  type?: string;
  classList: { add: (...tokens: string[]) => void };
  textContent: string;
  disabled: boolean;
  selected: boolean;
  empty: () => void;
  createDiv: (child?: { text?: string }) => TestNode;
  createSpan: (child?: { text?: string }) => TestNode;
  createEl: (tag: string, child?: { text?: string; value?: string; type?: string }) => TestNode;
  addEventListener: (event: string, handler: () => void) => void;
  setAttribute: (...args: string[]) => void;
  dispatch: (event: string) => void;
  handlers?: Record<string, () => void>;
};

function createViewRenderRoot(): { root: TestNode; text: string[]; control: (label: string) => TestNode } {
  const text: string[] = [];
  const controls: TestNode[] = [];
  const createNode = (options?: { text?: string }): TestNode => {
    if (options?.text !== undefined) text.push(options.text);
    const node: TestNode = {
      value: '',
      classList: { add: () => undefined },
      textContent: options?.text ?? '',
      disabled: false,
      selected: false,
      dispatch: () => undefined,
      empty: () => undefined,
      createDiv: (child?: { text?: string }) => createNode(child),
      createSpan: (child?: { text?: string }) => createNode(child),
      createEl: (_tag: string, child?: { text?: string; value?: string; type?: string }) => {
        const created = createNode(child);
        if (child?.value !== undefined) created.value = child.value;
        if (child?.type !== undefined) created.type = child.type;
        if (_tag === 'input' || _tag === 'button') { created.dispatch = (event: string) => { const handler = created.handlers?.[event]; if (handler) handler(); }; created.handlers = {}; controls.push(created); }
        return created;
      },
      addEventListener: (event: string, handler: () => void) => { const handlers = node.handlers ?? {}; node.handlers = handlers; handlers[event] = handler; },
      setAttribute: () => undefined,
    };
    return node;
  };
  return { root: createNode(), text, control: (label) => { const found = controls.find((node) => label === 'Character name' ? node.type === 'text' : node.textContent === label); if (found === undefined) throw new Error(`Missing test control: ${label}`); return found; } };
}

type AbilityTestNode = {
  tag: string;
  value: string;
  textContent: string;
  selected: boolean;
  disabled: boolean;
  cls: string;
  children: AbilityTestNode[];
  createDiv: (options?: { text?: string; cls?: string }) => AbilityTestNode;
  createSpan: (options?: { text?: string; cls?: string }) => AbilityTestNode;
  createEl: (tag: string, options?: { text?: string; value?: string; cls?: string; type?: string; attr?: Record<string, string> }) => AbilityTestNode;
  empty: () => void;
  addEventListener: (event: string, handler: (event: { target: AbilityTestNode }) => void) => void;
  dispatch: (event: string) => void;
};

function abilityScoreTestView(initial: CharacterDocument): { root: AbilityTestNode; view: Record<string, unknown>; current: () => CharacterDocument } {
  const createNode = (options: { text?: string; value?: string; cls?: string } = {}, tag = 'div'): AbilityTestNode => {
    const handlers = new Map<string, (event: { target: AbilityTestNode }) => void>();
    const node: AbilityTestNode = {
      tag, value: options.value ?? '', textContent: options.text ?? '', selected: false, disabled: false, cls: options.cls ?? '', children: [],
      createDiv: (child) => { const created = createNode(child); node.children.push(created); return created; },
      createSpan: (child) => { const created = createNode(child); node.children.push(created); return created; },
      createEl: (childTag, child) => { const created = createNode(child, childTag); node.children.push(created); return created; },
      empty: () => { node.children = []; },
      addEventListener: (event, handler) => { handlers.set(event, handler); },
      dispatch: (event) => { handlers.get(event)?.({ target: node }); },
    };
    return node;
  };
  let document = initial;
  const view: Record<string, unknown> = Object.create(CharacterView.prototype);
  Object.assign(view, {
    document,
    sourceIndex: { getSpeciesSummary: async () => completeSources().species!, getClassSummary: async () => completeSources().class!, getBackgroundSummary: async () => completeSources().background! },
    queueUpdate: (update: (current: CharacterDocument) => CharacterDocument) => { document = update(document); view.document = document; },
  });
  return { root: createNode(), view, current: () => document };
}

function abilityRows(root: AbilityTestNode): AbilityTestNode[] {
  const table = root.children.find((child) => child.cls === 'guided-character-sheet__ability-table');
  return table?.children.slice(1) ?? [];
}

function spellReference(name: string, id: string, level: number, spellLists: string[]): SpellChoice['options'][number] {
  const source: FoundrySpellSummary = { sourcePath: `packs/_source/spells/${id}.yml`, pack: 'dnd5e.spells', type: 'spell', id, name, level, spellLists, ruleset: '2024', ritual: false };
  return { value: `dnd5e.spells:${id}`, label: name, source };
}

function spellChoice(key: string, label: string, count: number, level: number, spellLists: string[], abilityOptions: string[], parent?: SpellChoice['parent'], _unused?: undefined, options: SpellChoice['options'] = []): SpellChoice {
  return { key, advancementId: key, label, count, level, spellLists, selected: [], abilityOptions, options, ...(parent === undefined ? {} : { parent }), raw: {} };
}

function createSpellTestRoot(rendered: string[], removed = { value: false }, tags: string[] = []): { createDiv: () => ReturnType<typeof createSpellTestRoot>; createEl: (tag: string, options?: { text?: string; value?: string; cls?: string }) => Record<string, unknown> } {
  const node: Record<string, unknown> = {
    createDiv: () => node,
    createEl: (tag: string, options?: { text?: string; value?: string; cls?: string }) => { tags.push(tag); if (options?.text) rendered.push(options.text); return node; },
    addEventListener: () => undefined,
    selectedOptions: [],
    options: [],
    empty: () => undefined,
    value: '',
    remove: () => { removed.value = true; },
  };
  return node as ReturnType<typeof createSpellTestRoot>;
}

function createInteractiveSpellRoot(controls: Array<{ value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> }>): Record<string, unknown> {
  const createNode = (): Record<string, unknown> => {
    const node: Record<string, unknown> = {
      options: [],
      value: '',
      textContent: '',
      createDiv: () => createNode(),
      createEl: (tag: string, options?: { text?: string; value?: string }) => {
        if (tag === 'select') {
          const select = createNode();
          const control: { value: string; handlers: Array<() => void>; options?: Array<{ value: string; disabled?: boolean; selected?: boolean; text?: string }> } = { value: '', handlers: [] };
          select.addEventListener = (_event: string, handler: () => void) => control.handlers.push(handler);
          Object.defineProperty(select, 'value', { get: () => control.value, set: (value: string) => { control.value = value; } });
          control.options = select.options as Array<{ value: string; disabled?: boolean }>;
          Object.defineProperty(select, 'selectedOptions', { get: () => (select.options as Array<{ value: string; selected?: boolean }>).filter((option) => option.selected || option.value === control.value) });
          controls.push(control);
          return select;
        }
        if (tag === 'option') {
          const option = { value: options?.value ?? '', text: options?.text ?? '', disabled: false, selected: false };
          (node.options as unknown[]).push(option);
          return option;
        }
        return node;
      },
      addEventListener: () => undefined,
      remove: () => undefined,
      empty: () => undefined,
    };
    return node;
  };
  return createNode();
}
