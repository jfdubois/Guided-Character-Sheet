import type { SourceSnapshot } from './source-tree';
import { toSpeciesConfigurationSelection, type SpeciesConfigurationSelection, type SpeciesSpellChoiceSelection } from './species-configuration';
import type { ClassProgressionSelection } from './class-configuration';
import { isRecord } from './foundry-utils';
import { emptyInventory, isCharacterInventory, isFoundryInventoryEntry, replaceInventorySource, type CharacterInventory, type EquipmentSelection, type InventoryEntry } from './inventory';
import { canonicalizeLanguageSelector, languageSelectorKey, type FoundrySourceReference } from './foundry-source-catalog';
import { ABILITIES, isValidRolledBase, pointBuyTotal, validateAbilityScores, type Ability, type AbilityScoreSelection, type PointBuyDraft, type RolledAbilityDraft, type StandardArrayDraft } from './ability-scores';
import { createBackgroundAbilitySelection, validateBackgroundAbilitySelection, type BackgroundAbilityConfiguration, type BackgroundAbilitySelection } from './background-ability-configuration';
import { isMutableCharacterState, type MutableCharacterState } from './mutable-character-state';
import { isFoundrySourceReference, isSafeSourcePath } from './foundry-source-reference';
import { isClassHitPointEntry, type ClassHitPointEntry } from './class-hit-points';
import { restoreGrantedFeatConfiguration, toGrantedFeatSelection, validateGrantedFeatConfiguration, type GrantedFeatConfiguration, type GrantedFeatSelection } from './granted-feat-configuration';

export type CharacterRuleset = '2014' | '2024';
export type CharacterStep = 'ruleset' | 'origin' | 'class' | 'background';

export interface CharacterOriginReference {
  sourcePath: string;
  identifier: string;
  id: string;
}

export interface CharacterClassReference {
  sourcePath: string;
  identifier: string;
  id: string;
}
export interface CharacterBackgroundReference {
  sourcePath: string;
  identifier: string;
  id: string;
}
export interface BackgroundChoicesSelection {
  languages?: string[];
  abilityScores?: BackgroundAbilitySelection;
  grantedFeat?: GrantedFeatSelection;
}

export interface CharacterFoundryReference {
  systemVersion: string;
  sourceBranch: string;
  sourceCommit: string;
}

export interface CharacterDocument {
  format: 1;
  kind: 'guided-character';
  name: string;
  ruleset: CharacterRuleset | null;
  step: CharacterStep;
  foundry: CharacterFoundryReference;
  origin?: CharacterOriginReference;
  speciesConfiguration?: SpeciesConfigurationSelection;
  classProgressions?: ClassProgressionSelection[];
  classHitPoints?: ClassHitPointEntry[];
  background?: CharacterBackgroundReference;
  backgroundChoices?: BackgroundChoicesSelection;
  classEquipment?: EquipmentSelection;
  backgroundEquipment?: EquipmentSelection;
  inventory?: CharacterInventory;
  abilityScores?: AbilityScoreSelection;
  abilityScoreDraft?: StandardArrayDraft | RolledAbilityDraft | PointBuyDraft;
  mutable?: MutableCharacterState;
  [key: string]: unknown;
}

const RACE_PREFIX = 'packs/_source/races/';
const SPECIES_PREFIX = 'packs/_source/origins24/species/';

export function parseCharacterDocument(value: unknown): CharacterDocument {
  if (!isRecord(value) || value.format !== 1 || value.kind !== 'guided-character' || typeof value.name !== 'string' || value.name.trim().length === 0 || !isRuleset(value.ruleset) && value.ruleset !== null || !isStep(value.step) || !isFoundryReference(value.foundry)) {
    throw new Error('Invalid character document');
  }
  if (value.step === 'ruleset' && value.ruleset !== null) throw new Error('Invalid character document');
  if (value.step === 'origin' && (!isRuleset(value.ruleset) || ('origin' in value && (!isOriginReference(value.origin) || !isCompatibleOrigin(value.ruleset, value.origin))))) throw new Error('Invalid character document');
  if ((value.step === 'class' || value.step === 'background') && (!isRuleset(value.ruleset) || !isOriginReference(value.origin) || !isCompatibleOrigin(value.ruleset, value.origin) || !isClassProgressions(value.classProgressions, value.ruleset) || value.classProgressions.length !== 1)) throw new Error('Invalid character document');
  if (value.step === 'background' && (!isRuleset(value.ruleset) || !isBackgroundReference(value.background) || !isCompatibleBackground(value.ruleset, value.background))) throw new Error('Invalid character document');
  if (value.step === 'ruleset' && 'origin' in value) throw new Error('Invalid character document');
  if (value.step !== 'class' && value.step !== 'background' && 'classProgressions' in value) throw new Error('Invalid character document');
  if (value.step !== 'background' && 'background' in value) throw new Error('Invalid character document');
  if (value.backgroundChoices !== undefined && (!isBackgroundChoices(value.backgroundChoices) || value.step !== 'background')) throw new Error('Invalid character document');
  if (value.classEquipment !== undefined && !isEquipmentSelection(value.classEquipment) || value.classEquipment !== undefined && value.classProgressions === undefined) throw new Error('Invalid character document');
  if (value.backgroundEquipment !== undefined && !isEquipmentSelection(value.backgroundEquipment) || value.backgroundEquipment !== undefined && value.background === undefined) throw new Error('Invalid character document');
  if (value.inventory !== undefined && !isCharacterInventory(value.inventory)) throw new Error('Invalid character document');
  if (value.abilityScores !== undefined && !isAbilityScoreSelection(value.abilityScores)) throw new Error('Invalid character document');
  if (value.abilityScoreDraft !== undefined && ((!isStandardArrayDraft(value.abilityScoreDraft) && !isRolledAbilityDraft(value.abilityScoreDraft) && !isPointBuyDraft(value.abilityScoreDraft) || isPointBuyDraft(value.abilityScoreDraft) && pointBuyTotal(value.abilityScoreDraft.base) === 27) || value.abilityScores !== undefined)) throw new Error('Invalid character document');
  if (value.mutable !== undefined && !isMutableCharacterState(value.mutable)) throw new Error('Invalid character document');
  if (value.classHitPoints !== undefined && !isEffectiveClassHitPointLedger(value.classHitPoints, value.classProgressions)) throw new Error('Invalid character document');
  const savedSpeciesConfiguration = value.speciesConfiguration;
  if (savedSpeciesConfiguration !== undefined && !isSpeciesConfigurationSelection(savedSpeciesConfiguration)) throw new Error('Invalid character document');
  if (savedSpeciesConfiguration !== undefined && (!isOriginReference(value.origin) || savedSpeciesConfiguration.origin.id !== value.origin.id)) throw new Error('Invalid character document');
  return sanitizeCharacterDocument(value as CharacterDocument);
}

function sanitizeCharacterDocument(document: CharacterDocument): CharacterDocument {
  const next = { ...document };
  if (next.speciesConfiguration !== undefined) next.speciesConfiguration = sanitizeSpeciesConfigurationSelection(next.speciesConfiguration);
  if (next.classEquipment !== undefined) next.classEquipment = sanitizeEquipmentSelection(next.classEquipment);
  if (next.backgroundEquipment !== undefined) next.backgroundEquipment = sanitizeEquipmentSelection(next.backgroundEquipment);
  if (next.backgroundChoices !== undefined) next.backgroundChoices = sanitizeBackgroundChoices(next.backgroundChoices);
  if (next.inventory !== undefined) next.inventory = { ...next.inventory, items: next.inventory.items.map(sanitizeInventoryEntry) };
  if (next.abilityScoreDraft?.method === 'point-buy') next.abilityScoreDraft = { method: 'point-buy', base: { ...next.abilityScoreDraft.base }, manual: { ...next.abilityScoreDraft.manual } };
  else if (next.abilityScoreDraft?.method === 'standard-array') next.abilityScoreDraft = { method: 'standard-array', base: { ...next.abilityScoreDraft.base }, manual: { ...next.abilityScoreDraft.manual } };
  else if (next.abilityScoreDraft?.method === 'dice-rolling') next.abilityScoreDraft = { method: 'dice-rolling', base: { ...next.abilityScoreDraft.base }, manual: { ...next.abilityScoreDraft.manual } };
  if (next.classProgressions !== undefined) next.classProgressions = next.classProgressions.map((progression) => ({
    ...progression,
    ...(progression.subclass === undefined ? {} : { subclass: sanitizeSourceReference(progression.subclass) }),
    selections: progression.selections.map((selection) => {
      if (selection.kind === 'spell' && selection.selectionRole === undefined) return { ...selection, selectionRole: selection.level === 0 ? 'cantrips-known' as const : 'known-spells' as const };
      if (selection.kind === 'subclass') return { ...selection, options: selection.options.map(sanitizeSourceReference), ...(selection.selected === undefined ? {} : { selected: sanitizeSourceReference(selection.selected) }) };
      return selection;
    }),
  }));
  if (next.classHitPoints !== undefined) next.classHitPoints = next.classHitPoints.map((entry) => ({ ...entry }));
  if (next.mutable !== undefined) next.mutable = { ...next.mutable, ...(next.mutable.hitPoints === undefined ? {} : { hitPoints: { ...next.mutable.hitPoints, temporary: next.mutable.hitPoints.temporary ?? 0 } }), ...(next.mutable.hitDice === undefined ? {} : { hitDice: next.mutable.hitDice.map((pool) => ({ ...pool })) }), preparedSpells: next.mutable.preparedSpells.map(sanitizeSourceReference), inventory: { ...next.mutable.inventory, items: next.mutable.inventory.items.map(sanitizeInventoryEntry) }, equipmentStatus: next.mutable.equipmentStatus.map((status) => ({ ...status })), resources: next.mutable.resources.map((resource) => ({ ...resource, ...(resource.recovery === undefined ? {} : { recovery: resource.recovery.map((profile) => ({ ...profile })) }) })), ...(next.mutable.spellSlots === undefined ? {} : { spellSlots: next.mutable.spellSlots.map((slot) => ({ ...slot, ...(slot.recovery === undefined ? {} : { recovery: [...slot.recovery] }) })) }), ...(next.mutable.spellUses === undefined ? {} : { spellUses: next.mutable.spellUses.map((use) => ({ ...use, ...(use.recovery === undefined ? {} : { recovery: use.recovery.map((profile) => ({ ...profile })) }) })) }), ...(next.mutable.spellOverlay === undefined ? {} : { spellOverlay: { added: next.mutable.spellOverlay.added.map((entry) => ({ reference: sanitizeSourceReference(entry.reference), ownership: entry.ownership })), removed: next.mutable.spellOverlay.removed.map(sanitizeSourceReference) } }) };
  return next;
}

function sanitizeSpeciesConfigurationSelection(selection: SpeciesConfigurationSelection): SpeciesConfigurationSelection {
  return {
    ...selection,
    origin: { ...selection.origin },
    foundry: { ...selection.foundry },
    grants: selection.grants.map((grant) => ({ key: grant.key, source: { ...grant.source } })),
    choices: selection.choices.map((choice) => ({ key: choice.key, source: { ...choice.source }, selected: [...choice.selected] })),
    ...(selection.size === undefined ? {} : { size: { advancementId: selection.size.advancementId, selected: selection.size.selected } }),
    ...(selection.spellChoices === undefined ? {} : { spellChoices: selection.spellChoices.map((choice): SpeciesSpellChoiceSelection => choice.kind === 'spell-list'
      ? { key: choice.key, advancementId: choice.advancementId, kind: choice.kind, selected: [...choice.selected] }
      : { key: choice.key, advancementId: choice.advancementId, kind: choice.kind, selected: choice.selected.map(sanitizeSourceReference), ...(choice.selectedAbility === undefined ? {} : { selectedAbility: choice.selectedAbility }) }) }),
    ...(selection.spellcastingAbility === undefined ? {} : { spellcastingAbility: { advancementIds: [...selection.spellcastingAbility.advancementIds], selected: selection.spellcastingAbility.selected } }),
  };
}

function sanitizeEquipmentSelection(selection: EquipmentSelection): EquipmentSelection {
  return { selected: { ...selection.selected }, semantic: Object.fromEntries(Object.entries(selection.semantic).map(([key, source]) => [key, sanitizeSourceReference(source)])) };
}

function sanitizeSourceReference(source: FoundrySourceReference): FoundrySourceReference {
  return { sourcePath: source.sourcePath, pack: source.pack, type: source.type, id: source.id, name: source.name, ...(source.identifier === undefined ? {} : { identifier: source.identifier }) };
}

function sanitizeInventoryEntry(entry: InventoryEntry): InventoryEntry {
  if (isFoundryInventoryEntry(entry)) return { ...entry, source: sanitizeSourceReference(entry.source), provenance: entry.provenance.map((value) => ({ ...value })) };
  return { ...entry, custom: structuredClone(entry.custom), provenance: entry.provenance.map((value) => ({ ...value })) };
}

export function withSpeciesConfiguration(document: CharacterDocument, configuration: import('./species-configuration').SpeciesConfiguration): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (current.origin === undefined || current.origin.id !== configuration.origin.id) throw new Error('Invalid species configuration');
  return { ...current, speciesConfiguration: toSpeciesConfigurationSelection(configuration) };
}

export function createCharacterDocument(name: string, snapshot: SourceSnapshot): CharacterDocument {
  if (typeof name !== 'string' || name.trim().length === 0 || !isSnapshot(snapshot)) throw new Error('Invalid character document');
  return {
    format: 1,
    kind: 'guided-character',
    name,
    ruleset: null,
    step: 'ruleset',
    foundry: { systemVersion: snapshot.systemVersion, sourceBranch: snapshot.branch, sourceCommit: snapshot.commit },
  };
}

export function withName(document: CharacterDocument, name: string): CharacterDocument {
  const current = parseCharacterDocument(document);
  const normalized = name.trim();
  if (normalized.length === 0) throw new Error('Invalid character name');
  return { ...current, name: normalized };
}

export function withRuleset(document: CharacterDocument, ruleset: CharacterRuleset): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isRuleset(ruleset)) throw new Error('Invalid character ruleset');
  const next = { ...current, ruleset, step: 'origin' as const };
  delete next.origin;
  delete next.speciesConfiguration;
  delete next.classProgressions;
  delete next.classHitPoints;
  delete next.background;
  delete next.backgroundChoices;
  delete next.classEquipment;
  delete next.backgroundEquipment;
  delete next.inventory;
  delete next.abilityScores;
  delete next.abilityScoreDraft;
  delete next.mutable;
  return next;
}

export function withOrigin(document: CharacterDocument, origin: CharacterOriginReference): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isRuleset(current.ruleset) || !isOriginReference(origin) || !isCompatibleOrigin(current.ruleset, origin)) throw new Error('Invalid character origin');
  const next = { ...current, origin: { ...origin }, step: 'origin' as const };
  const originChanged = current.origin?.id !== origin.id || current.origin.sourcePath !== origin.sourcePath || current.origin.identifier !== origin.identifier;
  if (originChanged) delete next.speciesConfiguration;
  if (originChanged) delete next.classProgressions;
  if (originChanged) delete next.classHitPoints;
  if (originChanged) delete next.background;
  if (originChanged) delete next.backgroundChoices;
  if (originChanged) { delete next.classEquipment; delete next.backgroundEquipment; delete next.inventory; }
  if (originChanged) { delete next.abilityScores; delete next.abilityScoreDraft; delete next.mutable; }
  return next;
}

export function withClassProgression(document: CharacterDocument, progression: ClassProgressionSelection): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isRuleset(current.ruleset) || current.origin === undefined || !isClassProgression(progression, current.ruleset)) throw new Error('Invalid class progression');
  const currentClass = current.classProgressions?.[0]?.class;
  const classChanged = currentClass !== undefined && (currentClass.sourcePath !== progression.class.sourcePath || currentClass.identifier !== progression.class.identifier || currentClass.id !== progression.class.id);
  const next = { ...current, step: classChanged || current.background === undefined ? 'class' as const : 'background' as const, classProgressions: [structuredClone(progression)] };
  if (classChanged) {
    delete next.classHitPoints;
    delete next.background;
    delete next.backgroundChoices;
  }
  let inventory = current.inventory;
  if (classChanged) {
    if (current.background?.sourcePath !== undefined) inventory = replaceInventorySource(inventory ?? emptyInventory(), current.background.sourcePath, emptyInventory());
    if (current.classProgressions?.[0]?.class.sourcePath !== undefined) inventory = replaceInventorySource(inventory ?? emptyInventory(), current.classProgressions[0].class.sourcePath, emptyInventory());
    delete next.classEquipment;
    delete next.backgroundEquipment;
    delete next.abilityScores;
    delete next.abilityScoreDraft;
    delete next.mutable;
    if (inventory === undefined || inventory.items.length === 0 && Object.values(inventory.currency).every((value) => value === 0)) delete next.inventory;
    else next.inventory = inventory;
  }
  return next;
}

function isEffectiveClassHitPointLedger(value: unknown, progressions: unknown): value is ClassHitPointEntry[] {
  if (!Array.isArray(progressions) || !isRecord(progressions[0])) return false;
  const progression = progressions[0];
  if (!isRecord(progression.class) || typeof progression.class.sourcePath !== 'string' || typeof progression.targetLevel !== 'number' || !Number.isInteger(progression.targetLevel)) return false;
  const classSourcePath = progression.class.sourcePath;
  const targetLevel = progression.targetLevel;
  if (!Array.isArray(value) || targetLevel < 1 || value.length !== targetLevel) return false;
  return value.every((entry, index) => isClassHitPointEntry(entry)
    && entry.classSourcePath === classSourcePath
    && entry.level === index + 1
    && (index === 0 ? entry.value === 'max' : entry.value !== 'max'));
}
export function withBackground(document: CharacterDocument, background: CharacterBackgroundReference): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isRuleset(current.ruleset) || current.origin === undefined || current.classProgressions === undefined || current.classProgressions.length !== 1 || !isBackgroundReference(background) || !isCompatibleBackground(current.ruleset, background)) throw new Error('Invalid character background');
  const next = { ...current, step: 'background' as const, background: { ...background } };
  const backgroundChanged = current.background?.id !== background.id || current.background.sourcePath !== background.sourcePath || current.background.identifier !== background.identifier;
  if (backgroundChanged) delete next.backgroundChoices;
  if (backgroundChanged) {
    if (current.background?.sourcePath !== undefined) next.inventory = replaceInventorySource(current.inventory ?? emptyInventory(), current.background.sourcePath, emptyInventory());
    delete next.backgroundEquipment;
  }
  if (backgroundChanged) { delete next.abilityScores; delete next.abilityScoreDraft; delete next.mutable; }
  return next;
}

export function withClassEquipment(document: CharacterDocument, selection: EquipmentSelection): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (current.classProgressions?.length !== 1 || !isEquipmentSelection(selection)) throw new Error('Invalid class equipment selection');
  return { ...current, classEquipment: structuredClone(selection) };
}

export function withBackgroundEquipment(document: CharacterDocument, selection: EquipmentSelection): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (current.background === undefined || !isEquipmentSelection(selection)) throw new Error('Invalid background equipment selection');
  return { ...current, backgroundEquipment: structuredClone(selection) };
}

export function withInventory(document: CharacterDocument, inventory: CharacterInventory): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isCharacterInventory(inventory)) throw new Error('Invalid character inventory');
  return { ...current, inventory: structuredClone(inventory) };
}
export function withAbilityScores(document: CharacterDocument, selection: AbilityScoreSelection): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isAbilityScoreSelection(selection)) throw new Error('Invalid ability score selection');
  const next = { ...current, abilityScores: structuredClone(selection) };
  delete next.abilityScoreDraft;
  return next;
}
export function withStandardArrayDraft(document: CharacterDocument, draft: StandardArrayDraft): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isStandardArrayDraft(draft)) throw new Error('Invalid Standard Array draft');
  if (ABILITIES.every((ability) => draft.base[ability] !== undefined)) {
    const base = Object.fromEntries(ABILITIES.map((ability) => [ability, draft.base[ability]])) as Record<Ability, number>;
    return withAbilityScores(current, { method: 'standard-array', base, manual: { ...draft.manual } });
  }
  const next = { ...current, abilityScoreDraft: { method: 'standard-array' as const, base: { ...draft.base }, manual: { ...draft.manual } } };
  delete next.abilityScores;
  return next;
}
export function withRolledAbilityDraft(document: CharacterDocument, draft: RolledAbilityDraft): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isRolledAbilityDraft(draft)) throw new Error('Invalid rolled ability draft');
  if (ABILITIES.every((ability) => isValidRolledBase(draft.base[ability]))) {
    const base = Object.fromEntries(ABILITIES.map((ability) => [ability, draft.base[ability]])) as Record<Ability, number>;
    return withAbilityScores(current, { method: 'dice-rolling', base, manual: { ...draft.manual } });
  }
  const next = { ...current, abilityScoreDraft: { method: 'dice-rolling' as const, base: { ...draft.base }, manual: { ...draft.manual } } };
  delete next.abilityScores;
  return next;
}
export function withPointBuyDraft(document: CharacterDocument, draft: PointBuyDraft): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isPointBuyDraft(draft)) throw new Error('Invalid Point Buy draft');
  if (pointBuyTotal(draft.base) === 27) return withAbilityScores(current, { method: 'point-buy', base: { ...draft.base }, manual: { ...draft.manual } });
  const next = { ...current, abilityScoreDraft: { method: 'point-buy' as const, base: { ...draft.base }, manual: { ...draft.manual } } };
  delete next.abilityScores;
  return next;
}
export function withMutableState(document: CharacterDocument, state: MutableCharacterState): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (!isMutableCharacterState(state)) throw new Error('Invalid mutable character state');
  return { ...current, mutable: structuredClone(state) };
}
export function withBackgroundLanguages(document: CharacterDocument, languages: string[], requirement: number | string[] = 2): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (typeof requirement === 'number') {
    if (current.step !== 'background' || current.background === undefined || !Number.isInteger(requirement) || requirement < 1 || languages.length !== requirement || new Set(languages).size !== languages.length || languages.some((language) => !isSafeLanguageSelector(language))) throw new Error('Invalid background language selection');
    return { ...current, backgroundChoices: { ...(current.backgroundChoices === undefined ? {} : sanitizeBackgroundChoices(current.backgroundChoices)), languages: [...languages] } };
  }
  const allowedLanguages = requirement;
  const canonicalLanguages = languages.map(canonicalizeLanguageSelector);
  const canonicalAllowedLanguages = allowedLanguages.map(canonicalizeLanguageSelector);
  const semanticLanguages = canonicalLanguages.map((language) => language === null ? '' : languageSelectorKey(language));
  if (current.step !== 'background' || current.background === undefined || languages.length !== 2 || new Set(semanticLanguages).size !== languages.length || languages.some((language, index) => !isSafeLanguageSelector(language) || canonicalLanguages[index] === null || semanticLanguages[index] === 'common' || !canonicalAllowedLanguages.includes(canonicalLanguages[index]))) throw new Error('Invalid background language selection');
  return {
    ...current,
    backgroundChoices: {
      ...(current.backgroundChoices?.abilityScores === undefined ? {} : {
        abilityScores: {
          advancementId: current.backgroundChoices.abilityScores.advancementId,
          assignments: { ...current.backgroundChoices.abilityScores.assignments },
        },
      }),
      ...(current.backgroundChoices?.grantedFeat === undefined ? {} : { grantedFeat: sanitizeGrantedFeatSelection(current.backgroundChoices.grantedFeat) }),
      languages: [...languages],
    },
  };
}

export function withBackgroundAbilityScores(document: CharacterDocument, selection: BackgroundAbilitySelection, configuration: BackgroundAbilityConfiguration): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (current.step !== 'background' || current.background === undefined) throw new Error('Invalid background ability selection');
  const errors = validateBackgroundAbilitySelection(configuration, selection);
  if (errors.length > 0) throw new Error(errors[0]);
  if (configuration.kind !== 'choice') throw new Error('Invalid background ability selection');
  const canonical = createBackgroundAbilitySelection(configuration, selection.assignments);
  return {
    ...current,
    backgroundChoices: {
      ...(current.backgroundChoices?.languages === undefined ? {} : { languages: [...current.backgroundChoices.languages] }),
      ...(current.backgroundChoices?.grantedFeat === undefined ? {} : { grantedFeat: sanitizeGrantedFeatSelection(current.backgroundChoices.grantedFeat) }),
      abilityScores: canonical,
    },
  };
}

export function withBackgroundGrantedFeat(document: CharacterDocument, selection: GrantedFeatSelection, configuration: GrantedFeatConfiguration): CharacterDocument {
  const current = parseCharacterDocument(document);
  if (current.step !== 'background' || current.background === undefined || !isGrantedFeatSelection(selection)) throw new Error('Invalid background granted feat selection');
  const restored = restoreGrantedFeatConfiguration(configuration, selection);
  const errors = validateGrantedFeatConfiguration(restored, { requireComplete: false });
  if (restored.kind !== 'choice' || errors.length > 0) throw new Error(errors[0] ?? 'Invalid background granted feat selection');
  return {
    ...current,
    backgroundChoices: {
      ...(current.backgroundChoices?.languages === undefined ? {} : { languages: [...current.backgroundChoices.languages] }),
      ...(current.backgroundChoices?.abilityScores === undefined ? {} : { abilityScores: { advancementId: current.backgroundChoices.abilityScores.advancementId, assignments: { ...current.backgroundChoices.abilityScores.assignments } } }),
      grantedFeat: sanitizeGrantedFeatSelection(toGrantedFeatSelection(restored)),
    },
  };
}

function isRuleset(value: unknown): value is CharacterRuleset { return value === '2014' || value === '2024'; }
function isStep(value: unknown): value is CharacterStep { return value === 'ruleset' || value === 'origin' || value === 'class' || value === 'background'; }
function isFoundryReference(value: unknown): value is CharacterFoundryReference { return isRecord(value) && typeof value.systemVersion === 'string' && value.systemVersion.trim().length > 0 && typeof value.sourceBranch === 'string' && value.sourceBranch.trim().length > 0 && typeof value.sourceCommit === 'string' && /^[0-9a-f]{40}$/i.test(value.sourceCommit); }
function isSnapshot(value: unknown): value is SourceSnapshot { return isRecord(value) && typeof value.owner === 'string' && typeof value.repo === 'string' && typeof value.branch === 'string' && value.branch.trim().length > 0 && typeof value.commit === 'string' && /^[0-9a-f]{40}$/i.test(value.commit) && typeof value.systemVersion === 'string' && value.systemVersion.trim().length > 0; }
function isOriginReference(value: unknown): value is CharacterOriginReference { return isRecord(value) && typeof value.sourcePath === 'string' && isSafeSourcePath(value.sourcePath) && typeof value.identifier === 'string' && value.identifier.trim().length > 0 && typeof value.id === 'string' && value.id.trim().length > 0; }
function isCompatibleOrigin(ruleset: CharacterRuleset, origin: CharacterOriginReference): boolean { return origin.sourcePath.startsWith(ruleset === '2014' ? RACE_PREFIX : SPECIES_PREFIX); }
function isClassProgressions(value: unknown, ruleset: CharacterRuleset): value is ClassProgressionSelection[] { return Array.isArray(value) && value.every((entry) => isClassProgression(entry, ruleset)); }
function isClassProgression(value: unknown, ruleset?: CharacterRuleset): value is ClassProgressionSelection {
  if (!isRecord(value) || !isClassReference(value.class) || typeof value.targetLevel !== 'number' || !Number.isInteger(value.targetLevel) || !Array.isArray(value.selections)) return false;
  const targetLevel = value.targetLevel;
  if (targetLevel < 1) return false;
  const classReference = value.class;
  if (ruleset !== undefined && !classReference.sourcePath.startsWith(ruleset === '2014' ? 'packs/_source/classes/' : 'packs/_source/classes24/')) return false;
  if (value.subclass !== undefined && !isClassCompatibleSubclass(value.subclass, classReference)) return false;
  if (!value.selections.every(isClassAdvancementSelection)) return false;
  return true;
}
function isClassCompatibleSubclass(value: unknown, classReference: CharacterClassReference): boolean {
  if (!isSubclassReference(value)) return false;
  if (value.type !== 'subclass') return false;
  if (typeof value.classIdentifier === 'string') return value.classIdentifier === classReference.identifier;
  if (typeof value.classId === 'string') return value.classId === classReference.id;
  return true;
}
function isSubclassReference(value: unknown): value is { sourcePath: string } & Record<string, unknown> {
  return isRecord(value) && typeof value.sourcePath === 'string' && isSafeSourcePath(value.sourcePath) && typeof value.id === 'string' && value.id.trim().length > 0 && typeof value.type === 'string' && value.type.trim().length > 0 && (value.name === undefined || typeof value.name === 'string');
}
function isClassReference(value: unknown): value is CharacterClassReference { return isRecord(value) && typeof value.sourcePath === 'string' && isSafeSourcePath(value.sourcePath) && typeof value.identifier === 'string' && value.identifier.trim().length > 0 && typeof value.id === 'string' && value.id.trim().length > 0; }
function isBackgroundReference(value: unknown): value is CharacterBackgroundReference { return isRecord(value) && typeof value.sourcePath === 'string' && isSafeSourcePath(value.sourcePath) && typeof value.identifier === 'string' && value.identifier.trim().length > 0 && typeof value.id === 'string' && value.id.trim().length > 0; }
function isBackgroundChoices(value: unknown): value is BackgroundChoicesSelection {
  if (!isRecord(value) || Object.keys(value).length === 0 || Object.keys(value).some((key) => key !== 'languages' && key !== 'abilityScores' && key !== 'grantedFeat')) return false;
  if (value.languages !== undefined && (!Array.isArray(value.languages) || value.languages.length < 1 || new Set(value.languages).size !== value.languages.length || !value.languages.every((language) => isSafeLanguageSelector(language)))) return false;
  if (value.abilityScores !== undefined && !isBackgroundAbilitySelection(value.abilityScores)) return false;
  if (value.grantedFeat !== undefined && !isGrantedFeatSelection(value.grantedFeat)) return false;
  return value.languages !== undefined || value.abilityScores !== undefined || value.grantedFeat !== undefined;
}

function isGrantedFeatSelection(value: unknown): value is GrantedFeatSelection {
  if (!isRecord(value) || !hasOnlyKeys(value, ['feat', 'spellChoices']) || !isFoundrySourceReference(value.feat) || !Array.isArray(value.spellChoices)) return false;
  const keys = new Set<string>();
  return value.spellChoices.every((choice) => {
    if (!isRecord(choice) || typeof choice.key !== 'string' || choice.key.trim().length === 0 || keys.has(choice.key) || typeof choice.advancementId !== 'string' || choice.advancementId.trim().length === 0 || !Array.isArray(choice.selected)) return false;
    keys.add(choice.key);
    if (choice.kind === 'spell-list') return hasOnlyKeys(choice, ['key', 'advancementId', 'kind', 'selected']) && choice.selected.every((entry) => typeof entry === 'string' && entry.trim().length > 0) && new Set(choice.selected).size === choice.selected.length;
    if (choice.kind !== 'spell' || !hasOnlyKeys(choice, ['key', 'advancementId', 'kind', 'selected', 'selectedAbility']) || !choice.selected.every(isFoundrySourceReference) || choice.selected.some((entry) => entry.type !== 'spell') || choice.selectedAbility !== undefined && (typeof choice.selectedAbility !== 'string' || choice.selectedAbility.trim().length === 0)) return false;
    const refs = choice.selected.map((entry) => `${entry.sourcePath}:${entry.pack}:${entry.type}:${entry.id}`);
    return new Set(refs).size === refs.length;
  });
}
function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function sanitizeBackgroundChoices(value: BackgroundChoicesSelection): BackgroundChoicesSelection { return { ...(value.languages === undefined ? {} : { languages: [...value.languages] }), ...(value.abilityScores === undefined ? {} : { abilityScores: { advancementId: value.abilityScores.advancementId, assignments: { ...value.abilityScores.assignments } } }), ...(value.grantedFeat === undefined ? {} : { grantedFeat: sanitizeGrantedFeatSelection(value.grantedFeat) }) }; }
function sanitizeGrantedFeatSelection(selection: GrantedFeatSelection): GrantedFeatSelection { return { feat: sanitizeSourceReference(selection.feat), spellChoices: selection.spellChoices.map((choice) => choice.kind === 'spell-list' ? { key: choice.key, advancementId: choice.advancementId, kind: choice.kind, selected: [...choice.selected] } : { key: choice.key, advancementId: choice.advancementId, kind: choice.kind, selected: choice.selected.map(sanitizeSourceReference), ...(choice.selectedAbility === undefined ? {} : { selectedAbility: choice.selectedAbility }) }) }; }
function isBackgroundAbilitySelection(value: unknown): value is BackgroundAbilitySelection {
  if (!isRecord(value) || typeof value.advancementId !== 'string' || value.advancementId.trim().length === 0 || !isRecord(value.assignments)) return false;
  return Object.entries(value.assignments).every(([ability, amount]) => isAbility(ability) && typeof amount === 'number' && Number.isInteger(amount) && amount >= 0);
}
function isAbility(value: string): value is Ability { return (ABILITIES as readonly string[]).includes(value); }
function isSafeLanguageSelector(value: unknown): value is string { return typeof value === 'string' && /^languages:[a-z][a-z-]*(?::[a-z][a-z-]*)*$/.test(value); }
function isEquipmentSelection(value: unknown): value is EquipmentSelection { return isRecord(value) && isStringRecord(value.selected) && isReferenceRecord(value.semantic); }
function isStringRecord(value: unknown): value is Record<string, string> { return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string' && entry.length > 0); }
function isReferenceRecord(value: unknown): boolean { return isRecord(value) && Object.values(value).every(isFoundrySourceReference); }
function isAbilityScoreSelection(value: unknown): value is AbilityScoreSelection { return isRecord(value) && (value.method === 'standard-array' || value.method === 'point-buy' || value.method === 'dice-rolling') && isAbilityRecord(value.base) && isAbilityRecord(value.manual) && validateAbilityScores(value as unknown as AbilityScoreSelection).length === 0; }
function isStandardArrayDraft(value: unknown): value is StandardArrayDraft {
  if (!isRecord(value) || value.method !== 'standard-array' || !isRecord(value.base) || !isAbilityRecord(value.manual)) return false;
  const manual = value.manual;
  if (Object.keys(manual).length !== ABILITIES.length || !ABILITIES.every((ability) => ability in manual)) return false;
  const entries = Object.entries(value.base);
  const values = entries.map(([, score]) => score);
  return entries.every(([ability, score]) => ABILITIES.includes(ability as Ability) && typeof score === 'number' && [8, 10, 12, 13, 14, 15].includes(score)) && new Set(values).size === values.length;
}
function isRolledAbilityDraft(value: unknown): value is RolledAbilityDraft {
  if (!isRecord(value) || value.method !== 'dice-rolling' || !isRecord(value.base) || !isAbilityRecord(value.manual)) return false;
  const manual = value.manual;
  if (Object.keys(manual).length !== ABILITIES.length || !ABILITIES.every((ability) => ability in manual)) return false;
  return Object.entries(value.base).every(([ability, score]) => ABILITIES.includes(ability as Ability) && typeof score === 'number' && Number.isInteger(score) && score > 0);
}
function isPointBuyDraft(value: unknown): value is PointBuyDraft {
  if (!isRecord(value) || value.method !== 'point-buy' || !isRecord(value.base) || !isAbilityRecord(value.manual)) return false;
  const base = value.base as Record<string, unknown>;
  if (Object.keys(base).length !== ABILITIES.length || !ABILITIES.every((ability) => ability in base)) return false;
  return Object.entries(base).every(([ability, score]) => ABILITIES.includes(ability as Ability) && typeof score === 'number' && Number.isInteger(score) && score >= 8 && score <= 15) && pointBuyTotal(value.base as Record<Ability, number>) <= 27;
}
function isAbilityRecord(value: unknown): value is Record<string, number> { return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'number' && Number.isInteger(entry)); }
function isCompatibleBackground(ruleset: CharacterRuleset, background: CharacterBackgroundReference): boolean { return background.sourcePath.startsWith(ruleset === '2014' ? 'packs/_source/backgrounds/' : 'packs/_source/origins24/backgrounds/'); }
function isClassAdvancementSelection(value: unknown): boolean {
  if (!isRecord(value) || typeof value.advancementId !== 'string' || value.advancementId.trim().length === 0 || typeof value.kind !== 'string') return false;
  if (value.kind === 'trait') return isStringArray(value.selected) && isOptionalStringArray(value.configuredPool);
  if (value.kind === 'expertise') return value.mode === 'expertise' && isStringArray(value.selected) && isOptionalStringArray(value.configuredPool);
  if (value.kind === 'item') return isReferenceArray(value.selected) && isOptionalStringArray(value.configuredPool);
  if (value.kind === 'spell') return isReferenceArray(value.selected) && isOptionalStringArray(value.configuredPool) && (value.selectionRole === undefined || value.selectionRole === 'cantrips-known' || value.selectionRole === 'known-spells' || value.selectionRole === 'spellbook') && (value.ability === undefined || typeof value.ability === 'string') && (value.selectedAbility === undefined || typeof value.selectedAbility === 'string') && (value.count === undefined || typeof value.count === 'number' && Number.isInteger(value.count) && value.count >= 0) && (value.level === undefined || typeof value.level === 'number' && Number.isInteger(value.level) && (value.level >= 0 || value.level === -1 && value.selectionRole === 'spellbook' && typeof value.maxLevel === 'number' && Number.isInteger(value.maxLevel) && value.maxLevel >= 1)) && (value.maxLevel === undefined || typeof value.maxLevel === 'number' && Number.isInteger(value.maxLevel) && value.maxLevel >= 1) && isOptionalStringArray(value.spellLists);
  if (value.kind === 'subclass') return isReferenceArray(value.options) && (value.selected === undefined || isFoundrySourceReference(value.selected));
  if (value.kind === 'ability-score') return isNumberRecord(value.assignments) && typeof value.points === 'number' && Number.isInteger(value.points) && value.points >= 0 && assignmentsTotal(value.assignments) === value.points && isOptionalStringArray(value.locked) && isOptionalStringArray(value.allowedAbilities) && (value.cap === undefined || typeof value.cap === 'number') && (value.fixed === undefined || isNumberRecord(value.fixed)) && (value.recommendation === undefined || isNumberRecord(value.recommendation)) && (value.feat === undefined || isFoundrySourceReference(value.feat)) && isOptionalReferenceArray(value.featOptions);
  return false;
}
function isReferenceArray(value: unknown): boolean { return Array.isArray(value) && value.every(isFoundrySourceReference); }
function isOptionalReferenceArray(value: unknown): boolean { return value === undefined || isReferenceArray(value); }
function isStringArray(value: unknown): boolean { return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0); }
function isOptionalStringArray(value: unknown): boolean { return value === undefined || isStringArray(value); }
function isNumberRecord(value: unknown): value is Record<string, number> { return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0); }
function assignmentsTotal(value: Record<string, number>): number { return Object.values(value).reduce((sum, entry) => sum + entry, 0); }
function isSpeciesConfigurationSelection(value: unknown): value is SpeciesConfigurationSelection {
  if (!isRecord(value) || !isOriginReference(value.origin) || !isFoundryReference(value.foundry) || !Array.isArray(value.grants) || !value.grants.every(isSavedGrant) || !Array.isArray(value.choices)) return false;
  if (!value.choices.every((choice) => isRecord(choice) && typeof choice.key === 'string' && choice.key.length > 0 && isRecordReference(choice.source) && Array.isArray(choice.selected) && choice.selected.every((entry) => typeof entry === 'string' && entry.length > 0))) return false;
  if (value.size !== undefined && (!isRecord(value.size) || typeof value.size.advancementId !== 'string' || value.size.advancementId === '' || typeof value.size.selected !== 'string' || value.size.selected === '')) return false;
  if (value.spellcastingAbility !== undefined && (!isRecord(value.spellcastingAbility) || !Array.isArray(value.spellcastingAbility.advancementIds) || value.spellcastingAbility.advancementIds.length === 0 || !value.spellcastingAbility.advancementIds.every((id) => typeof id === 'string' && id.trim().length > 0) || new Set(value.spellcastingAbility.advancementIds).size !== value.spellcastingAbility.advancementIds.length || typeof value.spellcastingAbility.selected !== 'string' || value.spellcastingAbility.selected.trim().length === 0)) return false;
  return value.spellChoices === undefined || Array.isArray(value.spellChoices) && value.spellChoices.every(isSpeciesSpellChoiceSelection);
}
function isSpeciesSpellChoiceSelection(value: unknown): boolean {
  if (!isRecord(value) || typeof value.key !== 'string' || value.key.trim().length === 0 || typeof value.advancementId !== 'string' || value.advancementId.trim().length === 0 || !Array.isArray(value.selected)) return false;
  if (value.kind === 'spell-list') return value.selected.every((entry) => typeof entry === 'string' && entry.trim().length > 0) && new Set(value.selected).size === value.selected.length && value.selectedAbility === undefined;
  if (value.kind !== 'spell' || !value.selected.every(isFoundrySourceReference) || value.selected.some((entry) => isRecord(entry) && entry.type !== 'spell') || value.selectedAbility !== undefined && (typeof value.selectedAbility !== 'string' || value.selectedAbility.trim().length === 0)) return false;
  const keys = value.selected.map((entry) => isRecord(entry) ? `${entry.sourcePath}:${entry.pack}:${entry.type}:${entry.id}` : '');
  return new Set(keys).size === keys.length;
}
function isSavedGrant(value: unknown): boolean { return isRecord(value) && typeof value.key === 'string' && value.key.length > 0 && isRecordReference(value.source); }
function isRecordReference(value: unknown): value is { id: string; type: string; name?: string } { return isRecord(value) && typeof value.id === 'string' && value.id.trim().length > 0 && typeof value.type === 'string' && value.type.trim().length > 0 && (value.name === undefined || typeof value.name === 'string'); }
