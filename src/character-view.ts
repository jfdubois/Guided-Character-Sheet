import { ItemView, TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { parseCharacterDocument, withAbilityScores, withPointBuyDraft, withRolledAbilityDraft, withStandardArrayDraft, withBackground, withBackgroundAbilityScores, withBackgroundEquipment, withBackgroundGrantedFeat, withBackgroundLanguages, withClassEquipment, withClassProgression, withInventory, withMutableState, withName, withOrigin, withRuleset, withSpeciesConfiguration, type CharacterDocument, type CharacterRuleset } from './character-model';
import { calculateClassHitPoints, setClassHitPointGain, validateClassHitPoints, type ClassHitPointEntry } from './class-hit-points';
import type { CharacterStore } from './character-store';
import type { BackgroundSourceSummary, CharacterSourceOption, ClassAdvancementSummary, ClassSourceSummary, FoundrySourceReference, SourceIndex, SourceReader, SpeciesFeatureSummary, SpeciesSourceSummary } from './character-sources';
import { languageSelectorKey, languageSelectorLabel, languageSelectorOptions, type FoundryItemSummary, type FoundryLanguageOption, type FoundrySpellSummary, type SpellSearchFilters } from './foundry-source-catalog';
import { isRecord } from './foundry-utils';
import { buildClassConfiguration, getLevelOneDerivedSpellChoices, mergeClassSelection, restoreClassConfiguration, setClassSelection, toClassProgressionSelection, validateClassConfiguration, type ClassAdvancementSelection, type ClassConfiguration } from './class-configuration';
import { buildSpeciesConfiguration, FOUNDRY_SKILL_LABELS, getAvailableSpeciesSpellChoices, isDraconicResistanceChoice, isSpeciesChoiceAvailable, isSupportedSelector, restoreSpeciesConfiguration, setSpeciesChoice, setSpeciesSize, setSpeciesSpellChoice, setSpeciesSpellcastingAbility, validateSpeciesConfiguration, type SpeciesConfiguration } from './species-configuration';
import { applyInventoryItemChanges, emptyInventory, expandInventoryContainers, flattenSelectedEquipment, isFoundryInventoryEntry, replaceInventorySource, type EquipmentSelection, type InventoryItemChanges } from './inventory';
import { getEquipmentChoiceLabel, getEquipmentOptionContents, resolveStartingEquipmentItems, type EquipmentPackageNode, type EquipmentPackageSummary } from './equipment';
import { ABILITIES, calculateAbilityScores, canAffordPointBuyScore, collectAbilityBonuses, createDefaultAbilityScores, createPointBuyAbilityScores, createRolledAbilityDraft, createStandardArrayDraft, getAbilityScoreMethodOptions, isValidRolledBase, moveStandardArrayValue, pointBuyRemaining, sumAbilityBonuses, validateAbilityScores, type Ability, type AbilityScoreMethod, type AbilityScoreSelection, type PointBuyDraft, type RolledAbilityDraft, type StandardArrayDraft } from './ability-scores';
import { isSpellChoiceAvailable, setSpellChoice, setSpellcastingAbility, type SpellChoice, type SpellChoiceOption, type SpellChoiceSelection } from './spell-configuration';
import { getLevelOneClassProgression } from './level-one-progression';
import { projectClassLevelPreviewDocument, projectClassLevelProgression, trimClassProgression } from './class-level-progression';
import { adjustHitPoints, adjustMutableResourceCurrent, createFinalizedMutableCharacterState, type CharacterResource, type CharacterSpellUse } from './mutable-character-state';
import { HitPointAdjustmentModal } from './hit-point-adjustment-modal';
import { CurrencyModal } from './currency-modal';
import { applyCurrencyTransaction, type CurrencyDenomination, type CurrencyOperation } from './currency-transaction';
import { RestModal, type RestChoice } from './rest-modal';
import { applyLongRest } from './long-rest';
import { applyShortRest } from './short-rest';
import { applyLevelOne2024RestCompatibility, type LevelOne2024RestSource } from './rest-state-compatibility';
import { ManageSpellsModal, referenceKey as spellReferenceKey } from './manage-spells-modal';
import { ManageItemsModal } from './manage-items-modal';
import { mutableRecoveryProfiles, mutableResetForPeriod, recoverableResetForUses } from './resource-period';
import type { FoundryUsesSummary } from './foundry-activity-summary';
import { renderRepeatedDropdownChoice } from './selection-controls';
import { buildBackgroundAbilityConfiguration, createBackgroundAbilitySelection, validateBackgroundAbilitySelection, type BackgroundAbilityConfiguration, type BackgroundAbilitySelection } from './background-ability-configuration';
import { buildGrantedFeatConfiguration, getAvailableGrantedFeatSpellChoices, restoreGrantedFeatConfiguration, setGrantedFeatSpellChoice, setGrantedFeatSpellcastingAbility, toGrantedFeatSelection, validateGrantedFeatConfiguration, type GrantedFeatChoiceConfiguration, type GrantedFeatConfiguration, type GrantedFeatSelection } from './granted-feat-configuration';
import { isCharacterSheetSection, projectCharacterSheet, type CharacterSheetSection, type CharacterSheetSources } from './character-sheet-model';
import { renderCharacterSheet, type CharacterSheetCharacterOption } from './character-sheet-renderer';
import type { InventoryProjectionValue } from './inventory-sheet-model';
import { isFoundrySourceReference } from './foundry-source-reference';
import type { SourceSnapshot } from './source-tree';
import { collectExpertiseProficiencies, filterExpertiseCandidates, getExpertisePool, matchesAnySelector, validateExpertiseSelections } from './expertise-eligibility';
import { getEligibleSpeciesFeatures } from './species-feature-eligibility';
import { draconicSorceryHitPointsPerLevel } from './passive-effects';
import { getEligibleClassFeatures, getEligibleClassScales } from './class-feature-eligibility';
import { getEligibleClassProficiencies } from './class-proficiency-eligibility';
import { proficiencyBonusForLevel } from './proficiency-bonus';
import { renderFoundryOverview } from './foundry-overview-renderer';
import { isWeaponTrained, validateWeaponMasterySelections } from './weapon-training';
import { resolveFeatureScaleLookup } from './feature-damage-resolver';
import { buildClassLevelCards, getFirstIncompleteClassLevel, renderClassLevelCards } from './class-level-cards';
import { CharacterResetModal } from './character-reset-modal';
import { applyCharacterLevelDraft } from './character-level-change';

export const CHARACTER_VIEW_TYPE = 'guided-character-sheet';
type RestCompatibilityContext = LevelOne2024RestSource & { selectionSignature: string };
export function createAbilityScoreUpdate(selection: AbilityScoreSelection): (document: CharacterDocument) => CharacterDocument { const snapshot = structuredClone(selection); return (document) => withAbilityScores(document, snapshot); }

export type CharacterViewMode = 'create' | 'open';
export type CharacterViewState = { mode: 'create'; filePath: string } | { mode: 'open'; filePath?: string; section: CharacterSheetSection };
export type CharacterCreationSectionId = 'identity' | 'species' | 'class' | 'background' | 'ability-scores' | 'inventory';
export type CharacterCreationSectionStatus = 'complete' | 'active' | 'upcoming';
export interface CharacterCreationSection { id: CharacterCreationSectionId; label: string; status: CharacterCreationSectionStatus; }
export type CharacterRenderState =
  | { kind: 'ruleset'; options: ['2014', '2024'] }
  | { kind: 'origin'; label: 'Race' | 'Species'; options: CharacterSourceOption[] }
  | { kind: 'unavailable'; message: string };
export interface SpeciesRenderDependency { name: string; sourcePath: string; }
export interface SpeciesRenderEntry { level: number; type: string; hint: string; dependencies: SpeciesRenderDependency[]; }
export interface SpeciesFeatureRenderCallout { name: string; description?: string; sourcePath: string; }
export interface SpeciesTraitDisplayValue { label: string; value: string; }
export type SpeciesRenderState = { kind: 'species-summary'; name: string; sourcePath: string; description?: string; overviewHtml?: string; movement?: Record<string, unknown>; senses?: Record<string, unknown>; creatureType?: Record<string, unknown>; size?: { options: string[]; selected?: string; required: boolean }; features?: Array<SpeciesFeatureSummary & { selected?: boolean }>; automatic: SpeciesRenderEntry[]; pending: SpeciesRenderEntry[]; dependencies: SpeciesRenderDependency[]; unresolvedDependencies: string[]; unresolvedWarnings: string[] };
export interface SpeciesChoiceRenderControl { key: string; label: string; required: number; options: Array<{ value: string; label: string; description?: string; damageTypes?: string[] }>; selected: string[]; }
export interface SpeciesConfigurationRenderInput { choices?: SpeciesChoiceRenderControl[]; spellChoices?: SpellChoice[]; spellcastingAbility?: SpeciesConfiguration['spellcastingAbility']; warnings?: string[]; unresolvedWarnings?: string[]; }
export type ClassRenderState = { kind: 'class'; options: CharacterSourceOption[]; diagnostic?: string } | { kind: 'class-unavailable'; message: string } | { kind: 'class-summary'; name: string; sourcePath: string; hitDie: string; targetLevel: number; automatic: ClassAdvancementSummary[]; pending: ClassAdvancementSummary[]; dependencies: SpeciesRenderDependency[]; diagnostics: string[]; choices: ClassAdvancementSelection[]; proficiencies?: ClassSourceSummary['proficiencies']; features?: ClassSourceSummary['features']; scales?: ClassSourceSummary['scales']; startingEquipment?: EquipmentPackageSummary };
export interface ClassFeatureRenderCallout { name: string; level: number; description?: string; }
interface ClassChoiceDisplayOption { id: string; name: string; sourcePath: string; description?: string; source?: FoundrySourceReference; sourceSelector?: string; }
export type SpellCatalogQuery = (filters: { level?: number; maxLevel?: number; spellLists?: string[]; query?: string }) => Promise<SpellChoiceOption[]>;
interface SpellChoiceRenderOptions { showLabel?: boolean; showAbility?: boolean; }

export function getSpellChoiceQueryFilters(choice: SpellChoice): { level?: number; maxLevel?: number; spellLists?: string[] } {
  return { ...(choice.level < 0 ? {} : { level: choice.level }), ...(choice.maxLevel === undefined ? {} : { maxLevel: choice.maxLevel }), ...(choice.spellLists.length === 0 ? {} : { spellLists: [...choice.spellLists] }) };
}

export function mergeSpellSelections(selected: SpellChoiceSelection[], visibleOptions: SpellChoiceOption[], visibleValues: SpellChoiceSelection[]): SpellChoiceSelection[] {
  const visible = new Set(visibleOptions.map((option) => spellSelectionKey(option.source)));
  return [...selected.filter((value) => typeof value === 'string' || !visible.has(spellSelectionKey(value))), ...visibleValues.map((value) => typeof value === 'string' ? value : { ...value })];
}
export interface BackgroundFeatureRenderCallout { name: string; description?: string; }
export function getBackgroundLanguageOptions(summary: Pick<BackgroundSourceSummary, 'languages' | 'languageChoices'>): FoundryLanguageOption[] {
  const fixed = new Set(summary.languages.map(languageSelectorKey)); fixed.add('common');
  const seen = new Set<string>();
  return summary.languageChoices.flatMap((choice) => choice.pool.flatMap((pool) => languageSelectorOptions(pool))).filter((option) => { const key = languageSelectorKey(option.value); if (fixed.has(key) || seen.has(key)) return false; seen.add(key); return true; });
}
export function getKnownLanguageKeys(document: CharacterDocument, sources: CharacterSheetSources): Set<string> {
  const values = new Set<string>();
  const add = (value: unknown): void => { if (typeof value === 'string' && value.startsWith('languages:')) values.add(languageSelectorKey(value)); };
  for (const value of sources.background?.languages ?? []) add(value);
  for (const value of sources.class?.proficiencies?.languages ?? []) add(value);
  for (const value of getCurrentLevelSavedLanguageChoices(document, sources)) add(value);
  const targetLevel = document.classProgressions?.[0]?.targetLevel ?? 1;
  for (const advancement of sources.species?.advancements ?? []) if (advancement.level <= targetLevel) {
    const configured = advancement.raw.configuration;
    if (isRecord(configured) && Array.isArray(configured.grants)) for (const value of configured.grants) add(value);
  }
  for (const value of document.backgroundChoices?.languages ?? []) add(value);
  return values;
}
function getCurrentLevelSavedLanguageChoices(document: CharacterDocument, sources: CharacterSheetSources): string[] {
  const targetLevel = document.classProgressions?.[0]?.targetLevel ?? 1;
  const selected: string[] = [];
  for (const choice of document.speciesConfiguration?.choices ?? []) {
    const advancement = sources.species?.advancements.find((entry) => entry.id === choice.source.id);
    if (advancement !== undefined && advancement.level <= targetLevel) selected.push(...choice.selected);
  }
  for (const progression of document.classProgressions ?? []) for (const selection of progression.selections) {
    const advancement = sources.class?.advancements.find((entry) => entry.id === selection.advancementId);
    if (advancement === undefined || advancement.level > targetLevel || advancement.classRestriction !== undefined && advancement.classRestriction !== 'primary') continue;
    if ((selection.kind === 'trait' || selection.kind === 'expertise') && Array.isArray(selection.selected)) selected.push(...selection.selected);
  }
  return selected;
}
export function classChoiceDisplayOptionFromSource(item: FoundryItemSummary, selector: string, masteryDescriptions?: ReadonlyMap<string, string>): ClassChoiceDisplayOption {
  const selectorPrefix = selector.slice(0, -2);
  const masteryDescription = item.mastery === undefined ? undefined : masteryDescriptions?.get(item.mastery.toLocaleLowerCase());
  const description = masteryDescription ?? item.description;
  return { id: `${selectorPrefix}:${item.id}`, name: item.name, sourcePath: item.sourcePath, source: item, sourceSelector: selector, ...(description === undefined ? {} : { description }) };
}
export function getSelectedBackgroundLanguageValues(options: FoundryLanguageOption[], selected: string[]): string[] {
  const selectedKeys = new Set(selected.map(languageSelectorKey)); const seen = new Set<string>();
  return options.filter((option) => { const key = languageSelectorKey(option.value); if (!selectedKeys.has(key) || seen.has(key)) return false; seen.add(key); return true; }).map((option) => option.value);
}
export interface BackgroundAbilityControlState { eligibleAbilities: Array<{ value: Ability; label: string }>; modes: Array<{ value: 'balanced' | 'focused'; label: string }>; balancedChoiceCount: number; selectedMode?: 'balanced' | 'focused'; }
export function getBackgroundAbilityControlState(configuration: BackgroundAbilityConfiguration, selection: BackgroundAbilitySelection | undefined): BackgroundAbilityControlState {
  if (configuration.kind !== 'choice') return { eligibleAbilities: [], modes: [], balancedChoiceCount: 0 };
  const values = Object.values(selection?.assignments ?? {}); const selectedMode = values.includes(2) ? 'focused' : values.length === 3 ? 'balanced' : undefined;
  return { eligibleAbilities: configuration.eligibleAbilities.map((value) => ({ value, label: abilityLabel(value) })), modes: [{ value: 'balanced', label: 'Increase three abilities by 1' }, { value: 'focused', label: 'Increase one ability by 2 and another by 1' }], balancedChoiceCount: Math.min(3, configuration.eligibleAbilities.length), ...(selectedMode === undefined ? {} : { selectedMode }) };
}
export function renderBackgroundAbilityControls(root: HTMLElement, configuration: BackgroundAbilityConfiguration, selection: BackgroundAbilitySelection | undefined, onChange: (selection: BackgroundAbilitySelection) => void): void {
  if (configuration.kind === 'none') return; if (configuration.kind === 'unsupported') { root.createDiv({ text: configuration.reason, cls: 'guided-character-sheet__warning' }); return; }
  const state = getBackgroundAbilityControlState(configuration, selection); const section = root.createDiv({ cls: 'guided-character-sheet__background-ability' }); section.createEl('h4', { text: 'Ability score improvement' });
  const mode = section.createEl('select'); mode.createEl('option', { value: '', text: 'Select an increase mode' }).disabled = true;
  for (const option of state.modes) { const entry = mode.createEl('option', { value: option.value, text: option.label }); entry.selected = option.value === state.selectedMode; }
  const choices = section.createDiv({ cls: 'guided-character-sheet__background-ability-choices' }); const saved = selection?.assignments ?? {};
  const draw = (): void => { choices.empty(); if (mode.value === '') return; const count = mode.value === 'balanced' ? 3 : 2; const fields: HTMLSelectElement[] = []; for (let index = 0; index < count; index++) { const field = choices.createDiv({ cls: 'guided-character-sheet__choice' }); field.createEl('label', { text: mode.value === 'balanced' ? `Ability ${index + 1}` : index === 0 ? 'Ability +2' : 'Ability +1' }); const select = field.createEl('select'); fields.push(select); const savedAbility = mode.value === 'balanced' ? Object.keys(saved).filter((key) => saved[key as Ability] === 1)[index] : Object.entries(saved).find(([, value]) => value === (index === 0 ? 2 : 1))?.[0]; select.createEl('option', { value: '', text: 'Select an ability' }).disabled = true; for (const ability of configuration.eligibleAbilities) { const option = select.createEl('option', { value: ability, text: abilityLabel(ability) }); option.selected = ability === savedAbility; } select.addEventListener('change', () => { for (const other of fields) for (const option of Array.from(other.options)) option.disabled = option.value !== '' && fields.some((field) => field !== other && field.value === option.value); const values = fields.map((entry) => entry.value); if (values.some((value) => value === '') || new Set(values).size !== values.length) return; const assignments = mode.value === 'balanced' ? Object.fromEntries(values.map((value) => [value, 1])) : { [values[0]!]: 2, [values[1]!]: 1 }; try { onChange(createBackgroundAbilitySelection(configuration, assignments as Partial<Record<Ability, number>>)); } catch { /* retain incomplete controls */ } }); } };
  mode.addEventListener('change', () => { draw(); if (mode.value === 'balanced' && configuration.eligibleAbilities.length === 3) { try { onChange(createBackgroundAbilitySelection(configuration, Object.fromEntries(configuration.eligibleAbilities.map((ability) => [ability, 1])))); } catch { /* retain incomplete controls */ } } }); mode.value = state.selectedMode ?? ''; const initial = Array.from(mode.options).find((option) => option.value === ''); if (initial) initial.selected = state.selectedMode === undefined; draw();
}
export function renderBackgroundGrantedFeatControls(root: HTMLElement, configuration: GrantedFeatConfiguration, selection: GrantedFeatSelection | undefined, onChange: (selection: GrantedFeatSelection) => void): void {
  if (configuration.kind === 'none') return; if (configuration.kind === 'unsupported') { root.createDiv({ text: configuration.reason, cls: 'guided-character-sheet__warning' }); return; }
  let current = restoreGrantedFeatConfiguration(configuration, selection); if (current.kind !== 'choice') return;
  const redraw = (): void => {
    root.empty(); const choices = current.kind === 'choice' ? getAvailableGrantedFeatSpellChoices(current) : [];
    const handle = (next: SpellChoice[]): void => { const changed = next.find((entry) => current.kind === 'choice' && JSON.stringify(entry.selected) !== JSON.stringify(current.spellChoices.find((candidate) => candidate.key === entry.key)?.selected)); if (changed === undefined || current.kind !== 'choice') return; try { current = setGrantedFeatSpellChoice(current, changed.key, changed.selected); onChange(toGrantedFeatSelection(current)); redraw(); } catch { /* retain current selection */ } };
    const listChoice = choices[0]; if (listChoice !== undefined) { const field = root.createDiv({ cls: 'guided-character-sheet__spell-choice' }); const select = field.createEl('select'); const placeholder = select.createEl('option', { value: '', text: 'Select a spell list' }); placeholder.disabled = true; placeholder.selected = listChoice.selected.length === 0; for (const option of listChoice.options) { const element = select.createEl('option', { value: option.value, text: option.label }); element.selected = listChoice.selected.includes(option.value); } select.addEventListener('change', () => { try { current = setGrantedFeatSpellChoice(current as GrantedFeatChoiceConfiguration, listChoice.key, [select.value]); onChange(toGrantedFeatSelection(current)); redraw(); } catch { /* retain incomplete controls */ } }); }
    for (const choice of choices.slice(1)) renderSpellChoiceControls(root, choices, handle, undefined, false, choice.key, undefined, { showAbility: false });
    const abilityChoice = choices.slice(1).find((choice) => choice.abilityOptions.length > 0);
    if (abilityChoice !== undefined) { const field = root.createDiv({ cls: 'guided-character-sheet__spell-ability' }); field.createEl('label', { text: 'Spellcasting ability' }); const ability = field.createEl('select'); const placeholder = ability.createEl('option', { value: '', text: 'Select a spellcasting ability' }); placeholder.disabled = true; const savedAbility = choices.slice(1).find((choice) => choice.selectedAbility !== undefined)?.selectedAbility; placeholder.selected = savedAbility === undefined; for (const option of abilityChoice.abilityOptions) { const element = ability.createEl('option', { value: option, text: abilityLabel(option) }); element.selected = option === savedAbility; } ability.addEventListener('change', () => { if (current.kind !== 'choice') return; try { current = setGrantedFeatSpellcastingAbility(current, ability.value); onChange(toGrantedFeatSelection(current)); redraw(); } catch { /* retain incomplete controls */ } }); }
  };
  redraw();
}
export type BackgroundRenderState = { kind: 'background'; options: CharacterSourceOption[]; diagnostic?: string } | { kind: 'background-unavailable'; message: string } | { kind: 'background-summary'; name: string; sourcePath: string; ruleset: CharacterRuleset; description?: string; abilityScores?: BackgroundSourceSummary['abilityScores']; feat?: BackgroundSourceSummary['feat']; grantedFeat?: BackgroundSourceSummary['grantedFeat']; grantedFeats?: BackgroundSourceSummary['grantedFeats']; skills: string[]; languages: string[]; languageChoices: BackgroundSourceSummary['languageChoices']; tools: string[]; equipment: BackgroundSourceSummary['equipment']; features: BackgroundSourceSummary['features']; wealth?: string; startingEquipment?: EquipmentPackageSummary };

const CREATION_SECTION_LABELS: Array<{ id: CharacterCreationSectionId; label: string }> = [
  { id: 'identity', label: 'Identity' },
  { id: 'species', label: 'Species' },
  { id: 'class', label: 'Class' },
  { id: 'background', label: 'Background' },
  { id: 'ability-scores', label: 'Ability scores' },
  { id: 'inventory', label: 'Inventory' },
];

export function getCharacterCreationSections(document: CharacterDocument, _grantedFeatConfiguration?: GrantedFeatConfiguration | null): CharacterCreationSection[] {
  const complete = new Set<CharacterCreationSectionId>();
  if (document.ruleset !== null) complete.add('identity');
  if (document.origin !== undefined) complete.add('species');
  if (document.classProgressions?.length === 1) complete.add('class');
  let backgroundComplete = document.background !== undefined && (document.ruleset !== '2024' || document.backgroundChoices?.abilityScores !== undefined);
  const grantedFeatConfiguration = _grantedFeatConfiguration;
  if (backgroundComplete && document.ruleset === '2024' && (grantedFeatConfiguration !== undefined || document.backgroundChoices?.abilityScores !== undefined)) {
    if (document.backgroundChoices?.abilityScores === undefined) backgroundComplete = false;
    if (grantedFeatConfiguration === null) backgroundComplete = false;
    else if (grantedFeatConfiguration?.kind === 'unsupported') backgroundComplete = false;
    else if (grantedFeatConfiguration?.kind === 'choice') backgroundComplete = validateGrantedFeatConfiguration(restoreGrantedFeatConfiguration(grantedFeatConfiguration, document.backgroundChoices?.grantedFeat), { requireComplete: true }).length === 0;
  }
  if (backgroundComplete) complete.add('background');
  if (hasValidCreationAbilityScores(document)) complete.add('ability-scores');
  const activeId = CREATION_SECTION_LABELS.find(({ id }) => !complete.has(id) && id !== 'ability-scores' && id !== 'inventory')?.id;
  return CREATION_SECTION_LABELS.map(({ id, label }) => ({ id, label, status: complete.has(id) ? 'complete' : id === activeId ? 'active' : 'upcoming' }));
}

export function getBackgroundRenderState(document: CharacterDocument, summary: BackgroundSourceSummary | undefined, options?: CharacterSourceOption[]): BackgroundRenderState {
  if (summary === undefined) return options === undefined ? { kind: 'background-unavailable', message: document.background ? `Unable to resolve saved background source: ${document.background.sourcePath}` : 'Background sources are unavailable. Download the Foundry sources first.' } : { kind: 'background', options, ...(options.length === 0 ? { diagnostic: 'No backgrounds are available for this ruleset.' } : {}) };
  return { kind: 'background-summary', name: summary.source.name, sourcePath: summary.source.sourcePath, ruleset: summary.ruleset, ...(summary.description === undefined ? {} : { description: summary.description }), ...(summary.abilityScores === undefined ? {} : { abilityScores: summary.abilityScores }), ...(summary.feat === undefined ? {} : { feat: summary.feat }), ...(summary.grantedFeat === undefined ? {} : { grantedFeat: summary.grantedFeat }), ...(summary.grantedFeats === undefined ? {} : { grantedFeats: summary.grantedFeats }), skills: summary.skills, languages: summary.languages, languageChoices: summary.languageChoices, tools: summary.tools, equipment: summary.equipment, features: summary.features, ...(summary.wealth === undefined ? {} : { wealth: summary.wealth }), ...(summary.startingEquipment === undefined ? {} : { startingEquipment: summary.startingEquipment }) };
}

export function getBackgroundFeatureCallouts(state: Extract<BackgroundRenderState, { kind: 'background-summary' }>): BackgroundFeatureRenderCallout[] {
  const feats = state.grantedFeats ?? (state.grantedFeat === undefined ? [] : [state.grantedFeat]);
  return [...state.features.map((feature) => ({ name: feature.source.name, ...(feature.description === undefined ? {} : { description: feature.description }) })), ...feats.map((feat) => ({ name: feat.source.name, ...(feat.description === undefined ? {} : { description: feat.description }) }))];
}
type BackgroundOverview = { description?: string; abilityScores?: BackgroundSourceSummary['abilityScores']; skills: string[]; languages: string[]; tools: string[]; equipment?: BackgroundSourceSummary['equipment']; wealth?: string };
export function getBackgroundOverview(state: Extract<BackgroundRenderState, { kind: 'background-summary' }>): BackgroundOverview {
  if (state.ruleset === '2014') return { description: state.description, skills: state.skills, languages: state.languages, tools: state.tools, equipment: state.equipment, wealth: state.wealth };
  return { description: state.description, skills: state.skills.map(selectorLabel), languages: state.languages.map(backgroundLanguageLabel), tools: state.tools.map(selectorLabel) };
}

export function getClassRenderState(document: CharacterDocument, summary: ClassSourceSummary | undefined, configuration?: ClassConfiguration, options?: CharacterSourceOption[]): ClassRenderState {
  if (summary === undefined && configuration === undefined) return options === undefined ? { kind: 'class-unavailable', message: document.classProgressions?.[0] ? `Unable to resolve saved class source: ${document.classProgressions[0].class.sourcePath}` : 'Class sources are unavailable. Download the Foundry sources first.' } : { kind: 'class', options, ...(options.length === 0 ? { diagnostic: 'No classes are available for this ruleset.' } : {}) };
  if (summary === undefined || configuration === undefined) return { kind: 'class-unavailable', message: document.classProgressions?.[0] ? `Unable to resolve saved class source: ${document.classProgressions[0].class.sourcePath}` : 'Class configuration is unavailable for the selected source.' };
  const interactive = new Set(configuration.choices.map((choice) => choice.advancementId));
  const levelOne = summary.advancements.filter((entry) => entry.level <= configuration.targetLevel && (entry.classRestriction === undefined || entry.classRestriction === 'primary'));
  const dependency = (value: typeof summary.advancements[number]['dependencies'][number]): SpeciesRenderDependency | null => value.source ? { name: value.source.name, sourcePath: value.source.sourcePath } : null;
  const validChoices = new Set(levelOne.map((entry) => entry.id));
  for (const selection of configuration.selections) if (selection.advancementId.startsWith(`derived:${summary.source.sourcePath}:`)) validChoices.add(selection.advancementId);
  const projectionDocument = document.classProgressions?.some((progression) => progression.class.sourcePath === summary.source.sourcePath)
    ? document
    : { ...document, classProgressions: [toClassProgressionSelection(configuration)] };
  return { kind: 'class-summary', name: summary.source.name, sourcePath: summary.source.sourcePath, hitDie: summary.hitDie, targetLevel: configuration.targetLevel, automatic: levelOne.filter((entry) => !interactive.has(entry.id)), pending: levelOne.filter((entry) => interactive.has(entry.id)), dependencies: levelOne.flatMap((entry) => entry.dependencies.map(dependency).filter((value): value is SpeciesRenderDependency => value !== null)), diagnostics: [...new Set([...configuration.diagnostics, ...validateClassConfiguration(configuration, { class: configuration.class, summary, configuration })])], choices: configuration.choices.filter((choice) => validChoices.has(choice.advancementId)), proficiencies: getEligibleClassProficiencies(projectionDocument, summary), features: getEligibleClassFeatures(projectionDocument, summary), scales: getEligibleClassScales(projectionDocument, summary), ...(summary.startingEquipment === undefined ? {} : { startingEquipment: summary.startingEquipment }) };
}

export function getClassFeatureCallouts(state: ClassRenderState): ClassFeatureRenderCallout[] {
  if (state.kind !== 'class-summary') return [];
  return (state.features ?? []).map((feature) => ({ name: feature.source.name, level: feature.level, ...(feature.description === undefined ? {} : { description: feature.description }) }));
}
export function shouldRenderClassFeatureSelections(state: ClassRenderState): boolean { return state.kind === 'class-summary' && state.choices.length > 0; }

export function renderClassConfigurationControls(root: HTMLElement, configuration: ClassConfiguration, onChange: (configuration: ClassConfiguration, changedSelection?: ClassAdvancementSelection) => void, onlyAdvancementId?: string, spellQuery?: SpellCatalogQuery, resolvedPools?: Map<string, ClassChoiceDisplayOption[]>, expertiseProficiencies: readonly string[] = [], weaponTraining: readonly string[] = [], knownLanguages: ReadonlySet<string> = new Set()): void {
  const choices = onlyAdvancementId === undefined ? configuration.choices : configuration.choices.filter((choice) => choice.advancementId === onlyAdvancementId);
  for (const choice of choices) {
    if (choice.kind === 'spell') {
      const spellChoices = configuration.choices.filter((candidate): candidate is Extract<ClassAdvancementSelection, { kind: 'spell' }> => candidate.kind === 'spell').map((candidate) => toViewSpellChoice(configuration, candidate));
      renderSpellChoiceControls(root, spellChoices, (nextChoices) => {
        const updatedChoice = nextChoices.find((candidate) => candidate.key === choice.advancementId);
        if (updatedChoice === undefined) return;
        const next: ClassAdvancementSelection = { ...choice, selected: updatedChoice.selected.filter((value): value is FoundrySourceReference => typeof value !== 'string').map((value) => ({ ...value })), ...(updatedChoice.selectedAbility === undefined ? {} : { selectedAbility: updatedChoice.selectedAbility }) };
        const updated = setClassSelection(configuration, next);
        onChange(updated, updated.selections.find((entry) => entry.advancementId === choice.advancementId));
      }, spellQuery, true, choice.advancementId);
      continue;
    }
    if (choice.kind === 'ability-score') { root.createDiv({ text: `Unsupported level-1 class choice: ${choice.advancementId}`, cls: 'guided-character-sheet__warning' }); continue; }
    const field = root.createDiv({ cls: 'guided-character-sheet__choice' });
    field.createEl('label', { text: getClassChoiceLabel(configuration, choice) });
    const selected = choice.kind === 'trait' || choice.kind === 'expertise' ? choice.selected : choice.kind === 'subclass' ? (choice.selected ? [choice.selected.id] : []) : choice.selected.map((item) => item.id);
    const advancement = configuration.advancements.find((entry) => entry.id === choice.advancementId);
    const isMastery = choice.kind === 'trait' && isRecord(advancement?.raw.configuration) && advancement.raw.configuration.mode === 'mastery';
    const dependencies = advancement?.dependencies.filter((dependency) => dependency.source !== null) ?? [];
    const poolOptions: ClassChoiceDisplayOption[] = choice.kind === 'trait' || choice.kind === 'expertise'
      ? classTraitDisplayOptions(choice.configuredPool ?? [], resolvedPools?.get(choice.advancementId))
      : choice.kind === 'subclass'
        ? choice.options.map((option) => ({ ...option, source: option, description: dependencies.find((dependency) => dependency.source?.id === option.id)?.description }))
        : dependencies.flatMap((dependency) => dependency.source ? [{ ...dependency.source, source: dependency.source, ...(dependency.description === undefined ? {} : { description: dependency.description }) }] : []);
    const eligibleOptions = choice.kind === 'expertise'
      ? filterExpertiseCandidates(poolOptions, choice.configuredPool ?? [], expertiseProficiencies)
      : isMastery ? filterMasteryCandidates(poolOptions, weaponTraining) : poolOptions;
    const selectedLanguageKeys = new Set(selected.filter((value) => value.startsWith('languages:')).map(languageSelectorKey));
    const options = eligibleOptions.filter((option) => !option.id.startsWith('languages:') || !knownLanguages.has(languageSelectorKey(option.id)) || selectedLanguageKeys.has(languageSelectorKey(option.id)));
    const required = classChoiceCount(configuration, choice);
    const validIds = options.map((option) => option.id).concat(!isMastery && (choice.kind === 'trait' || choice.kind === 'expertise') ? (choice.configuredPool ?? []) : []);
    let updateDetails = (_values: string[]): void => undefined;
    renderRepeatedDropdownChoice(field, {
      count: required,
      options: options.map((option) => ({ value: option.id, label: option.name })),
      selected,
      ariaLabel: (index) => required === 1 ? getClassChoiceLabel(configuration, choice) : `${getClassChoiceHeading(configuration, choice)} ${index + 1} of ${required}`,
      unavailableLabel: (value) => isMastery ? `${selectorLabel(value)} (not eligible for Weapon Mastery)` : choice.kind === 'expertise' && matchesAnySelector(value, choice.configuredPool ?? [])
        ? `${selectorLabel(value)} (not proficient)`
        : validIds.includes(value) ? value : `${value} (invalid saved selection)`,
    }, (values) => {
      updateDetails(values);
      try {
        const next = choice.kind === 'trait' || choice.kind === 'expertise' ? { ...choice, selected: values } : choice.kind === 'subclass' ? { ...choice, selected: options.find((option) => option.id === values[0])?.source } : { ...choice, selected: options.filter((option) => values.includes(option.id)).map(toStoredClassOption) };
        const updated = setClassSelection(configuration, next as ClassAdvancementSelection);
        onChange(updated, updated.selections.find((entry) => entry.advancementId === choice.advancementId));
      } catch { /* preserve the invalid saved selection and its diagnostics */ }
    });
    updateDetails = renderClassChoiceDetails(field, options, selected);
  }
  const invalid = choices.flatMap((choice) => {
    const selected = classSelectionIds(choice);
    const valid = choice.kind === 'trait' || choice.kind === 'expertise' ? (choice.configuredPool ?? []) : choice.kind === 'subclass' ? choice.options.map((item) => item.id) : choice.kind === 'spell' ? (choice.options ?? []).map((option) => option.source.id) : configuration.advancements.find((entry) => entry.id === choice.advancementId)?.dependencies.flatMap((dependency) => dependency.source ? [dependency.source.id] : []) ?? [];
    const sourceWarnings = choice.kind === 'expertise'
      ? validateExpertiseSelections(selected, choice.configuredPool ?? [], expertiseProficiencies, selectorLabel)
      : [];
    return [
      ...selected.filter((value) => !valid.some((candidate) => candidate === value || candidate.endsWith(':*') && value.startsWith(candidate.slice(0, -1)))).map((value) => `Invalid saved class selection: ${choice.advancementId} (${value})`),
      ...sourceWarnings,
    ];
  });
  if (configuration.diagnostics.length > 0 || invalid.length > 0) { root.createEl('h4', { text: 'Warnings' }); const list = root.createEl('ul'); for (const warning of [...configuration.diagnostics, ...invalid]) list.createEl('li', { text: warning, cls: 'guided-character-sheet__warning' }); }
}

function classTraitDisplayOptions(configuredPool: string[], resolved: ClassChoiceDisplayOption[] | undefined): ClassChoiceDisplayOption[] {
  if (!configuredPool.includes('skills:*')) return resolved === undefined ? configuredPool.map((value) => ({ id: value, name: selectorLabel(value), sourcePath: '' })) : canonicalizeWildcardOptions(configuredPool, resolved);
  const skills = Object.entries(FOUNDRY_SKILL_LABELS).map(([id, name]) => ({ id: `skills:${id}`, name, sourcePath: '' }));
  const explicit = configuredPool.filter((value) => value !== 'skills:*').map((value) => ({ id: value, name: selectorLabel(value), sourcePath: '' }));
  return [...new Map([...skills, ...explicit, ...canonicalizeWildcardOptions(configuredPool, resolved ?? [])].map((option) => [option.id, option])).values()];
}

function filterMasteryCandidates(options: ClassChoiceDisplayOption[], training: readonly string[]): ClassChoiceDisplayOption[] {
  const eligible = options.filter((option) => {
    const source = option.source;
    return source !== undefined && 'itemType' in source && source.itemType === 'weapon'
      && 'magic' in source && source.magic === false
      && 'mastery' in source && typeof source.mastery === 'string' && source.mastery.trim().length > 0
      && isWeaponTrained(source as FoundryItemSummary, training) === true;
  });
  return [...new Map(eligible.map((option) => [option.id, option])).values()];
}

function classChoicePriority(choice: ClassAdvancementSelection): number {
  if (choice.kind === 'trait' && (choice.configuredPool ?? []).some((value) => /^(?:skills|tools?):/.test(value))) return 0;
  if (choice.kind === 'expertise') return 1;
  return 2;
}

function canonicalizeWildcardOptions(configuredPool: string[], options: ClassChoiceDisplayOption[]): ClassChoiceDisplayOption[] {
  return options.map((option) => {
    const selector = option.sourceSelector ?? configuredPool.find((value) => value.endsWith(':*') && option.source?.type === value.slice(0, value.indexOf(':')));
    if (selector === undefined || option.source === undefined) return option;
    return { ...option, id: `${selector.slice(0, -1)}${option.source.identifier ?? option.source.id}` };
  });
}

export function renderSpellChoiceControls(root: HTMLElement, choices: SpellChoice[], onChange: (choices: SpellChoice[]) => void, query?: SpellCatalogQuery, filterAvailable = true, onlyKey?: string, updateChoice: (choices: SpellChoice[], key: string, values: SpellChoiceSelection[]) => SpellChoice[] = setSpellChoice, options: SpellChoiceRenderOptions = {}): void {
  const available = filterAvailable ? choices.filter((choice) => isSpellChoiceAvailable(choice, choices)) : choices;
  for (const choice of available.filter((candidate) => onlyKey === undefined || candidate.key === onlyKey)) {
    const field = root.createDiv({ cls: 'guided-character-sheet__spell-choice' });
    if (options.showLabel !== false) field.createEl('label', { text: `${choice.label}${choice.count > 1 ? ` (choose ${choice.count})` : ''}` });
    let validOptions = choice.options.filter((option) => spellOptionMatchesChoice(option, choice));
    let selectedValues = [...choice.selected];
    const selects: HTMLSelectElement[] = [];
    const selectionDetails: HTMLElement[] = [];
    const updateDetails = (): void => {
      selectedValues.forEach((selected, index) => {
        const option = validOptions.find((candidate) => spellSelectionMatchesOption(choice, selected, candidate));
        const detail = selectionDetails[index];
        if (detail !== undefined) detail.textContent = option?.description ?? '';
      });
      for (let index = selectedValues.length; index < selectionDetails.length; index += 1) selectionDetails[index].textContent = '';
    };
    let staleDiagnostic: HTMLElement | undefined;
    const renderOptions = (): void => {
      const visibleOptions = validOptions.slice(0, 100);
      const listChoice = isSpellListChoice(choice);
      for (const [index, select] of selects.entries()) {
        select.textContent = '';
        const placeholder = select.createEl('option', { value: '', text: listChoice ? 'Select a spell list' : choice.count === 1 ? 'Select a spell' : `Select spell ${index + 1}` });
        placeholder.disabled = !listChoice;
        placeholder.selected = selectedValues[index] === undefined;
        for (const option of visibleOptions) {
          const alreadySelected = selectedValues.some((selected, selectedIndex) => selectedIndex !== index && spellSelectionMatchesOption(choice, selected, option));
          const element = select.createEl('option', { value: option.value, text: option.label });
          element.selected = spellSelectionMatchesOption(choice, selectedValues[index], option);
          element.disabled = alreadySelected;
        }
      }
      const stale = selectedValues.filter((value): value is FoundrySourceReference => typeof value !== 'string' && !validOptions.some((option) => spellSelectionKey(option.source) === spellSelectionKey(value)));
      if (stale.length > 0 && selects.length > 0) {
        for (const selected of stale) {
          const element = selects[stale.indexOf(selected)]?.createEl('option', { value: spellSelectionKey(selected), text: `${selected.name} (unavailable)` });
          if (element) { element.selected = true; element.disabled = true; }
        }
      }
    };
    for (let index = 0; index < choice.count; index += 1) {
      const select = field.createEl('select');
      select.multiple = false;
      selects.push(select);
      select.addEventListener('change', () => {
        const value = select.value;
        const option = validOptions.find((candidate) => candidate.value === value);
        if (option === undefined) return;
        const next = [...selectedValues];
        next[index] = isSpellListChoice(choice) ? option.value : option.source;
        selectedValues = next.filter((entry): entry is SpellChoiceSelection => entry !== undefined);
        try { onChange(updateChoice(choices, choice.key, selectedValues)); updateDetails(); updateStaleDiagnostic(); renderOptions(); } catch { /* keep the current state visible until it is valid */ }
      });
      selectionDetails.push(field.createDiv({ cls: 'guided-character-sheet__choice-detail' }));
    }
    renderOptions();
    updateDetails();
    if (query !== undefined && choice.options.length === 0) {
      void query(getSpellChoiceQueryFilters(choice)).then((options) => {
        validOptions = options.filter((option) => spellOptionMatchesChoice(option, choice));
        renderOptions();
        updateDetails();
        updateStaleDiagnostic();
      }).catch((error: unknown) => field.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' }));
    }
    if (options.showAbility !== false && choice.abilityOptions.length > 0) {
      const ability = field.createEl('select', { attr: { 'aria-label': `${choice.label} spellcasting ability` } });
      const placeholder = ability.createEl('option', { value: '', text: 'Select a spellcasting ability' });
      placeholder.disabled = true;
      placeholder.selected = choice.selectedAbility === undefined;
      for (const option of choice.abilityOptions) { const element = ability.createEl('option', { value: option, text: abilityLabel(option) }); element.selected = option === choice.selectedAbility; }
      ability.addEventListener('change', () => { try { onChange(setSpellcastingAbility(choices, choice.key, ability.value)); } catch { /* keep the current state visible until it is valid */ } });
    }
    const updateStaleDiagnostic = (): void => {
      const stale = selectedValues.filter((value) => typeof value !== 'string' && !validOptions.some((option) => spellSelectionKey(option.source) === spellSelectionKey(value)));
      if (stale.length === 0) { staleDiagnostic?.remove(); staleDiagnostic = undefined; return; }
      if (staleDiagnostic === undefined) staleDiagnostic = field.createDiv({ cls: 'guided-character-sheet__warning' });
      staleDiagnostic.textContent = `${stale.length} saved spell${stale.length === 1 ? '' : 's'} unavailable in the current source.`;
    };
    updateStaleDiagnostic();
  }
}

function toViewSpellChoice(configuration: ClassConfiguration, choice: Extract<ClassAdvancementSelection, { kind: 'spell' }>): SpellChoice {
  return {
    key: choice.advancementId,
    advancementId: choice.advancementId,
    label: getClassChoiceLabel(configuration, choice),
    count: choice.count ?? classChoiceCount(configuration, choice),
    level: choice.level ?? -1,
    ...(choice.maxLevel === undefined ? {} : { maxLevel: choice.maxLevel }),
    spellLists: [...(choice.spellLists ?? [])],
    selected: choice.selected.map((source) => ({ ...source })),
    abilityOptions: [...(choice.abilityOptions ?? [])],
    ...(choice.selectedAbility === undefined && choice.ability === undefined ? {} : { selectedAbility: choice.selectedAbility ?? choice.ability }),
    options: [...(choice.options ?? [])],
    raw: choice.raw ?? {},
  };
}

function spellOptionMatchesChoice(option: SpellChoiceOption, choice: SpellChoice): boolean {
  const source = option.source;
  const level = isSpellSummarySource(source) && typeof source.level === 'number' ? source.level : undefined;
  const lists = isSpellSummarySource(source) && Array.isArray(source.spellLists) ? source.spellLists : [];
  return (level === undefined || choice.level < 0 || level === choice.level) && (level === undefined || choice.maxLevel === undefined || level <= choice.maxLevel) && (choice.spellLists.length === 0 || lists.length === 0 || lists.some((list) => choice.spellLists.includes(list)));
}

function isSpellSummarySource(source: FoundrySourceReference): source is FoundrySourceReference & { level?: unknown; spellLists?: string[] } {
  return 'level' in source || 'spellLists' in source;
}

function isSpellListChoice(choice: SpellChoice): boolean {
  const rawConfiguration = isRecord(choice.raw.configuration) ? choice.raw.configuration : undefined;
  return choice.raw.type === 'spell-list' || choice.raw.selectorType === 'spell-list' || rawConfiguration?.type === 'spell-list';
}

function spellSelectionMatchesOption(choice: SpellChoice, selection: SpellChoiceSelection | undefined, option: SpellChoiceOption): boolean {
  return isSpellListChoice(choice)
    ? typeof selection === 'string' && selection === option.value
    : spellSelectionKey(selection) === spellSelectionKey(option.source);
}

function spellSelectionKey(value: string | FoundrySourceReference | undefined): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : `${value.sourcePath}:${value.pack}:${value.type}:${value.id}`;
}

export function renderClassChoiceDetails(field: HTMLElement, options: ClassChoiceDisplayOption[], selected: string[]): (values: string[]) => void {
  if (!options.some((option) => option.description !== undefined) || typeof field.createDiv !== 'function') return () => undefined;
  const details = field.createDiv({ cls: 'guided-character-sheet__choice-detail' });
  const update = (values: string[]): void => { details.textContent = options.filter((option) => values.includes(option.id)).flatMap((option) => option.description ? [option.description] : []).join('\n\n'); };
  update(selected);
  return update;
}
function toStoredClassOption(option: ClassChoiceDisplayOption): FoundrySourceReference {
  if (option.source === undefined) throw new Error(`Class choice source is unavailable: ${option.id}`);
  return { ...option.source };
}

function classSelectionIds(choice: ClassAdvancementSelection): string[] { if (choice.kind === 'trait' || choice.kind === 'expertise') return choice.selected; if (choice.kind === 'subclass') return choice.selected ? [choice.selected.id] : []; if (choice.kind === 'item' || choice.kind === 'spell') return choice.selected.map((item) => item.id); return []; }
export function getClassChoiceLabel(configuration: ClassConfiguration, choice: ClassAdvancementSelection): string {
  if (choice.kind === 'spell') {
    const roleLabels: Record<Extract<ClassAdvancementSelection, { kind: 'spell' }>['selectionRole'], string> = {
      'cantrips-known': 'Cantrips known',
      'known-spells': 'Known spells',
      spellbook: 'Spellbook',
    };
    const label = roleLabels[choice.selectionRole];
    return label;
  }
  const advancement = configuration.advancements.find((entry) => entry.id === choice.advancementId);
  const title = advancement?.title.trim();
  const category = choice.kind === 'trait' || choice.kind === 'expertise' ? selectorCategoryLabel(choice.configuredPool ?? []) : undefined;
  const label = title || category || (choice.kind === 'subclass' ? 'Subclass' : 'Class choice');
  const count = classChoiceCount(configuration, choice);
  return count > 1 ? `${label} — choose ${count}` : label;
}

export function getClassChoiceHeading(configuration: ClassConfiguration, choice: ClassAdvancementSelection): string {
  return getClassChoiceLabel(configuration, choice).replace(/ — choose \d+$/, '');
}
function selectorLabel(value: string): string {
  const [kind, code] = value.split(':', 2);
  if (kind === 'languages') return languageSelectorLabel(value) ?? value;
  if (kind === 'weapon' && value.split(':').length > 2) {
    const weapon = value.split(':').at(-1)!.replace(/[-_]/g, ' ');
    return weapon.toLocaleLowerCase() === 'handcrossbow' ? 'Hand Crossbow' : humanizeTraitLabel(weapon);
  }
  const labels: Record<string, Record<string, string>> = {
    skills: { acr: 'Acrobatics', ani: 'Animal Handling', arc: 'Arcana', ath: 'Athletics', dec: 'Deception', his: 'History', ins: 'Insight', itm: 'Intimidation', inv: 'Investigation', med: 'Medicine', nat: 'Nature', prc: 'Perception', prf: 'Performance', per: 'Persuasion', rel: 'Religion', slt: 'Sleight of Hand', ste: 'Stealth', sur: 'Survival' },
    armor: { lgt: 'Light armor', med: 'Medium armor', hvy: 'Heavy armor', shl: 'Shields' },
    weapon: { sim: 'Simple weapons', mar: 'Martial weapons' },
    tool: { art: "Calligrapher's supplies", thief: "Thieves' tools" },
    languages: { common: 'Common', elvish: 'Elvish', dwarvish: 'Dwarvish' },
    saves: { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' },
  };
  return kind === 'saves' && labels[kind]?.[code] ? `${labels[kind][code]} saving throws` : labels[kind]?.[code] ?? (kind === 'weapon' ? humanizeTraitLabel(code.replace(/[-_]/g, ' ')) : value);
}
function equipmentNodeLabel(node: EquipmentPackageNode): string {
  if (node.type === 'AND') return (node.children ?? []).map(equipmentNodeLabel).filter((value) => value.length > 0).join(', ') || 'Package';
  if (node.type === 'OR') return getEquipmentOptionContents(node).join(', ');
  if (node.type === 'linked') return node.item?.name ?? `Item ${node.key?.split('.').at(-1) ?? 'source'}`;
  if (node.type === 'currency') return node.currency ? `${node.currency.amount} ${node.currency.denomination.toUpperCase()}` : 'Currency';
  if (node.semantic) return `Choose ${node.semantic.category}`;
  return node.type;
}
function selectorCategoryLabel(values: string[]): string | undefined {
  const category = values.map((value) => value.split(':', 1)[0]).find((value) => value.length > 0);
  return { skills: 'Skill proficiencies', languages: 'Languages', armor: 'Armor proficiencies', weapon: 'Weapon proficiencies', tools: 'Tool proficiencies', saves: 'Saving throws' }[category ?? ''];
}


export function getCharacterRenderState(document: CharacterDocument, options?: CharacterSourceOption[]): CharacterRenderState {
  if (document.ruleset === null) return { kind: 'ruleset', options: ['2014', '2024'] };
  if (options === undefined) return { kind: 'unavailable', message: 'Source choices are unavailable. Download the Foundry sources first.' };
  return { kind: 'origin', label: document.ruleset === '2014' ? 'Race' : 'Species', options };
}

export function shouldConfirmRulesetReset(document: CharacterDocument): boolean {
  return document.ruleset !== null && (
    document.origin !== undefined || (document.classProgressions?.length ?? 0) > 0 || document.background !== undefined
    || document.speciesConfiguration !== undefined || document.backgroundChoices !== undefined || document.abilityScores !== undefined
    || document.abilityScoreDraft !== undefined || document.inventory !== undefined || document.classEquipment !== undefined
    || document.backgroundEquipment !== undefined || document.mutable !== undefined
  );
}

export function updateClassLevelDraft(
  document: CharacterDocument,
  summary: ClassSourceSummary,
  targetLevel: number,
  comparisonHitPoints: readonly ClassHitPointEntry[] = document.classHitPoints ?? [],
): { document: CharacterDocument; comparisonHitPoints: ClassHitPointEntry[] } {
  const progression = document.classProgressions?.[0];
  if (progression === undefined || progression.class.sourcePath !== summary.source.sourcePath) throw new Error('Class source is unavailable for this level draft.');
  const nextProgression = trimClassProgression(progression, summary, targetLevel);
  const candidateHitPoints = comparisonHitPoints.filter((entry) => entry.classSourcePath === summary.source.sourcePath && entry.level <= targetLevel).map((entry) => ({ ...entry }));
  const nextDocument: CharacterDocument = { ...document, classProgressions: [nextProgression] };
  if (validateClassHitPoints(candidateHitPoints, summary.source.sourcePath, summary.hitDie, targetLevel).length === 0) nextDocument.classHitPoints = candidateHitPoints;
  else delete nextDocument.classHitPoints;
  return { document: parseCharacterDocument(nextDocument), comparisonHitPoints: comparisonHitPoints.map((entry) => ({ ...entry })) };
}

export function getSelectedOriginId(document: CharacterDocument): string {
  return document.origin?.id ?? '';
}

export function getSpeciesRenderState(document: CharacterDocument, summary: SpeciesSourceSummary | undefined, configuration?: SpeciesConfiguration): (SpeciesRenderState & { grants?: SpeciesConfiguration['grants']; choices?: SpeciesChoiceRenderControl[]; warnings?: string[] }) | null {
  if (document.origin === undefined || (summary === undefined && configuration === undefined)) return null;
  const configurationWarnings = (value: SpeciesConfiguration): string[] => value.choices.filter((choice) => isSpeciesChoiceAvailable(choice, value)).flatMap((choice) => choice.selected.some((selected) => !choice.options.some((option) => option.value === selected)) ? [`Choice "${choice.key}" contains a disallowed value`] : []).concat(value.diagnostics);
  if (summary === undefined && configuration !== undefined) return { kind: 'species-summary', name: configuration.origin.identifier, sourcePath: configuration.origin.sourcePath, automatic: [], pending: [], dependencies: [], unresolvedDependencies: [], unresolvedWarnings: [], grants: configuration.grants, choices: configuration.choices.filter((choice) => isSpeciesChoiceAvailable(choice, configuration)).map((choice) => ({ key: choice.key, label: choice.label, required: choice.count, options: choice.options.map((option) => ({ value: option.value, label: option.label, ...(option.description === undefined ? {} : { description: option.description }) })), selected: choice.selected })), warnings: configurationWarnings(configuration) };
  if (summary === undefined) return null;
  const targetLevel = Math.max(1, (document.classProgressions ?? []).reduce((total, progression) => total + progression.targetLevel, 0));
  const automatic = summary.advancements.filter((entry) => entry.automatic && entry.level <= targetLevel);
  const pending = summary.advancements.filter((entry) => !entry.automatic && entry.level <= targetLevel);
  const toDependency = (dependency: typeof summary.advancements[number]['dependencies'][number]): SpeciesRenderDependency | null => dependency.source === null ? null : { name: dependency.source.name, sourcePath: dependency.source.sourcePath };
  const uniqueDependencies = (dependencies: SpeciesRenderDependency[]): SpeciesRenderDependency[] => {
    const seen = new Set<string>();
    return dependencies.filter((dependency) => {
      const key = dependency.sourcePath;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const toEntry = (entry: typeof summary.advancements[number]): SpeciesRenderEntry => ({ level: entry.level, type: entry.type, hint: entry.hint, dependencies: uniqueDependencies(entry.dependencies.map(toDependency).filter((dependency): dependency is SpeciesRenderDependency => dependency !== null)) });
  return {
    kind: 'species-summary', name: summary.source.name, sourcePath: summary.source.sourcePath,
    ...(summary.description === undefined ? {} : { description: summary.description }),
    ...(summary.overviewHtml === undefined ? {} : { overviewHtml: summary.overviewHtml }),
    ...(summary.movement === undefined ? {} : { movement: summary.movement }),
    ...(summary.senses === undefined ? {} : { senses: summary.senses }),
    ...(summary.creatureType === undefined ? {} : { creatureType: summary.creatureType }),
    ...(configuration?.size === undefined ? summary.size === undefined ? {} : { size: { options: [...summary.size.sizes], selected: summary.size.sizes.length === 1 ? summary.size.sizes[0] : undefined, required: summary.size.sizes.length > 1 } } : { size: { options: [...configuration.size.options], ...(configuration.size.selected === undefined ? {} : { selected: configuration.size.selected }), required: configuration.size.options.length > 1 } }),
    ...(summary.features === undefined ? {} : { features: getEligibleSpeciesFeatures(document, summary, targetLevel).map((feature) => ({ ...feature, ...(isSpeciesFeatureSelected(document, feature) ? { selected: true } : {}) })) }),
    automatic: automatic.map(toEntry), pending: pending.map(toEntry),
    dependencies: uniqueDependencies(summary.advancements.filter((entry) => entry.level <= targetLevel).flatMap((entry) => entry.dependencies.map(toDependency).filter((dependency): dependency is SpeciesRenderDependency => dependency !== null))),
    unresolvedDependencies: summary.advancements.flatMap((entry) => entry.dependencies.filter((dependency) => dependency.source === null && !isSupportedSelector(dependency.uuid)).map((dependency) => dependency.uuid)),
    unresolvedWarnings: summary.advancements.flatMap((entry) => entry.dependencies.filter((dependency) => dependency.source === null && !isSupportedSelector(dependency.uuid)).map((dependency) => `Unresolved dependency UUID: ${dependency.uuid}`)),
    ...(configuration === undefined ? {} : { grants: configuration.grants, choices: configuration.choices.filter((choice) => isSpeciesChoiceAvailable(choice, configuration)).map((choice) => ({ key: choice.key, label: choice.label, required: choice.count, options: choice.options.map((option) => ({ value: option.value, label: option.label, ...(option.description === undefined ? {} : { description: option.description }), ...(option.damageTypes === undefined ? {} : { damageTypes: option.damageTypes }) })), selected: choice.selected })), warnings: configurationWarnings(configuration) }),
  };
}

export function getSpeciesFeatureCallouts(state: SpeciesRenderState): SpeciesFeatureRenderCallout[] {
  return (state.features ?? []).filter((feature) => feature.automatic !== false || feature.selected === true).map((feature) => ({ name: feature.source.name, ...(feature.description === undefined ? {} : { description: feature.description }), sourcePath: feature.source.sourcePath }));
}

function isSpeciesFeatureSelected(document: CharacterDocument, feature: SpeciesFeatureSummary): boolean {
  const choices = document.speciesConfiguration?.choices ?? [];
  const selections = (feature.entitlements ?? [feature]).flatMap((entitlement) => entitlement.selection === undefined ? [] : [entitlement.selection]);
  if (selections.some(({ key, value }) => choices.some((choice) => choice.key === key && choice.selected.includes(value)))) return true;
  return document.speciesConfiguration?.grants.some((grant) => grant.source.id === feature.source.id && grant.source.type === feature.source.type) ?? false;
}

export function getVisibleSpeciesTraitValues(value: Record<string, unknown> | undefined): SpeciesTraitDisplayValue[] {
  if (value === undefined) return [];
  const units = typeof value.units === 'string' && value.units.trim().length > 0 ? value.units : undefined;
  return Object.entries(value).flatMap(([key, entry]) => {
    if (key === 'units' || entry === null || entry === undefined || entry === false || entry === '' || Array.isArray(entry) && entry.length === 0 || isEmptyObject(entry)) return [];
    return [{ label: humanizeTraitLabel(key), value: `${formatTraitValue(entry)}${units !== undefined && typeof entry === 'number' ? ` ${units}` : ''}` }];
  });
}

function isEmptyObject(value: unknown): boolean { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0; }
function formatTraitValue(value: unknown): string {
  if (Array.isArray(value)) return value.filter((entry) => entry !== null && entry !== undefined).map(formatTraitValue).join(', ');
  if (typeof value === 'object' && value !== null) return Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined).map(([key, entry]) => `${humanizeTraitLabel(key)}: ${formatTraitValue(entry)}`).join(', ');
  return String(value);
}
function humanizeTraitLabel(value: string): string { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase()); }

export function renderSpeciesChoiceControls(root: HTMLElement, choices: SpeciesChoiceRenderControl[], configuration: SpeciesConfiguration, onChange: (configuration: SpeciesConfiguration) => void, knownLanguages: ReadonlySet<string> = new Set()): void {
  const current = { value: configuration };
  root.createEl('h4', { text: 'Choose your options' });
  for (const choice of choices.filter((entry) => { const sourceChoice = current.value.choices.find((candidate) => candidate.key === entry.key); return sourceChoice === undefined || !isDraconicResistanceChoice(sourceChoice); })) {
    const field = root.createDiv({ cls: 'guided-character-sheet__choice' });
    field.createEl('label', { text: `${choice.label} (choose ${choice.required})` });
    let selectedDetails: HTMLElement | undefined;
    const renderSelectedDetails = (values: string[]): void => {
      const selectedOptions = choice.options.filter((option) => values.includes(option.value));
      const descriptions = selectedOptions.flatMap((option) => option.description ? [option.description] : []);
      const damageTypes = selectedOptions.flatMap((option) => option.damageTypes ?? []);
      if (damageTypes.length > 0) descriptions.push(`Resistance: ${damageTypes.map(humanizeTraitLabel).join(', ')}`);
      if (selectedDetails !== undefined) selectedDetails.textContent = descriptions.join('\n\n');
    };
    const selectedLanguageKeys = new Set(choice.selected.filter((value) => value.startsWith('languages:')).map(languageSelectorKey));
    const options = choice.options.filter((option) => !option.value.startsWith('languages:') || !knownLanguages.has(languageSelectorKey(option.value)) || selectedLanguageKeys.has(languageSelectorKey(option.value)));
    renderRepeatedDropdownChoice(field, {
      count: choice.required,
      options,
      selected: choice.selected,
      ariaLabel: (index) => choice.required === 1 ? choice.label : `${choice.label} ${index + 1} of ${choice.required}`,
      unavailableLabel: (value) => `${value} (invalid saved selection)`,
    }, (values) => {
      renderSelectedDetails(values);
      try { current.value = setSpeciesChoice(current.value, choice.key, values); onChange(current.value); } catch { /* keep invalid UI state visible until corrected */ }
    });
    selectedDetails = field.createDiv({ cls: 'guided-character-sheet__choice-detail' });
    renderSelectedDetails(choice.selected);
  }
}

function classChoiceCount(configuration: ClassConfiguration, choice: ClassAdvancementSelection): number {
  if (choice.kind === 'spell' && choice.count !== undefined) return choice.count;
  const advancement = configuration.advancements.find((entry) => entry.id === choice.advancementId);
  const config = advancement?.raw && typeof advancement.raw === 'object' && !Array.isArray(advancement.raw) ? (advancement.raw as Record<string, unknown>).configuration : undefined;
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return 1;
  const choices = (config as Record<string, unknown>).choices;
  if (Array.isArray(choices)) {
    const first = choices.find((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).count === 'number');
    return first && typeof (first as Record<string, unknown>).count === 'number' ? (first as Record<string, unknown>).count as number : 1;
  }
  return typeof choices === 'number' ? choices : 1;
}

function renderSpeciesSpellChoiceGroups(root: HTMLElement, choices: SpellChoice[], onChange: (choices: SpellChoice[]) => void): void {
  const updateChoice = (available: SpellChoice[], key: string, values: SpellChoiceSelection[]): SpellChoice[] => setSpellChoice(available.map((choice) => ({ ...choice, parent: undefined })), key, values);
  const listChoices = choices.filter(isSpellListChoice);
  for (const choice of listChoices) renderSpellChoiceControls(root, choices, onChange, undefined, false, choice.key, updateChoice);
  const dependentChoices = choices.filter((choice) => !isSpellListChoice(choice));
  const groups = new Map<string, SpellChoice[]>();
  for (const choice of dependentChoices) {
    const key = choice.parent?.key ?? choice.key;
    const group = groups.get(key) ?? [];
    group.push(choice);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const abilityChoice = group.find((choice) => choice.abilityOptions.length > 0);
    if (abilityChoice !== undefined) renderSpellcastingAbility(root, choices, abilityChoice, onChange);
    for (const choice of group) {
      root.createEl('h4', { text: `${choice.label}${choice.count > 1 ? ` (choose ${choice.count})` : ''}` });
      renderSpellChoiceControls(root, choices, onChange, undefined, false, choice.key, updateChoice, { showLabel: false, showAbility: false });
    }
  }
}

function renderSpellcastingAbility(root: HTMLElement, choices: SpellChoice[], choice: SpellChoice, onChange: (choices: SpellChoice[]) => void): void {
  const field = root.createDiv({ cls: 'guided-character-sheet__spell-ability' });
  field.createEl('label', { text: 'Spellcasting ability' });
  const ability = field.createEl('select', { attr: { 'aria-label': `${choice.label} spellcasting ability` } });
  const placeholder = ability.createEl('option', { value: '', text: 'Select a spellcasting ability' });
  placeholder.disabled = true;
  placeholder.selected = choice.selectedAbility === undefined;
  for (const option of choice.abilityOptions) {
    const element = ability.createEl('option', { value: option, text: abilityLabel(option) });
    element.selected = option === choice.selectedAbility;
  }
  ability.addEventListener('change', () => {
    try { onChange(setSpellcastingAbility(choices, choice.key, ability.value)); } catch { /* keep invalid spell state visible until corrected */ }
  });
}

export function renderSpeciesConfigurationControls(root: HTMLElement, state: SpeciesConfigurationRenderInput, configuration: SpeciesConfiguration, onChange: (configuration: SpeciesConfiguration) => void, knownLanguages: ReadonlySet<string> = new Set()): void {
  const configurationRef = { current: configuration };
  if (state.choices) renderSpeciesChoiceControls(root, state.choices, configurationRef.current, (next) => { configurationRef.current = next; onChange(next); }, knownLanguages);
  if (state.spellChoices) {
    const update = (nextChoices: SpellChoice[]): void => {
    const changed = nextChoices.find((choice) => {
      const previous = state.spellChoices?.find((candidate) => candidate.key === choice.key);
      return previous === undefined || JSON.stringify(previous.selected) !== JSON.stringify(choice.selected) || previous.selectedAbility !== choice.selectedAbility;
    });
    if (changed !== undefined) {
      try {
        const previous = state.spellChoices?.find((choice) => choice.key === changed.key);
        const abilityChanged = previous?.selectedAbility !== changed.selectedAbility && JSON.stringify(previous?.selected) === JSON.stringify(changed.selected);
        const next = abilityChanged && changed.selectedAbility !== undefined
          ? setSpeciesSpellcastingAbility(configurationRef.current, changed.key, changed.selectedAbility)
          : setSpeciesSpellChoice(configurationRef.current, changed.key, changed.selected);
        configurationRef.current = next;
        onChange(next);
      } catch { /* keep invalid spell state visible until corrected */ }
    }
    };
    renderSpeciesSpellChoiceGroups(root, state.spellChoices, update);
  }
  if (state.spellcastingAbility !== undefined && state.spellcastingAbility.options.length > 1) {
    const field = root.createDiv({ cls: 'guided-character-sheet__spell-ability' });
    field.createEl('label', { text: 'Species spellcasting ability' });
    const select = field.createEl('select', { attr: { 'aria-label': 'Species spellcasting ability' } });
    const placeholder = select.createEl('option', { value: '', text: 'Select a spellcasting ability' }); placeholder.disabled = true; placeholder.selected = state.spellcastingAbility.selected === undefined;
    for (const option of state.spellcastingAbility.options) { const element = select.createEl('option', { value: option, text: abilityLabel(option) }); element.selected = option === state.spellcastingAbility.selected; }
    select.addEventListener('change', () => { try { const next = setSpeciesSpellcastingAbility(configuration, 'species-spellcasting-ability', select.value); onChange(next); } catch { /* retain incomplete control */ } });
  }
  const warnings = [...(state.warnings ?? []), ...(state.unresolvedWarnings ?? [])];
  if (warnings.length > 0) {
    root.createEl('h4', { text: 'Warnings' });
    const list = root.createEl('ul');
    for (const warning of warnings) list.createEl('li', { text: warning, cls: 'guided-character-sheet__warning' });
  }
}

export class CharacterView extends ItemView {
  private readonly store: CharacterStore;
  private readonly sourceReader: SourceReader;
  private file: TFile | null = null;
  private document: CharacterDocument | null = null;
  private savedDocument: CharacterDocument | undefined;
  private completedEditMode = false;
  private inactiveClassHitPoints: ClassHitPointEntry[] = [];
  private draftClassHitPoints: ClassHitPointEntry[] = [];
  private draftApplyError: string | undefined;
  private pendingTimer: number | undefined;
  private pendingUpdate: ((document: CharacterDocument) => CharacterDocument) | undefined;
  private flushInProgress: Promise<void> | undefined;
  private queuedUpdateCount = 0;
  private writingUpdate = false;
  private lastWrittenDocument: CharacterDocument | undefined;
  private conflict = false;
  private viewState: CharacterViewState | null = null;
  private opened = false;
  private eventsRegistered = false;
  private activeSection: CharacterCreationSectionId | undefined;
  private classLevelPreview: { sourcePath: string; level: number } | undefined;

  constructor(leaf: WorkspaceLeaf, store: CharacterStore, sourceReader: SourceReader, sourceIndex: SourceIndex) {
    super(leaf);
    this.store = store;
    this.sourceReader = sourceReader;
    this.sourceIndex = sourceIndex;
    this.navigation = false;
  }
  private readonly sourceIndex: SourceIndex;

  getViewType(): string { return CHARACTER_VIEW_TYPE; }
  getDisplayText(): string { return this.document?.name ?? 'Character sheet'; }
  getIcon(): string { return 'user'; }
  getState(): Record<string, unknown> { return this.viewState === null ? { mode: 'open', section: 'abilities' } : { ...this.viewState }; }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    const normalized = normalizeCharacterViewState(state);
    if (normalized !== null) this.viewState = normalized;
    else if (isEmptyViewState(state)) this.viewState = { mode: 'open', section: 'abilities' };
    else throw new Error('Invalid character view state');
    if (this.opened) await this.loadFromState();
  }

  async onOpen(): Promise<void> {
    this.opened = true;
    if (!this.eventsRegistered) {
      this.eventsRegistered = true;
      this.registerEvent(this.app.vault.on('modify', (file) => { if (this.file !== null && file.path === this.file.path) void this.handleExternalModification(); }));
      this.registerEvent(this.app.vault.on('rename', (file) => { if (this.file !== null && file.path === this.file.path) { this.file = file instanceof TFile ? file : null; } }));
      this.registerEvent(this.app.vault.on('delete', (file) => { if (this.file !== null && file.path === this.file.path) { this.file = null; this.document = null; this.renderUnavailable('The character file was deleted.'); } }));
    }
    await this.loadFromState();
  }

  async onClose(): Promise<void> { this.opened = false; await this.flushPendingUpdate(); }

  private async loadFromState(): Promise<void> {
    const state = this.viewState;
    if (state === null || state.mode === 'open' && state.filePath === undefined) { this.file = null; this.document = null; await this.renderCharacterPicker(); return; }
    if (state.filePath === undefined) { this.renderUnavailable('This character view has no valid character file.'); return; }
    if (state.mode === 'open') { this.completedEditMode = false; this.savedDocument = undefined; this.inactiveClassHitPoints = []; this.draftClassHitPoints = []; this.draftApplyError = undefined; this.conflict = false; }
    const file = this.app.vault.getFileByPath(state.filePath);
    if (!(file instanceof TFile)) { this.renderUnavailable('The character file could not be found.'); return; }
    if (this.file?.path !== file.path) this.classLevelPreview = undefined;
    this.file = file;
    try {
      const loaded = await this.store.read(file);
      if ((this.completedEditMode || state.mode === 'create') && loaded.mutable !== undefined) {
        this.completedEditMode = true;
        this.savedDocument = structuredClone(loaded);
        const savedHitPoints = loaded.classHitPoints ?? (loaded.classProgressions?.[0] === undefined ? [] : [{ classSourcePath: loaded.classProgressions[0].class.sourcePath, level: 1, value: 'max' as const }]);
        this.inactiveClassHitPoints = structuredClone(loaded.classHitPoints ?? []);
        this.draftClassHitPoints = structuredClone(savedHitPoints);
        this.document = structuredClone(loaded);
      } else {
        this.document = loaded;
        if (!this.completedEditMode) this.savedDocument = undefined;
      }
      await this.render();
    } catch (error) { this.renderUnavailable(error instanceof Error ? error.message : String(error)); }
  }

  private async render(): Promise<void> {
    if (this.document === null) { await this.renderCharacterPicker(); return; }
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: 'guided-character-sheet' });
    if (this.viewState?.mode === 'open') { await this.renderOpenCharacterSheet(root); return; }
    root.createEl('h2', { text: this.document.name, cls: 'guided-character-sheet__name' });
    if (this.completedEditMode) this.renderEditDraftActions(root);
    root.createDiv({ text: 'Build your character one choice at a time.', cls: 'guided-character-sheet__step' });
    await this.renderCreationJourney(root);
  }

  private async renderOpenCharacterSheet(root: HTMLElement): Promise<void> {
    if (this.document === null || this.file === null) return;
    const [sources, characters] = await Promise.all([this.loadCharacterSheetSources(this.document), this.loadCharacterOptions()]);
    const section = this.viewState?.mode === 'open' ? this.viewState.section : 'abilities';
    const sheet = projectCharacterSheet(this.document, sources);
    const classSpellLists = this.classSpellLists(sources);
    renderCharacterSheet(root, sheet, {
      characters,
      selectedFilePath: this.file.path,
      selectedSection: section,
      onSelectCharacter: (filePath) => { void this.selectCharacter(filePath); },
      onEdit: () => { void this.editCharacter(); },
      onSectionChange: (nextSection) => { void this.selectSheetSection(nextSection); },
      onToggleEquipment: (entryId, equipped) => this.toggleEquipment(entryId, equipped),
      onManageCurrency: () => this.openCurrencyModal(),
      onManageItems: this.document.mutable === undefined ? undefined : () => this.openManageItems(),
      onToggleSpellSlot: (level, spent) => this.toggleSpellSlot(level, spent),
      onToggleSpellUse: (key, spent) => this.toggleSpellUse(key, spent),
      onManageSpells: classSpellLists.length > 0 ? () => this.openManageSpells(sources, classSpellLists) : undefined,
      onToggleSpellPreparation: (source, prepared) => {
        const row = [...(sheet.spells?.cantrips ?? []), ...(sheet.spells?.levels.flatMap((level) => level.spells) ?? [])].find((candidate) => candidate.source.kind === 'available' && spellReferenceKey(candidate.source.value) === spellReferenceKey(source));
        this.toggleSpellPreparation(source, prepared, row?.preparationBlockedReason);
      },
      onToggleFeatureResource: (key, spent) => this.toggleFeatureResource(key, spent),
      onToggleInspiration: (active) => this.toggleInspiration(active),
      onAdjustHitPoints: () => this.openHitPointAdjustment(),
      onRest: this.document.mutable === undefined ? undefined : () => this.openRest(sheet, sources),
    });
  }

  private classSpellLists(sources: CharacterSheetSources): string[] {
    const classSummary = sources.class;
    if (classSummary === undefined || classSummary.spellcasting?.progression === 'none') return [];
    const configured = getLevelOneClassProgression(classSummary).spellcasting?.spellLists ?? [];
    if (configured.length > 0) return configured;
    const identifier = classSummary.source.identifier?.trim().toLocaleLowerCase();
    return classSummary.spellcasting === undefined || identifier === undefined || identifier.length === 0 ? [] : [identifier];
  }

  private classManagedSpellReferences(document: CharacterDocument): FoundrySourceReference[] {
    const removed = new Set((document.mutable?.spellOverlay?.removed ?? []).map(spellReferenceKey));
    const result = new Map<string, FoundrySourceReference>();
    for (const progression of document.classProgressions ?? []) for (const selection of progression.selections) {
      if (selection.kind === 'spell' && ['cantrips-known', 'known-spells', 'spellbook'].includes(selection.selectionRole)) for (const reference of selection.selected) if (!removed.has(spellReferenceKey(reference))) result.set(spellReferenceKey(reference), reference);
    }
    for (const entry of document.mutable?.spellOverlay?.added ?? []) result.set(spellReferenceKey(entry.reference), entry.reference);
    return [...result.values()];
  }

  private openManageSpells(sources: CharacterSheetSources, spellLists = this.classSpellLists(sources)): void {
    const document = this.document;
    const ruleset = document?.ruleset;
    const classSummary = sources.class;
    if (document === null || document === undefined || ruleset === null || ruleset === undefined || classSummary === undefined || spellLists.length === 0) return;
    new ManageSpellsModal(this.app, this.sourceIndex, ruleset, spellLists, this.classManagedSpellReferences(document), (references) => {
      void this.applyManagedSpells(references, classSummary, spellLists).catch((error) => this.renderUnavailable(error instanceof Error ? error.message : String(error)));
    }).open();
  }

  private async applyManagedSpells(desired: FoundrySourceReference[], classSummary: ClassSourceSummary, spellLists = this.classSpellLists({ class: classSummary, warnings: [] })): Promise<void> {
    const document = this.document;
    if (document === null || document.mutable === undefined || document.classProgressions?.[0] === undefined || document.ruleset === null) return;
    const base = new Map<string, FoundrySourceReference>();
    for (const progression of document.classProgressions) for (const selection of progression.selections) if (selection.kind === 'spell' && ['cantrips-known', 'known-spells', 'spellbook'].includes(selection.selectionRole)) for (const reference of selection.selected) base.set(spellReferenceKey(reference), reference);
    const desiredMap = new Map(desired.map((reference) => [spellReferenceKey(reference), reference]));
    const existing = document.mutable.spellOverlay;
    const existingAdded = new Map((existing?.added ?? []).map((entry) => [spellReferenceKey(entry.reference), entry]));
    const previouslyManaged = new Set(this.classManagedSpellReferences(document).map(spellReferenceKey));
    const removed = [...base.entries()].filter(([key]) => !desiredMap.has(key)).map(([, reference]) => reference);
    const added: NonNullable<typeof existing>['added'] = [];
    for (const [key, reference] of desiredMap) {
      if (base.has(key)) continue;
      const prior = existingAdded.get(key);
      if (prior !== undefined) { added.push(prior); continue; }
      const matches = await this.sourceIndex.searchSpells({ ruleset: document.ruleset, query: reference.name, spellLists });
      const summary = matches.find((candidate) => spellReferenceKey(candidate) === key);
      if (summary === undefined || typeof summary.level !== 'number') throw new Error(`Unable to resolve added spell source: ${reference.name}.`);
      const spellcasting = getLevelOneClassProgression(classSummary).spellcasting;
      const ownership = summary.level === 0 ? 'cantrips-known' : spellcasting?.spellbookSpells !== undefined ? 'spellbook' : 'known-spells';
      added.push({ reference: { sourcePath: summary.sourcePath, pack: summary.pack, type: summary.type, id: summary.id, name: summary.name, ...(summary.identifier === undefined ? {} : { identifier: summary.identifier }) }, ownership });
    }
    const nextOverlay = added.length === 0 && removed.length === 0 ? undefined : { added, removed };
    const noLongerManaged = new Set([...previouslyManaged].filter((key) => !desiredMap.has(key)));
    this.queueUpdate((current) => {
      if (current.mutable === undefined) throw new Error('Mutable spell state is unavailable.');
      const { spellOverlay: _spellOverlay, ...mutable } = current.mutable;
      return withMutableState(current, { ...mutable, ...(nextOverlay === undefined ? {} : { spellOverlay: nextOverlay }), preparedSpells: current.mutable.preparedSpells.filter((spell) => !noLongerManaged.has(spellReferenceKey(spell))) });
    });
  }

  private toggleSpellPreparation(source: FoundrySourceReference, prepared: boolean, blockedReason?: string): void {
    if (prepared && blockedReason !== undefined) return;
    this.queueUpdate((document) => {
      if (document.mutable === undefined) throw new Error('Mutable spell state is unavailable.');
      const key = spellReferenceKey(source);
      const next = new Map(document.mutable.preparedSpells.map((spell) => [spellReferenceKey(spell), spell]));
      if (prepared) next.set(key, stableSpellReference(source)); else next.delete(key);
      return withMutableState(document, { ...document.mutable, preparedSpells: [...next.values()] });
    });
  }

  private openHitPointAdjustment(): void {
    const hitPoints = this.document?.mutable?.hitPoints;
    if (hitPoints === undefined) return;
    new HitPointAdjustmentModal(this.app, { ...hitPoints, temporary: hitPoints.temporary ?? 0 }, (operation, amount) => this.applyHitPointAdjustment(operation, amount)).open();
  }

  private applyHitPointAdjustment(operation: Parameters<typeof adjustHitPoints>[1], amount: number): void {
    this.queueUpdate((document) => {
      const current = document.mutable?.hitPoints;
      if (current === undefined || document.mutable === undefined) throw new Error('Mutable hit-point state is unavailable.');
      return withMutableState(document, { ...document.mutable, hitPoints: adjustHitPoints(current, operation, amount) });
    });
  }

  private openCurrencyModal(): void {
    const currency = this.document?.mutable?.inventory.currency;
    if (currency === undefined) return;
    new CurrencyModal(this.app, { ...currency }, (operation, denomination, amount) => this.applyCurrencyChange(operation, denomination, amount)).open();
  }

  private openManageItems(): void {
    const document = this.document;
    if (document?.mutable === undefined || document.ruleset === null) return;
    new ManageItemsModal(this.app, this.sourceIndex, document.ruleset, document.mutable.inventory.items, (changes) => this.applyManagedItems(changes)).open();
  }

  private applyManagedItems(changes: InventoryItemChanges): void {
    this.queueUpdate((document) => {
      if (document.mutable === undefined || document.ruleset === null) throw new Error('Mutable inventory is unavailable.');
      if (changes.added.some(({ source }) => source.ruleset !== document.ruleset && !(document.ruleset === '2024' && source.ruleset === '2014' && source.pack === 'dnd5e.items'))) throw new Error('Item ruleset does not match the character.');
      const inventory = applyInventoryItemChanges(document.mutable.inventory, changes);
      const removed = new Set(changes.removedEntryIds);
      const entryIds = new Set(inventory.items.map((entry) => entry.entryId));
      const equipmentStatus = document.mutable.equipmentStatus.filter((status) => !removed.has(status.entryId) && entryIds.has(status.entryId)).map((status) => ({ ...status }));
      const statusIds = new Set(equipmentStatus.map((status) => status.entryId));
      for (const entry of inventory.items) if (!statusIds.has(entry.entryId)) equipmentStatus.push({ entryId: entry.entryId, equipped: false, attuned: false });
      return withMutableState(document, { ...document.mutable, inventory, equipmentStatus });
    });
  }

  private applyCurrencyChange(operation: CurrencyOperation, denomination: CurrencyDenomination, amount: number): void {
    this.queueUpdate((document) => {
      if (document.mutable === undefined) throw new Error('Mutable currency is unavailable.');
      const inventory = document.mutable.inventory;
      const currency = applyCurrencyTransaction(inventory.currency, operation, denomination, amount);
      return withMutableState(document, { ...document.mutable, inventory: { ...inventory, currency } });
    });
  }

  private openRest(sheet: ReturnType<typeof projectCharacterSheet>, sources: CharacterSheetSources): void {
    const mutable = this.document?.mutable;
    if (mutable === undefined) return;
    const compatibilitySource = this.restCompatibilitySource(sources);
    const compatibility = compatibilitySource === undefined ? undefined : applyLevelOne2024RestCompatibility(mutable, compatibilitySource);
    const previewState = compatibility?.state ?? mutable;
    const constitution = sheet.abilities.find((ability) => ability.key === 'con')?.modifier;
    new RestModal(this.app, previewState, { allowShortRest: this.document?.ruleset === '2024', ...(constitution?.kind === 'available' ? { constitutionModifier: constitution.value } : {}), ...(compatibility?.updateCount ? { compatibilityUpdateCount: compatibility.updateCount } : {}) }, (choice) => this.completeRest(choice, compatibilitySource)).open();
  }

  private completeRest(choice: RestChoice, compatibilitySource?: RestCompatibilityContext): void {
    this.queueUpdate((document) => {
      if (document.mutable === undefined) throw new Error('Mutable character state is unavailable.');
      if (choice.type === 'short' && document.ruleset !== '2024') throw new Error('Short Rest automation is available only for 2024 characters.');
      const mutable = compatibilitySource === undefined ? document.mutable : this.applyRestCompatibilityToLatestDocument(document, compatibilitySource);
      return withMutableState(document, choice.type === 'long' ? applyLongRest(mutable).state : applyShortRest(mutable, choice.input).state);
    });
  }

  private restCompatibilitySource(sources: CharacterSheetSources): RestCompatibilityContext | undefined {
    const document = this.document;
    const progression = document?.classProgressions?.[0];
    const classSummary = sources.class;
    if (document?.ruleset !== '2024' || progression?.targetLevel !== 1 || classSummary === undefined || progression.class.sourcePath !== classSummary.source.sourcePath || !/^d(?:4|6|8|10|12)$/.test(classSummary.hitDie)) return undefined;
    const completeSources = sources.species !== undefined && sources.background !== undefined;
    const proficiencyBonus = proficiencyBonusForLevel(1) ?? 2;
    return {
      classSourcePath: classSummary.source.sourcePath,
      classHitDie: classSummary.hitDie,
      characterLevel: 1,
      spellSlots: getLevelOneClassProgression(classSummary).spellcasting?.spellSlots ?? [],
      ...(completeSources ? {
        resources: collectFinalizationResources(document, classSummary, sources.species!, sources.background!, proficiencyBonus),
        spellUses: collectFinalizationSpellUses(document, classSummary, sources.species!, 1, sources.background!, proficiencyBonus),
      } : {}),
      selectionSignature: restSelectionSignature(document),
    };
  }

  private applyRestCompatibilityToLatestDocument(document: CharacterDocument, source: RestCompatibilityContext) {
    const progression = document.classProgressions?.[0];
    if (document.ruleset !== '2024' || progression?.targetLevel !== 1 || progression.class.sourcePath !== source.classSourcePath || restSelectionSignature(document) !== source.selectionSignature) throw new Error('The character sources or selections changed while the Rest modal was open.');
    return applyLevelOne2024RestCompatibility(document.mutable!, source).state;
  }

  private toggleSpellSlot(level: number, spent: boolean): void {
    this.queueUpdate((document) => {
      if (document.mutable?.spellSlots === undefined) throw new Error('Mutable spell-slot state is unavailable.');
      const slot = document.mutable.spellSlots.find((candidate) => candidate.level === level);
      if (slot === undefined) throw new Error(`Spell-slot level ${level} is unavailable.`);
      const next = adjustMutableResourceCurrent(slot.current, slot.maximum, spent ? -1 : 1);
      return withMutableState(document, { ...document.mutable, spellSlots: document.mutable.spellSlots.map((candidate) => candidate.level === level ? { ...candidate, current: next } : candidate) });
    });
  }

  private toggleSpellUse(key: string, spent: boolean): void {
    this.queueUpdate((document) => {
      if (document.mutable?.spellUses === undefined) throw new Error('Mutable spell-use state is unavailable.');
      const use = document.mutable.spellUses.find((candidate) => candidate.key === key);
      if (use === undefined) throw new Error(`Spell use ${key} is unavailable.`);
      const next = adjustMutableResourceCurrent(use.current, use.maximum, spent ? -1 : 1);
      return withMutableState(document, { ...document.mutable, spellUses: document.mutable.spellUses.map((candidate) => candidate.key === key ? { ...candidate, current: next } : candidate) });
    });
  }

  private toggleFeatureResource(key: string, spent: boolean): void {
    this.queueUpdate((document) => {
      if (document.mutable === undefined) throw new Error('Mutable feature resource state is unavailable.');
      const resource = document.mutable.resources.find((candidate) => candidate.key === key);
      if (resource === undefined) throw new Error(`Feature resource ${key} is unavailable.`);
      const next = adjustMutableResourceCurrent(resource.current, resource.maximum, spent ? -1 : 1);
      return withMutableState(document, { ...document.mutable, resources: document.mutable.resources.map((candidate) => candidate.key === key ? { ...candidate, current: next } : candidate) });
    });
  }

  private toggleInspiration(active: boolean): void {
    this.queueUpdate((document) => {
      if (document.mutable === undefined) throw new Error('Mutable inspiration state is unavailable.');
      return withMutableState(document, { ...document.mutable, inspiration: active });
    });
  }

  private toggleEquipment(entryId: string, equipped: boolean): void {
    this.queueUpdate((document) => {
      if (document.mutable === undefined) throw new Error('Mutable equipment state is unavailable.');
      const matches = document.mutable.equipmentStatus.filter((status) => status.entryId === entryId);
      if (matches.length !== 1) throw new Error(`Equipment status is ${matches.length === 0 ? 'missing' : 'duplicated'} for ${entryId}.`);
      return withMutableState(document, {
        ...document.mutable,
        equipmentStatus: document.mutable.equipmentStatus.map((status) => status.entryId === entryId ? { ...status, equipped } : status),
      });
    });
    void this.flushPendingUpdate();
  }

  private async loadCharacterOptions(): Promise<CharacterSheetCharacterOption[]> {
    const options: CharacterSheetCharacterOption[] = [];
    for (const file of await this.store.list()) {
      const document = await this.store.read(file);
      options.push({ filePath: file.path, name: document.name });
    }
    return options;
  }

  private async loadCharacterSheetSources(document: CharacterDocument): Promise<CharacterSheetSources> {
    const sources: CharacterSheetSources = { warnings: [] };
    const ruleset = document.ruleset;
    if (ruleset === null) return sources;
    const loadSpecies = async (): Promise<void> => {
      if (document.origin === undefined) return;
      try { sources.species = await this.sourceIndex.getSpeciesSummary(ruleset, document.origin.sourcePath); }
      catch { sources.warnings.push('Species source unavailable.'); }
    };
    const loadClass = async (): Promise<void> => {
      const progression = document.classProgressions?.[0];
      if (progression === undefined) return;
      try { sources.class = await this.sourceIndex.getClassSummary(ruleset, progression.class.sourcePath); }
      catch { sources.warnings.push('Class source unavailable.'); }
    };
    const loadBackground = async (): Promise<void> => {
      if (document.background === undefined) return;
      try { sources.background = await this.sourceIndex.getBackgroundSummary(ruleset, document.background.sourcePath); }
      catch { sources.warnings.push('Background source unavailable.'); }
    };
    const loadInventory = async (): Promise<void> => {
      if (document.mutable === undefined) return;
      const inventoryItems = new Map<string, InventoryProjectionValue<FoundryItemSummary>>();
      const inventoryWarnings: string[] = [];
      sources.inventoryItems = inventoryItems;
      sources.inventoryWarnings = inventoryWarnings;
      await Promise.all(document.mutable.inventory.items.map(async (entry) => {
        if (!isFoundryInventoryEntry(entry)) return;
        const warning = `Inventory source unavailable for ${entry.source.name}.`;
        try {
          const summary = await this.sourceIndex.getItemSummary(ruleset, entry.source.sourcePath);
          if (summary === null) {
            inventoryItems.set(entry.entryId, { kind: 'missing', reason: warning });
            inventoryWarnings.push(warning);
            return;
          }
          inventoryItems.set(entry.entryId, { kind: 'available', value: summary });
        } catch {
          inventoryItems.set(entry.entryId, { kind: 'missing', reason: warning });
          inventoryWarnings.push(warning);
        }
      }));
    };
    const loadSpells = async (): Promise<void> => {
      const references = [
        ...(document.classProgressions?.flatMap((progression) => progression.selections.filter((selection): selection is Extract<typeof selection, { kind: 'spell' }> => selection.kind === 'spell').flatMap((selection) => selection.selected)) ?? []),
        ...(document.speciesConfiguration?.spellChoices?.filter((choice): choice is Extract<typeof choice, { kind: 'spell' }> => choice.kind === 'spell').flatMap((choice) => choice.selected) ?? []),
        ...(sources.species?.spellGrants?.filter((grant) => grant.level <= (document.classProgressions?.[0]?.targetLevel ?? 1)).flatMap((grant) => grant.spells) ?? []),
        ...(document.backgroundChoices?.grantedFeat?.spellChoices?.filter((choice) => choice.kind === 'spell').flatMap((choice) => choice.selected.filter(isFoundrySourceReference)) ?? []),
        ...(document.mutable?.preparedSpells ?? []),
        ...(document.mutable?.spellOverlay?.added.map((entry) => entry.reference) ?? []),
      ];
      const unique = new Map(references.map((reference) => [`${reference.sourcePath}:${reference.pack}:${reference.type}:${reference.id}`, reference]));
      const summaries = new Map<string, FoundrySpellSummary>();
      sources.spellSummaries = summaries;
      await Promise.all([...unique.values()].map(async (reference) => {
        const warning = `Spell source unavailable for ${reference.name}.`;
        try {
          const matches = await this.sourceIndex.searchSpells({ ruleset, query: reference.name });
          const summary = matches.find((candidate) => candidate.sourcePath === reference.sourcePath && candidate.pack === reference.pack && candidate.type === reference.type && candidate.id === reference.id);
          if (summary === undefined) { sources.warnings.push(warning); return; }
          summaries.set(`${summary.sourcePath}:${summary.pack}:${summary.type}:${summary.id}`, summary);
          summaries.set(`${summary.pack}:${summary.type}:${summary.id}`, summary);
        } catch { sources.warnings.push(warning); }
      }));
    };
    const loadSelectedFeatSummaries = async (): Promise<void> => {
      const references = (document.classProgressions ?? []).flatMap((progression) => progression.selections.flatMap((selection) => {
        if (selection.kind === 'ability-score' && selection.feat !== undefined) return [selection.feat];
        if (selection.kind === 'item') return selection.selected.filter((source) => source.type === 'feat');
        return [];
      }));
      if (references.length === 0) return;
      const summaries = new Map<string, NonNullable<BackgroundSourceSummary['grantedFeat']> | null>();
      sources.selectedFeatSummaries = summaries;
      await Promise.all(references.map(async (reference) => {
        const key = `${reference.sourcePath}:${reference.pack}:${reference.type}:${reference.id}`;
        try { summaries.set(key, await this.sourceIndex.getFeatSummary(reference, ruleset)); }
        catch { summaries.set(key, null); }
      }));
    };
    const loadToolLabels = async (): Promise<void> => {
      const selectors = new Set<string>();
      const add = (value: string): void => {
        const normalized = value.toLocaleLowerCase().replace(/^tools:/, 'tool:');
        if (normalized.startsWith('tool:') && !normalized.endsWith(':*') && normalized !== 'tool:*') selectors.add(normalized);
      };
      for (const value of getEligibleClassProficiencies(document, sources.class)?.tools ?? []) add(value);
      for (const value of sources.background?.tools ?? []) add(value);
      for (const selection of document.classProgressions?.flatMap((progression) => progression.selections) ?? []) if ('selected' in selection && Array.isArray(selection.selected)) for (const value of selection.selected) if (typeof value === 'string') add(value);
      for (const choice of document.speciesConfiguration?.choices ?? []) for (const value of choice.selected) add(value);
      sources.toolLabels = await resolveToolLabels(this.sourceIndex, selectors, ruleset);
    };
    await loadSpecies();
    await Promise.all([
      loadClass(),
      loadBackground(),
      loadInventory(),
      loadSpells(),
      loadSelectedFeatSummaries(),
    ]);
    await loadToolLabels();
    const weaponSelectors = new Set(getEligibleClassProficiencies(document, sources.class)?.weapons ?? []);
    for (const selection of document.classProgressions?.flatMap((progression) => progression.selections) ?? []) if ('selected' in selection && Array.isArray(selection.selected)) for (const value of selection.selected) if (typeof value === 'string' && value.startsWith('weapon:')) weaponSelectors.add(value);
    for (const choice of document.speciesConfiguration?.choices ?? []) for (const value of choice.selected) if (value.startsWith('weapon:')) weaponSelectors.add(value);
    sources.weaponLabels = await resolveWeaponLabels(this.sourceIndex, weaponSelectors, ruleset);
    if ([...(sources.inventoryItems?.values() ?? [])].some((value) => value.kind === 'available' && value.value.itemType.toLocaleLowerCase() === 'weapon')) {
      try { sources.weaponPropertyDescriptions = await this.sourceIndex.getWeaponPropertyDescriptions(ruleset); }
      catch { sources.warnings.push('Weapon property descriptions are unavailable.'); }
      if (ruleset === '2024') {
        try { sources.weaponMasteryDescriptions = await this.sourceIndex.getWeaponMasteryDescriptions(); }
        catch { sources.warnings.push('Weapon Mastery descriptions are unavailable.'); }
      }
    }
    return sources;
  }

  private async renderCreationJourney(root: HTMLElement): Promise<void> {
    const sections = getCharacterCreationSections(this.document!);
    const active = this.activeSection ?? sections.find((section) => section.status === 'active')?.id ?? 'identity';
    if (!sections.some((section) => section.id === active)) this.activeSection = sections[0].id;
    const current = sections.find((section) => section.id === (this.activeSection ?? active)) ?? sections[0];
    const rail = root.createDiv({ cls: 'guided-character-sheet__rail', attr: { 'aria-label': 'Character creation sections' } });
    for (const section of sections) {
      const currentClass = section.id === current.id ? ' is-current' : '';
      const button = rail.createEl('button', { cls: `guided-character-sheet__rail-item is-${section.status}${currentClass}`, attr: { type: 'button' } });
      button.createSpan({ text: section.status === 'complete' ? '✓' : String(sections.indexOf(section) + 1), cls: 'guided-character-sheet__rail-marker' });
      button.createSpan({ text: section.label });
      button.addEventListener('click', () => { void this.navigateToSection(section.id); });
    }
    const panel = root.createDiv({ cls: 'guided-character-sheet__panel' });
    panel.createDiv({ text: `Section ${sections.indexOf(current) + 1} of ${sections.length}`, cls: 'guided-character-sheet__eyebrow' });
    panel.createEl('h3', { text: current.label });
    if (current.status === 'complete') this.renderCompletedSummary(panel, current.id);
    if (current.id === 'identity') await this.renderIdentityStep(panel);
    else if (current.id === 'species') await this.renderSpeciesStep(panel);
    else if (current.id === 'class') await this.renderClassStep(panel);
    else if (current.id === 'background') await this.renderBackgroundStep(panel);
    else if (current.id === 'ability-scores') await this.renderAbilityScoresStep(panel);
    else if (current.id === 'inventory') this.renderInventoryStep(panel);
    else this.renderComingSoon(panel, current.id === 'ability-scores' ? 'Ability score assignment will live here.' : 'Choose starting equipment and organize your inventory here.');
    this.renderJourneyNavigation(panel, sections, current);
  }

  private renderEditDraftActions(root: HTMLElement): void {
    const actions = root.createDiv({ cls: 'guided-character-sheet__edit-actions' });
    const apply = actions.createEl('button', { text: 'Apply', cls: 'mod-cta', attr: { type: 'button' } });
    apply.disabled = this.conflict || this.document?.classProgressions?.length !== 1;
    apply.setAttribute('aria-label', 'Apply character changes');
    if (this.draftApplyError !== undefined) actions.createDiv({ text: this.draftApplyError, cls: 'guided-character-sheet__warning', attr: { role: 'alert' } });
    actions.createDiv({ text: this.conflict ? 'This character changed externally. Cancel and reopen it before editing.' : 'Apply validates the selected level, choices, and hit-point gains while preserving your current resources and hit points.', cls: 'guided-character-sheet__hint' });
    apply.addEventListener('click', () => { void this.applyCharacterDraft(); });
    const cancel = actions.createEl('button', { text: 'Cancel', cls: 'mod-muted', attr: { type: 'button' } });
    cancel.addEventListener('click', () => { void this.cancelCharacterDraft(); });
  }

  private async cancelCharacterDraft(): Promise<void> {
    await this.flushPendingUpdate();
    if (this.file === null) return;
    this.completedEditMode = false;
    this.document = this.savedDocument === undefined ? null : structuredClone(this.savedDocument);
    this.savedDocument = undefined;
    this.inactiveClassHitPoints = [];
    this.draftClassHitPoints = [];
    this.conflict = false;
    this.classLevelPreview = undefined;
    this.viewState = { mode: 'open', filePath: this.file.path, section: 'abilities' };
    await this.leaf.setViewState({ type: CHARACTER_VIEW_TYPE, state: this.viewState, active: true });
    await this.loadFromState();
  }

  private async applyCharacterDraft(): Promise<void> {
    await this.flushPendingUpdate();
    if (this.file === null || this.savedDocument === undefined || this.document === null || this.conflict) return;
    this.draftApplyError = undefined;
    try {
      const sources = await this.loadCharacterSheetSources(this.document);
      const reconciled = applyCharacterLevelDraft(this.savedDocument, this.document, sources);
      const updated = await this.store.updateIfUnchanged(this.file, this.savedDocument, () => reconciled);
      this.document = updated;
      this.savedDocument = undefined;
      this.completedEditMode = false;
      this.inactiveClassHitPoints = [];
      this.draftClassHitPoints = [];
      this.viewState = { mode: 'open', filePath: this.file.path, section: 'abilities' };
      await this.leaf.setViewState({ type: CHARACTER_VIEW_TYPE, state: this.viewState, active: true });
      await this.loadFromState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('changed externally')) { this.conflict = true; await this.render(); }
      else { this.draftApplyError = message; await this.render(); }
    }
  }

  private renderCompletedSummary(root: HTMLElement, section: CharacterCreationSectionId): void {
    if (section === 'identity') root.createDiv({ text: `${this.document!.name} · ${this.document!.ruleset ?? 'Ruleset not selected'}`, cls: 'guided-character-sheet__summary' });
    if (section === 'species' && this.document!.origin) root.createDiv({ text: this.document!.origin.identifier, cls: 'guided-character-sheet__summary' });
    if (section === 'class' && this.document!.classProgressions?.[0]) root.createDiv({ text: this.document!.classProgressions[0].class.identifier, cls: 'guided-character-sheet__summary' });
    if (section === 'background' && this.document!.background) root.createDiv({ text: this.document!.background.identifier, cls: 'guided-character-sheet__summary' });
  }

  private renderInventoryStep(root: HTMLElement): void {
    const inventory = this.document!.inventory ?? emptyInventory();
    root.createEl('h4', { text: 'Character summary' });
    const summary = root.createEl('ul');
    summary.createEl('li', { text: `Name: ${this.document!.name}` });
    summary.createEl('li', { text: `Ruleset: ${this.document!.ruleset ?? 'Not selected'}` });
    if (this.document!.origin) summary.createEl('li', { text: `Species: ${this.document!.origin.identifier}` });
    if (this.document!.classProgressions?.[0]) summary.createEl('li', { text: `Class: ${this.document!.classProgressions[0].class.identifier}` });
    if (this.document!.background) summary.createEl('li', { text: `Background: ${this.document!.background.identifier}` });
    root.createDiv({ text: 'Starting equipment becomes your mutable inventory. Gameplay actions will be added in a later pass.', cls: 'guided-character-sheet__hint' });
    root.createEl('h4', { text: 'Items' });
    if (inventory.items.length === 0) root.createDiv({ text: 'No starting items have been selected.', cls: 'guided-character-sheet__summary' });
    else { const list = root.createEl('ul'); for (const item of inventory.items) list.createEl('li', { text: `${isFoundryInventoryEntry(item) ? item.source.name : item.custom.name} ×${item.quantity}` }); }
    root.createEl('h4', { text: 'Currency' });
    root.createDiv({ text: Object.entries(inventory.currency).filter(([, amount]) => amount > 0).map(([denomination, amount]) => `${amount} ${denomination.toUpperCase()}`).join(', ') || 'No starting currency.' });
    root.createEl('h4', { text: 'Finalize character' });
    root.createDiv({ text: 'Review the selections above, then create the mutable character sheet.', cls: 'guided-character-sheet__hint' });
    const ready = isReadyForCharacterCreation(this.document!);
    const create = root.createEl('button', { text: 'Create character', cls: 'mod-cta', attr: { type: 'button' } });
    create.disabled = !ready;
    if (!ready) root.createDiv({ text: 'Complete the required character selections before creating the character.', cls: 'guided-character-sheet__warning' });
    create.addEventListener('click', () => { void this.finalizeCharacter(); });
  }

  private async finalizeCharacter(): Promise<void> {
    await this.flushPendingUpdate();
    if (this.file === null || this.document === null || !isReadyForCharacterCreation(this.document)) return;
    try {
      const sources = await this.loadCharacterSheetSources(this.document);
      const readinessErrors = validateCharacterCreationReadiness(this.document, sources);
      if (readinessErrors.length > 0) { this.renderUnavailable(readinessErrors[0]!); return; }
      const masteryIds = new Set((sources.class?.advancements ?? []).filter((advancement) => advancement.type === 'Trait' && isRecord(advancement.raw.configuration) && advancement.raw.configuration.mode === 'mastery').map((advancement) => advancement.id));
      const masterySelections = this.document.classProgressions?.[0]?.selections.filter((selection): selection is Extract<ClassAdvancementSelection, { kind: 'trait' }> => selection.kind === 'trait' && masteryIds.has(selection.advancementId)) ?? [];
      if (masterySelections.length > 0 && this.document.ruleset !== null) {
        const weapons = await this.sourceIndex.resolveSelector('weapon:*', this.document.ruleset);
        const training = getEligibleClassProficiencies(this.document, sources.class)?.weapons ?? [];
        const masteryErrors = masterySelections.flatMap((selection) => validateWeaponMasterySelections(selection.selected, weapons, training));
        if (masteryErrors.length > 0) { this.renderUnavailable(masteryErrors[0]!); return; }
      }
      const inventory = await expandInventoryContainers(this.document.inventory ?? emptyInventory(), this.sourceIndex);
      const ruleset = this.document.ruleset!;
      const progression = this.document.classProgressions![0]!;
      const [species, classSummary, background] = await Promise.all([
        this.sourceIndex.getSpeciesSummary(ruleset, this.document.origin!.sourcePath),
        this.sourceIndex.getClassSummary(ruleset, progression.class.sourcePath),
        this.sourceIndex.getBackgroundSummary(ruleset, this.document.background!.sourcePath),
      ]);
      const abilityResults = calculateAbilityScores(this.document.abilityScores!, sumAbilityBonuses(collectAbilityBonuses(species, classSummary, progression, background, this.document.backgroundChoices?.abilityScores)));
      const classProgression = projectClassLevelProgression(classSummary, progression.targetLevel, { abilityModifiers: { str: abilityResults.str.modifier, dex: abilityResults.dex.modifier, con: abilityResults.con.modifier, int: abilityResults.int.modifier, wis: abilityResults.wis.modifier, cha: abilityResults.cha.modifier } });
      if (classProgression.diagnostics.length > 0) { this.renderUnavailable(classProgression.diagnostics[0]!); return; }
      const proficiencyBonus = proficiencyBonusForLevel(progression.targetLevel) ?? 2;
      const classHitPoints: ClassHitPointEntry[] = this.document.classHitPoints ?? (progression.targetLevel === 1 ? [{ classSourcePath: classSummary.source.sourcePath, level: 1, value: 'max' }] : []);
      const hitPointErrors = validateClassHitPoints(classHitPoints, classSummary.source.sourcePath, classSummary.hitDie, progression.targetLevel);
      if (hitPointErrors.length > 0) { this.renderUnavailable(hitPointErrors[0]!); return; }
      const draconicHpPerLevel = draconicSorceryHitPointsPerLevel(getEligibleClassFeatures(this.document, classSummary).map((feature) => ({ source: feature.source, effects: feature.activeEffects ?? [] })), ruleset);
      const mutable = createFinalizedMutableCharacterState(inventory, {
        ruleset,
        classSourcePath: classSummary.source.sourcePath,
        classHitDie: classSummary.hitDie,
        constitutionModifier: abilityResults.con.modifier,
        characterLevel: progression.targetLevel,
        permanentHitPointModifiers: [
          ...getEligibleSpeciesFeatures(this.document, species).flatMap((feature) => feature.hitPointModifiers ?? []).map((modifier) => ({ perLevel: modifier.perLevel, sourcePath: modifier.source.sourcePath })),
          ...(draconicHpPerLevel > 0 ? [{ perLevel: draconicHpPerLevel, sourcePath: 'packs/_source/classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml' }] : []),
        ],
        spellSlots: classProgression.spellcasting?.spellSlots ?? [],
        spellUses: collectFinalizationSpellUses(this.document, classSummary, species, progression.targetLevel, background, proficiencyBonus),
        resources: collectFinalizationResources(this.document, classSummary, species, background, proficiencyBonus),
      });
      const permanentPerLevelBonus = (getEligibleSpeciesFeatures(this.document, species).flatMap((feature) => feature.hitPointModifiers ?? [])).reduce((total, modifier) => total + modifier.perLevel, 0) + draconicHpPerLevel;
      if (mutable.hitPoints !== undefined) {
        const maximum = calculateClassHitPoints(classHitPoints, classSummary.source.sourcePath, classSummary.hitDie, progression.targetLevel, abilityResults.con.modifier, permanentPerLevelBonus);
        mutable.hitPoints = { ...mutable.hitPoints, current: maximum, maximum };
      }
      this.document = await this.store.update(this.file, (document) => ({ ...withMutableState(document, mutable), classHitPoints }));
      this.viewState = { mode: 'open', filePath: this.file.path, section: 'abilities' };
      await this.leaf.setViewState({ type: CHARACTER_VIEW_TYPE, state: this.viewState, active: true });
      await this.loadFromState();
    } catch (error) {
      this.renderUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  private async renderAbilityScoresStep(root: HTMLElement): Promise<void> {
    if (this.document!.ruleset === null || this.document!.origin === undefined || this.document!.classProgressions?.length !== 1 || this.document!.background === undefined) {
      this.renderStateMessage(root, 'Choose a species, class, and background before assigning ability scores.');
      return;
    }
    const ruleset = this.document!.ruleset;
    const selection = this.document!.abilityScores ?? createDefaultAbilityScores();
    let standardDraft: StandardArrayDraft = this.document!.abilityScoreDraft?.method !== 'standard-array'
      ? this.document!.abilityScores?.method === 'standard-array'
        ? { method: 'standard-array', base: { ...this.document!.abilityScores.base }, manual: { ...this.document!.abilityScores.manual } }
        : createStandardArrayDraft()
      : structuredClone(this.document!.abilityScoreDraft);
    let rolledDraft: RolledAbilityDraft = this.document!.abilityScoreDraft?.method !== 'dice-rolling'
      ? this.document!.abilityScores?.method === 'dice-rolling'
        ? { method: 'dice-rolling', base: { ...this.document!.abilityScores.base }, manual: { ...this.document!.abilityScores.manual } }
        : createRolledAbilityDraft()
      : structuredClone(this.document!.abilityScoreDraft);
    let pointBuyDraft: PointBuyDraft = this.document!.abilityScoreDraft?.method === 'point-buy'
      ? structuredClone(this.document!.abilityScoreDraft)
      : this.document!.abilityScores?.method === 'point-buy'
        ? { method: 'point-buy', base: { ...this.document!.abilityScores.base }, manual: { ...this.document!.abilityScores.manual } }
        : createPointBuyAbilityScores();
    const [species, classSummary, background] = await Promise.all([
      this.sourceIndex.getSpeciesSummary(ruleset, this.document!.origin.sourcePath),
      this.sourceIndex.getClassSummary(ruleset, this.document!.classProgressions[0].class.sourcePath),
      this.sourceIndex.getBackgroundSummary(ruleset, this.document!.background.sourcePath),
    ]);
    const sources = collectAbilityBonuses(species, classSummary, this.document!.classProgressions[0], background, this.document!.backgroundChoices?.abilityScores);
    root.createDiv({ text: 'Choose a method, assign your base scores, then review every bonus before you finish.', cls: 'guided-character-sheet__hint' });
    const methodField = root.createDiv({ cls: 'guided-character-sheet__field' });
    methodField.createEl('label', { text: 'Ability score method' });
    const method = methodField.createEl('select');
    const selectedMethod = this.document!.abilityScores?.method ?? this.document!.abilityScoreDraft?.method;
    for (const option of getAbilityScoreMethodOptions(selectedMethod)) { const element = method.createEl('option', { value: option.value, text: option.label }); element.disabled = option.placeholder; element.selected = option.value === (selectedMethod ?? ''); }
    const pointBuyStatus = methodField.createDiv({ cls: 'guided-character-sheet__point-buy-status' });
    const draft: AbilityScoreSelection = structuredClone(selection);
    if (this.document!.abilityScores === undefined) {
      draft.method = selectedMethod ?? 'standard-array';
      const currentDraft = draft.method === 'dice-rolling' ? rolledDraft : draft.method === 'point-buy' ? pointBuyDraft : standardDraft;
      draft.base = Object.fromEntries(ABILITIES.map((ability) => [ability, currentDraft.base[ability] ?? 0])) as typeof draft.base;
      draft.manual = { ...currentDraft.manual };
    }
    if (selectedMethod === 'dice-rolling') {
      for (const ability of ABILITIES) if (!isValidRolledBase(rolledDraft.base[ability])) delete rolledDraft.base[ability];
      for (const ability of ABILITIES) draft.base[ability] = rolledDraft.base[ability] ?? 0;
    }
    const table = root.createDiv({ cls: 'guided-character-sheet__ability-table' });
    const rolledStatus = (): string => {
      const invalid = ABILITIES.find((ability) => rolledDraft.base[ability] !== undefined && !isValidRolledBase(rolledDraft.base[ability]));
      return invalid === undefined ? `${Object.keys(rolledDraft.base).length} of 6 rolled scores entered. Enter scores from 3 to 18; changes save automatically.` : `Rolled ${abilityLabel(invalid)} base score must be between 3 and 18.`;
    };
    const status = root.createDiv({ text: selectedMethod === 'dice-rolling' ? rolledStatus() : selectedMethod === 'point-buy' ? pointBuyStatusText(pointBuyDraft) : this.document!.abilityScores === undefined ? 'Assign each Standard Array value once. Changes save automatically.' : 'Changes save automatically.', cls: 'guided-character-sheet__hint' });
    const updatePointBuyStatus = (): void => { pointBuyStatus.textContent = draft.method === 'point-buy' ? `${pointBuyRemaining(draft.base)} points remaining of 27.` : ''; };
    const commit = (): void => {
      if (method.value === '') method.value = draft.method;
      draft.method = method.value as AbilityScoreMethod;
      if (draft.method === 'standard-array') {
        standardDraft = { ...standardDraft, manual: { ...draft.manual } };
        const snapshot = structuredClone(standardDraft);
        status.textContent = ABILITIES.every((ability) => snapshot.base[ability] !== undefined) ? 'Saved' : `${Object.keys(snapshot.base).length} of 6 scores assigned. Changes save automatically.`;
        this.queueUpdate((document) => withStandardArrayDraft(document, snapshot));
      } else if (draft.method === 'dice-rolling') {
        rolledDraft = { ...rolledDraft, manual: { ...draft.manual } };
        const snapshot = structuredClone(rolledDraft);
        status.textContent = ABILITIES.every((ability) => isValidRolledBase(snapshot.base[ability])) ? 'Saved' : rolledStatus();
        this.queueUpdate((document) => withRolledAbilityDraft(document, snapshot));
      } else if (draft.method === 'point-buy') {
        pointBuyDraft = { method: 'point-buy', base: { ...draft.base }, manual: { ...draft.manual } };
        const remaining = pointBuyRemaining(pointBuyDraft.base);
        status.textContent = remaining === 0 ? 'Saved' : `Spend exactly 27 points to finish; ${remaining} points remaining.`;
        const snapshot = structuredClone(pointBuyDraft);
        this.queueUpdate((document) => withPointBuyDraft(document, snapshot));
      } else {
        const errors = validateAbilityScores(draft);
        status.textContent = errors.length > 0 ? errors[0] : 'Saved';
        if (errors.length === 0) this.queueUpdate(createAbilityScoreUpdate(draft));
      }
      updatePointBuyStatus();
    };
    const renderTable = (): void => { table.empty(); const header = table.createDiv({ cls: 'guided-character-sheet__ability-row guided-character-sheet__ability-header' }); for (const label of ['Ability', 'Base', 'Bonuses', 'Manual', 'Final', 'Modifier']) header.createSpan({ text: label }); const results = calculateAbilityScores(draft, sumAbilityBonuses(sources)); for (const ability of ABILITIES) this.renderAbilityRow(table, ability, draft, results[ability].sourceBonus, standardDraft, rolledDraft, (changedAbility, value) => { if (draft.method === 'standard-array' && changedAbility !== undefined) { standardDraft = moveStandardArrayValue(standardDraft, changedAbility, value); for (const current of ABILITIES) draft.base[current] = standardDraft.base[current] ?? 0; method.value = 'standard-array'; } else if (draft.method === 'dice-rolling' && changedAbility !== undefined) { if (value !== undefined && (!Number.isInteger(value) || value <= 0)) { status.textContent = 'Enter a positive whole-number rolled score.'; return; } if (value === undefined) delete rolledDraft.base[changedAbility]; else rolledDraft.base[changedAbility] = value; draft.base[changedAbility] = value ?? 0; method.value = 'dice-rolling'; } else if (draft.method === 'point-buy' && changedAbility !== undefined && value !== undefined) { if (!canAffordPointBuyScore(draft.base, changedAbility, value)) { status.textContent = 'That score would exceed the 27-point Point Buy budget.'; renderTable(); return; } draft.base[changedAbility] = value; method.value = 'point-buy'; } commit(); renderTable(); }); };
    renderTable();
    method.addEventListener('change', () => {
      draft.method = method.value as AbilityScoreMethod;
      if (draft.method === 'standard-array') {
        standardDraft = createStandardArrayDraft();
        for (const ability of ABILITIES) draft.base[ability] = 0;
        draft.manual = { ...standardDraft.manual };
        delete draft.rolls;
      }
      if (draft.method === 'point-buy') {
        pointBuyDraft = createPointBuyAbilityScores();
        draft.base = { ...pointBuyDraft.base };
        draft.manual = { ...pointBuyDraft.manual };
        delete draft.rolls;
      }
      if (draft.method === 'dice-rolling') {
        rolledDraft = createRolledAbilityDraft();
        for (const ability of ABILITIES) draft.base[ability] = 0;
        draft.manual = { ...rolledDraft.manual };
        delete draft.rolls;
      }
      renderTable();
      commit();
    });
    updatePointBuyStatus();
    this.renderBonusBreakdown(root, sources);
  }

  private renderAbilityRow(root: HTMLElement, ability: Ability, draft: AbilityScoreSelection, sourceBonus: number, standardDraft: StandardArrayDraft, rolledDraft: RolledAbilityDraft, commit: (changedAbility?: Ability, value?: number) => void): void {
    const row = root.createDiv({ cls: 'guided-character-sheet__ability-row' });
    row.createSpan({ text: abilityLabel(ability) });
    const values = draft.method === 'point-buy' ? Array.from({ length: 8 }, (_, index) => index + 8) : [8, 10, 12, 13, 14, 15];
    if (draft.method === 'dice-rolling') {
      const base = row.createEl('input', { type: 'number', value: rolledDraft.base[ability] === undefined ? '' : String(rolledDraft.base[ability]), attr: { min: '3', max: '18', step: '1', 'aria-label': `${abilityLabel(ability)} rolled base score`, placeholder: '3–18' } });
      base.addEventListener('change', () => commit(ability, base.value === '' ? undefined : Number(base.value)));
    } else {
      const base = row.createEl('select');
      if (draft.method === 'standard-array') base.createEl('option', { value: '', text: 'Select a score' }).selected = standardDraft.base[ability] === undefined;
      for (const value of values) { const option = base.createEl('option', { value: String(value), text: String(value) }); option.selected = draft.method === 'standard-array' ? standardDraft.base[ability] === value : draft.base[ability] === value; if (draft.method === 'point-buy') option.disabled = !canAffordPointBuyScore(draft.base, ability, value); }
      base.addEventListener('change', () => { if (draft.method === 'standard-array') commit(ability, base.value === '' ? undefined : Number(base.value)); else if (draft.method === 'point-buy') commit(ability, Number(base.value)); else { draft.base[ability] = Number(base.value); commit(); } });
    }
    row.createSpan({ text: sourceBonus === 0 ? '—' : `${sourceBonus > 0 ? '+' : ''}${sourceBonus}` });
    const manual = row.createEl('input', { type: 'number', value: String(draft.manual[ability] ?? 0), attr: { 'aria-label': `${abilityLabel(ability)} manual adjustment`, placeholder: '0' } });
    manual.addEventListener('change', () => { draft.manual[ability] = Number(manual.value) || 0; commit(); });
    const unassigned = draft.method === 'standard-array' && standardDraft.base[ability] === undefined || draft.method === 'dice-rolling' && rolledDraft.base[ability] === undefined;
    row.createSpan({ text: unassigned ? '—' : String(draft.base[ability] + sourceBonus + (draft.manual[ability] ?? 0)), cls: 'guided-character-sheet__ability-final' });
    row.createSpan({ text: unassigned ? '—' : formatModifier(Math.floor((draft.base[ability] + sourceBonus + (draft.manual[ability] ?? 0) - 10) / 2)), cls: 'guided-character-sheet__ability-modifier' });
  }

  private renderBonusBreakdown(root: HTMLElement, sources: ReturnType<typeof collectAbilityBonuses>): void {
    const callout = root.createEl('details', { cls: 'guided-character-sheet__callout' });
    callout.createEl('summary', { text: 'Bonus breakdown' });
    const content = callout.createDiv({ cls: 'guided-character-sheet__callout-content' });
    for (const [label, values] of [['Species', sources.species], ['Class', sources.class], ['Background', sources.background]] as const) { const meaningful = ABILITIES.filter((ability) => values[ability] !== 0); if (meaningful.length > 0) content.createDiv({ text: `${label}: ${meaningful.map((ability) => `${abilityLabel(ability)} ${formatModifier(values[ability])}`).join(', ')}` }); }
    if (content.textContent === '') content.createDiv({ text: 'No source bonuses detected.' });
    content.createDiv({ text: 'Manual adjustments are entered per ability above and may be positive or negative.', cls: 'guided-character-sheet__hint' });
  }

  private async renderIdentityStep(root: HTMLElement): Promise<void> {
    const field = root.createDiv({ cls: 'guided-character-sheet__field' });
    field.createEl('label', { text: 'Character name' });
    const input = field.createEl('input', { type: 'text', value: this.document!.name, attr: { 'aria-label': 'Character name' } });
    const status = field.createDiv({ text: 'The name is stored in the character JSON and can be changed later.', cls: 'guided-character-sheet__hint' });
    let lastQueuedName = this.document!.name;
    input.addEventListener('blur', () => {
      const name = input.value.trim();
      if (name.length === 0) { status.textContent = 'Character name is required.'; return; }
      input.value = name;
      if (name === lastQueuedName) return;
      lastQueuedName = name;
      status.textContent = 'Saving…';
      this.queueUpdate((document) => withName(document, name));
    });
    this.renderRuleset(root, ['2014', '2024']);
  }

  private async renderSpeciesStep(root: HTMLElement): Promise<void> {
    if (this.document!.ruleset === null) { this.renderStateMessage(root, 'Choose a ruleset in Identity first.'); return; }
    const originState = getCharacterRenderState(this.document!, await this.sourceReader.listOrigins(this.document!.ruleset));
    if (originState.kind === 'origin') this.renderOrigins(root, originState.label, originState.options);
    if (this.document!.origin === undefined) return;
    const summary = await this.sourceIndex.getSpeciesSummary(this.document!.ruleset, this.document!.origin.sourcePath);
    const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: this.document!.foundry.sourceBranch, commit: this.document!.foundry.sourceCommit, systemVersion: this.document!.foundry.systemVersion };
    const built = buildSpeciesConfiguration(summary, snapshot);
    const source = { origin: this.document!.origin, summary, grants: built.grants, choices: built.choices, spellChoices: built.spellChoices };
    const restored = this.document!.speciesConfiguration === undefined ? built : restoreSpeciesConfiguration(this.document!.speciesConfiguration, source);
    const configuration = { ...restored, diagnostics: [...restored.diagnostics, ...validateSpeciesConfiguration(restored, { ...source, snapshot })] };
    await this.renderSpeciesSummary(root, getSpeciesRenderState(this.document!, summary, configuration)!, configuration);
  }

  private renderComingSoon(root: HTMLElement, message: string): void {
    root.createDiv({ text: message, cls: 'guided-character-sheet__coming-soon' });
    root.createDiv({ text: 'This section is planned for a future update.', cls: 'guided-character-sheet__hint' });
  }

  private renderJourneyNavigation(root: HTMLElement, sections: CharacterCreationSection[], current: CharacterCreationSection): void {
    const navigation = root.createDiv({ cls: 'guided-character-sheet__navigation' });
    const index = sections.indexOf(current);
    if (index > 0) { const back = navigation.createEl('button', { text: 'Back', cls: 'mod-muted', attr: { type: 'button' } }); back.addEventListener('click', () => { void this.navigateToSection(sections[index - 1].id); }); }
    if (index < sections.length - 1) { const next = navigation.createEl('button', { text: 'Continue', cls: 'mod-cta', attr: { type: 'button' } }); next.addEventListener('click', () => { void this.navigateToSection(sections[index + 1].id); }); }
  }

  private async navigateToSection(section: CharacterCreationSectionId): Promise<void> {
    await this.flushPendingUpdate();
    this.activeSection = section;
    await this.render();
  }

  private async renderLevelDraftHitPoints(root: HTMLElement, summary: ClassSourceSummary, targetLevel: number): Promise<void> {
    const document = this.document;
    if (document === null || document.ruleset === null || document.origin === undefined || document.background === undefined || document.abilityScores === undefined) return;
    const panel = root.createDiv({ cls: 'guided-character-sheet__level-hit-points' });
    panel.createEl('h4', { text: 'Hit-point gains' });
    panel.createDiv({ text: `Previous calculated maximum: ${this.savedDocument?.mutable?.hitPoints?.maximum ?? 'unavailable'}.`, cls: 'guided-character-sheet__hint' });
    let species: SpeciesSourceSummary;
    let background: BackgroundSourceSummary;
    try { [species, background] = await Promise.all([this.sourceIndex.getSpeciesSummary(document.ruleset, document.origin.sourcePath), this.sourceIndex.getBackgroundSummary(document.ruleset, document.background.sourcePath)]); }
    catch { panel.createDiv({ text: 'Species or background source is unavailable for hit-point calculation.', cls: 'guided-character-sheet__warning' }); return; }
    const progression = document.classProgressions?.[0];
    if (progression === undefined) return;
    const abilities = calculateAbilityScores(document.abilityScores, sumAbilityBonuses(collectAbilityBonuses(species, summary, progression, background, document.backgroundChoices?.abilityScores)));
    const permanent = getEligibleSpeciesFeatures(document, species).flatMap((feature) => feature.hitPointModifiers ?? []);
    const dieMaximum = Number(/^d(\d+)$/i.exec(summary.hitDie)?.[1] ?? 0);
    if (dieMaximum < 1) { panel.createDiv({ text: `Unable to determine the class hit die from ${summary.source.sourcePath}.`, cls: 'guided-character-sheet__warning' }); return; }
    const status = panel.createDiv({ cls: 'guided-character-sheet__hint' });
    const refresh = (): void => {
      const entries = this.draftClassHitPoints.filter((entry) => entry.classSourcePath === summary.source.sourcePath && entry.level <= targetLevel);
      const errors = validateClassHitPoints(entries, summary.source.sourcePath, summary.hitDie, targetLevel);
      if (errors.length > 0) { status.textContent = `Proposed maximum: enter each missing gain. ${errors[0]}`; return; }
      const bonus = permanent.reduce((total, entry) => total + entry.perLevel, 0);
      const maximum = calculateClassHitPoints(entries, summary.source.sourcePath, summary.hitDie, targetLevel, abilities.con.modifier, bonus);
      status.textContent = `Proposed calculated maximum: ${maximum}. Apply restores current HP to the effective maximum and clears temporary HP.`;
    };
    const entries = this.draftClassHitPoints.filter((entry) => entry.classSourcePath === summary.source.sourcePath);
    for (let level = 2; level <= targetLevel; level += 1) {
      const existing = entries.find((entry) => entry.level === level);
      const field = panel.createDiv({ cls: 'guided-character-sheet__field' });
      field.createEl('label', { text: `Level ${level} gain` });
      const choice = field.createEl('select', { attr: { 'aria-label': `Level ${level} hit-point gain` } });
      choice.createEl('option', { value: '', text: 'Choose average or rolled gain' });
      choice.createEl('option', { value: 'avg', text: `Average (${Math.floor(dieMaximum / 2) + 1})` });
      choice.createEl('option', { value: 'roll', text: 'Enter rolled gain' });
      choice.value = existing === undefined ? '' : typeof existing.value === 'number' ? 'roll' : 'avg';
      const roll = field.createEl('input', { type: 'number', value: typeof existing?.value === 'number' ? String(existing.value) : '', attr: { min: '1', max: String(dieMaximum), step: '1', 'aria-label': `Level ${level} rolled hit-point gain` } });
      roll.disabled = choice.value !== 'roll';
      const save = (): void => {
        const value = choice.value === 'avg' ? 'avg' : choice.value === 'roll' && Number.isInteger(Number(roll.value)) && Number(roll.value) >= 1 && Number(roll.value) <= dieMaximum ? Number(roll.value) : undefined;
        this.draftClassHitPoints = setClassHitPointGain(this.draftClassHitPoints, summary.source.sourcePath, level, value);
        const active = this.draftClassHitPoints.filter((entry) => entry.classSourcePath === summary.source.sourcePath && entry.level <= targetLevel);
        this.queueUpdate((current) => {
          const next = { ...current };
          if (validateClassHitPoints(active, summary.source.sourcePath, summary.hitDie, targetLevel).length === 0) next.classHitPoints = active;
          else delete next.classHitPoints;
          return next;
        });
        refresh();
      };
      choice.addEventListener('change', () => { roll.disabled = choice.value !== 'roll'; save(); });
      roll.addEventListener('change', save);
    }
    refresh();
  }

  private async renderClassStep(root: HTMLElement): Promise<void> {
    if (this.document!.ruleset === null) { this.renderStateMessage(root, 'Choose a ruleset in Identity first.'); return; }
    if (this.document!.origin === undefined) { this.renderStateMessage(root, 'Choose a species before choosing a class.'); return; }
    const ruleset = this.document!.ruleset!;
    const options = await this.sourceReader.listClasses(ruleset);
    const selected = this.document!.classProgressions?.[0];
    const availability = getClassRenderState(this.document!, undefined, undefined, options);
    if (availability.kind === 'class-unavailable') { this.renderStateMessage(root, availability.message); return; }
    const field = root.createDiv({ cls: 'guided-character-sheet__field' }); field.createEl('label', { text: 'Class' }); const select = field.createEl('select'); const placeholder = select.createEl('option', { value: '', text: 'Select a class' }); placeholder.disabled = true; for (const option of options) { const element = select.createEl('option', { value: option.id, text: option.name }); element.selected = selected?.class.id === option.id; }
    select.addEventListener('change', () => {
      const option = options.find((candidate) => candidate.id === select.value);
      if (option === undefined) return;
      const current = selected?.class;
      const replacing = current !== undefined && (current.sourcePath !== option.sourcePath || current.id !== option.id);
      if (replacing) new CharacterResetModal(this.app, 'Replace class?', 'Replacing the class resets class-dependent choices, hit-point history, and sheet state.', 'Replace class', () => { this.inactiveClassHitPoints = []; this.draftClassHitPoints = []; this.classLevelPreview = undefined; this.activeSection = 'class'; void this.selectClass(option); }, () => { void this.render(); }).open();
      else { this.classLevelPreview = undefined; this.activeSection = 'class'; void this.selectClass(option); }
    });
    if (options.length === 0) this.renderStateMessage(root, 'No classes are available for this ruleset.');
    if (selected === undefined) {
      root.createEl('h3', { text: 'Class' });
      return;
    }
    let summary: ClassSourceSummary;
    try { summary = await this.sourceIndex.getClassSummary(ruleset, selected.class.sourcePath); } catch (error) { root.createDiv({ text: `Unable to read saved class source: ${selected.class.sourcePath}`, cls: 'guided-character-sheet__warning' }); root.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' }); return; }
    const targetLevel = this.classLevelPreview?.sourcePath === selected.class.sourcePath ? this.classLevelPreview.level : selected.targetLevel;
    const built = buildClassConfiguration(summary, { owner: 'foundryvtt', repo: 'dnd5e', branch: this.document!.foundry.sourceBranch, commit: this.document!.foundry.sourceCommit, systemVersion: this.document!.foundry.systemVersion }, targetLevel);
    const previewSelection = trimClassProgression(selected, summary, targetLevel);
    const configuration = restoreClassConfiguration(previewSelection, { class: selected.class, summary, configuration: built });
    const previewDocument = targetLevel < selected.targetLevel ? projectClassLevelPreviewDocument(this.document!, summary, targetLevel) : this.document!;
    const state = getClassRenderState(previewDocument, summary, configuration);
    if (state.kind !== 'class-summary') return;
    const tablist = root.createDiv({ cls: 'guided-character-sheet__class-tabs', attr: { role: 'tablist', 'aria-label': 'Class tabs' } });
    tablist.createEl('button', { text: `${state.name} · Level ${targetLevel}`, cls: 'guided-character-sheet__class-tab is-active', attr: { type: 'button', role: 'tab', 'aria-selected': 'true', tabindex: '0' } });
    const levelField = root.createDiv({ cls: 'guided-character-sheet__field guided-character-sheet__level-selector' });
    const levelLabel = levelField.createEl('label', { text: 'Level' });
    const levelSelect = levelLabel.createEl('select', { attr: { 'aria-label': this.completedEditMode ? 'Class level' : 'Class level preview' } });
    for (let level = 1; level <= 20; level += 1) levelSelect.createEl('option', { value: String(level), text: String(level) }).selected = targetLevel === level;
    levelSelect.addEventListener('change', () => {
      const level = Number(levelSelect.value);
      if (!Number.isInteger(level) || level < 1 || level > 20) return;
      if (this.completedEditMode) {
        this.draftClassHitPoints = this.draftClassHitPoints.length > 0 ? this.draftClassHitPoints : structuredClone(this.inactiveClassHitPoints.length > 0 ? this.inactiveClassHitPoints : this.document?.classHitPoints ?? []);
        this.queueUpdate((document) => {
          const result = updateClassLevelDraft(document, summary, level, this.draftClassHitPoints.length > 0 ? this.draftClassHitPoints : this.inactiveClassHitPoints.length > 0 ? this.inactiveClassHitPoints : document.classHitPoints ?? []);
          this.inactiveClassHitPoints = result.comparisonHitPoints;
          return result.document;
        });
        return;
      }
      this.classLevelPreview = { sourcePath: selected.class.sourcePath, level };
      root.empty();
      void this.renderClassStep(root);
    });
    if (this.completedEditMode) await this.renderLevelDraftHitPoints(root, summary, targetLevel);
    const classPanel = root.createDiv({ cls: 'guided-character-sheet__class-panel', attr: { role: 'tabpanel', 'aria-label': `${state.name} class progression` } });
    const [backgroundProficiencySource, speciesProficiencySource] = await Promise.all([
      this.document!.background === undefined
        ? Promise.resolve(undefined)
        : (async () => { try { return await this.sourceIndex.getBackgroundSummary(ruleset, this.document!.background!.sourcePath); } catch { return undefined; } })(),
      this.document!.origin === undefined
        ? Promise.resolve(undefined)
        : (async () => { try { return await this.sourceIndex.getSpeciesSummary(ruleset, this.document!.origin!.sourcePath); } catch { return undefined; } })(),
    ]);
    const speciesProficiencyConfiguration = speciesProficiencySource === undefined || this.document!.origin === undefined
      ? undefined
      : (() => {
          const speciesBuilt = buildSpeciesConfiguration(speciesProficiencySource, { owner: 'foundryvtt', repo: 'dnd5e', branch: this.document!.foundry.sourceBranch, commit: this.document!.foundry.sourceCommit, systemVersion: this.document!.foundry.systemVersion });
          const speciesSelection = this.document!.speciesConfiguration;
          return speciesSelection === undefined ? speciesBuilt : restoreSpeciesConfiguration(speciesSelection, { origin: this.document!.origin!, summary: speciesProficiencySource, grants: speciesBuilt.grants, choices: speciesBuilt.choices, spellChoices: speciesBuilt.spellChoices });
        })();
    const expertiseProficiencies = collectExpertiseProficiencies({ classSummary: summary, classConfiguration: configuration, background: backgroundProficiencySource, speciesSummary: speciesProficiencySource, speciesConfiguration: speciesProficiencyConfiguration });
    if (targetLevel !== selected.targetLevel && !this.completedEditMode) classPanel.createDiv({ text: 'Class choices are read-only while previewing another level.', cls: 'guided-character-sheet__hint' });
    classPanel.createDiv({ text: 'Review what this choice provides before continuing.', cls: 'guided-character-sheet__hint' });
    const weaponLabels = await resolveWeaponLabels(this.sourceIndex, new Set(state.proficiencies?.weapons ?? []), ruleset);
    this.renderClassTraits(classPanel, state, weaponLabels);
    this.renderClassCallout(classPanel, 'Overview', true, (content) => renderFoundryOverview(content, summary.overviewHtml, summary.description ?? 'No description is available for this class.'));
    const levelCards = buildClassLevelCards(summary, configuration);
    const firstIncompleteLevel = getFirstIncompleteClassLevel(configuration) ?? 1;
    if (levelCards.length > 0) {
      classPanel.createEl('h4', { text: 'Features by level', cls: 'guided-character-sheet__features-heading' });
    }
    const cardElements = renderClassLevelCards(classPanel, levelCards, firstIncompleteLevel);
    const eligibleChoiceIds = new Set(state.choices.map((choice) => choice.advancementId));
    const selectedFeatReferences = (this.document!.classProgressions?.[0]?.selections ?? []).flatMap((selection) => {
      if (!eligibleChoiceIds.has(selection.advancementId)) return [];
      if (selection.kind === 'ability-score' && selection.feat !== undefined) return [selection.feat];
      if (selection.kind === 'item') return selection.selected.filter((source) => source.type === 'feat');
      return [];
    });
    const selectedFeats = await Promise.all(selectedFeatReferences.map(async (reference) => {
      try { return await this.sourceIndex.getFeatSummary(reference, ruleset); }
      catch { return null; }
    }));
    const selectedFeatCallouts = new Map<string, NonNullable<typeof selectedFeats[number]> | { source: FoundrySourceReference; description?: string }>();
    selectedFeatReferences.forEach((reference, index) => {
      const summary = selectedFeats[index];
      const key = `${reference.sourcePath}:${reference.pack}:${reference.type}:${reference.id}`;
      if (selectedFeatCallouts.has(key)) return;
      selectedFeatCallouts.set(key, summary ?? { source: reference });
    });
    if (selectedFeatCallouts.size > 0) {
      classPanel.createEl('h4', { text: 'Selected feats', cls: 'guided-character-sheet__features-heading' });
      for (const feat of selectedFeatCallouts.values()) this.renderClassCallout(classPanel, feat.source.name, false, (content) => content.createDiv({ text: feat.description ?? 'Feat source is unavailable.' }));
    }
    if (configuration.choices.length > 0) {
      const spellQuery = spellCatalogQuery(this.sourceIndex, ruleset);
      const resolvedPools = new Map<string, ClassChoiceDisplayOption[]>();
      const masteryChoiceIds = new Set(state.choices.filter((choice) => {
        if (choice.kind !== 'trait') return false;
        const configuration = summary.advancements.find((entry) => entry.id === choice.advancementId)?.raw.configuration;
        return isRecord(configuration) && configuration.mode === 'mastery';
      }).map((choice) => choice.advancementId));
      const masteryDescriptions = masteryChoiceIds.size === 0 ? new Map<string, string>() : await this.sourceIndex.getWeaponMasteryDescriptions();
      await Promise.all(state.choices.filter((choice): choice is Extract<ClassAdvancementSelection, { kind: 'trait' | 'expertise' }> => choice.kind === 'trait' || choice.kind === 'expertise').flatMap((choice) => (choice.configuredPool ?? []).filter((selector) => selector.endsWith(':*')).map(async (selector) => {
        const items = await this.sourceIndex.resolveSelector(selector, ruleset);
        const resolved = items.map((item) => classChoiceDisplayOptionFromSource(item, selector, masteryDescriptions));
        resolvedPools.set(choice.advancementId, [...(resolvedPools.get(choice.advancementId) ?? []), ...resolved]);
      })));
      const orderedChoices = [...state.choices].sort((left, right) => classChoicePriority(left) - classChoicePriority(right));
      const weaponTraining = getEligibleClassProficiencies(this.document!, summary)?.weapons ?? [];
      const knownLanguages = getKnownLanguageKeys(this.document!, { warnings: [], species: speciesProficiencySource, class: summary, background: backgroundProficiencySource });
      for (const choice of orderedChoices) {
        const card = levelCards.flatMap((row) => row.cards).find((candidate) => candidate.choiceAdvancementIds.includes(choice.advancementId));
        const target = card === undefined ? undefined : cardElements.get(card.key);
        if (target === undefined) continue;
        const controls = target.createDiv({ cls: 'guided-character-sheet__level-card-choice' });
        controls.createEl('h6', { text: getClassChoiceHeading(configuration, choice) });
        const fieldset = controls.createEl('fieldset', { cls: 'guided-character-sheet__level-card-controls' });
        fieldset.disabled = targetLevel !== selected.targetLevel;
        renderClassConfigurationControls(fieldset, configuration, (next, changedSelection) => this.queueUpdate((document) => {
          const current = document.classProgressions?.[0];
          return current === undefined || changedSelection === undefined
            ? withClassProgression(document, toClassProgressionSelection(next))
            : withClassProgression(document, mergeClassSelection(current, changedSelection));
        }), choice.advancementId, spellQuery, resolvedPools, expertiseProficiencies, weaponTraining, knownLanguages);
      }
    }
    if (state.startingEquipment) {
      const content = this.renderClassCallout(classPanel, 'Starting equipment', true, (content) => {
        content.createDiv({ text: 'Choose the starting package and any specific items it requires.', cls: 'guided-character-sheet__hint' });
        this.renderEquipmentPackages(content, state.startingEquipment!, this.document!.classEquipment, new Map(), (selection) => this.queueUpdate((document) => {
          const next = withClassEquipment(document, selection);
          return withInventory(next, replaceInventorySource(document.inventory ?? emptyInventory(), summary.source.sourcePath, flattenSelectedEquipment(state.startingEquipment!.roots, selection, { sourcePath: summary.source.sourcePath, packageNodeId: summary.source.id })));
        }));
      });
      void resolveStartingEquipmentItems(state.startingEquipment, (key) => key.startsWith('Compendium.') ? this.sourceIndex.getByUuid(key) : Promise.resolve(null)).then((equipmentSummary) => this.resolveEquipmentChoices(equipmentSummary, ruleset).then((itemChoices) => ({ equipmentSummary, itemChoices }))).then(({ equipmentSummary, itemChoices }) => {
        if (!content.isConnected) return;
        content.empty();
        content.createDiv({ text: 'Choose the starting package and any specific items it requires.', cls: 'guided-character-sheet__hint' });
        this.renderEquipmentPackages(content, equipmentSummary, this.document!.classEquipment, itemChoices, (selection) => this.queueUpdate((document) => {
          const next = withClassEquipment(document, selection);
          return withInventory(next, replaceInventorySource(document.inventory ?? emptyInventory(), summary.source.sourcePath, flattenSelectedEquipment(equipmentSummary.roots, selection, { sourcePath: summary.source.sourcePath, packageNodeId: summary.source.id })));
        }));
      }).catch((error: unknown) => content.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' }));
    }
    for (const diagnostic of state.diagnostics) classPanel.createDiv({ text: diagnostic, cls: 'guided-character-sheet__warning' });
  }

  private renderEquipmentPackages(root: HTMLElement, summary: EquipmentPackageSummary, saved: EquipmentSelection | undefined, itemChoices: Map<string, FoundryItemSummary[]>, onChange: (selection: EquipmentSelection) => void): void {
    const selected: Record<string, string> = { ...(saved?.selected ?? {}) };
    const selectedSemantic: Record<string, FoundrySourceReference> = { ...(saved?.semantic ?? {}) };
    const commit = (selection: EquipmentSelection): void => { void this.hydrateEquipmentNodes(summary.roots).then(() => onChange(selection)).catch((error: unknown) => root.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' })); };
    const render = (parent: HTMLElement, node: EquipmentPackageNode, requirementsOnly = false): void => {
      if (node.type === 'OR') {
        if (node.children?.length === 1) { render(parent, node.children[0]!, requirementsOnly); return; }
        if (!requirementsOnly) {
          const options = parent.createDiv({ cls: 'guided-character-sheet__equipment-options' });
          options.createEl('h5', { text: 'Available options' });
          const list = options.createEl('ol');
          for (const child of node.children ?? []) list.createEl('li', { text: getEquipmentOptionContents(child).join(', ') });
        }
        const field = parent.createDiv({ cls: 'guided-character-sheet__choice' });
        field.createEl('label', { text: getEquipmentChoiceLabel(node) });
        renderRepeatedDropdownChoice(field, {
          count: 1,
          options: (node.children ?? []).map((child) => ({ value: child.nodeId, label: equipmentNodeLabel(child) })),
          selected: selected[node.nodeId] === undefined ? [] : [selected[node.nodeId]],
          placeholder: () => 'Select a package',
          ariaLabel: () => getEquipmentChoiceLabel(node),
          unavailableLabel: (value) => `${value} (unavailable)`,
        }, (values) => {
          const value = values[0];
          if (value !== undefined) { selected[node.nodeId] = value; commit({ selected: { ...selected }, semantic: { ...selectedSemantic } }); }
        });
        const chosen = node.children?.find((child) => child.nodeId === selected[node.nodeId]);
        if (chosen) render(parent, chosen, true);
        return;
      }
      if (node.type === 'AND') { for (const child of node.children ?? []) render(parent, child, requirementsOnly); return; }
      if (!requirementsOnly && node.type === 'linked') parent.createDiv({ text: `${node.item?.name ?? equipmentNodeLabel(node)}${node.quantity !== undefined && node.quantity !== 1 ? ` ×${node.quantity}` : ''}`, cls: 'guided-character-sheet__equipment-item' });
      else if (!requirementsOnly && node.type === 'currency' && node.currency) parent.createDiv({ text: `${node.currency.amount} ${node.currency.denomination.toUpperCase()}`, cls: 'guided-character-sheet__equipment-item' });
      else if (node.semantic) {
        const semantic = node.semantic;
        const field = parent.createDiv({ cls: 'guided-character-sheet__choice' });
        const current = selectedSemantic[node.nodeId];
        field.createEl('label', { text: `Choose a ${semantic.category}` });
        const options = itemChoices.get(node.nodeId) ?? [];
        const [select] = renderRepeatedDropdownChoice(field, {
          count: 1,
          options: options.map((item) => ({ value: item.id, label: item.name })),
          selected: current === undefined ? [] : [current.id],
          placeholder: () => itemChoices.has(node.nodeId) ? 'Select an item' : 'Loading valid items…',
          ariaLabel: () => `Choose a ${semantic.category}`,
          unavailableLabel: () => `${current?.name ?? current?.id ?? 'Saved item'} (saved)`,
        }, (values) => {
          const item = options.find((candidate) => candidate.id === values[0]);
          if (item) { selectedSemantic[node.nodeId] = item; commit({ selected: { ...selected }, semantic: { ...selectedSemantic } }); }
        });
        select.disabled = !itemChoices.has(node.nodeId);
        if (itemChoices.has(node.nodeId) && options.length === 0) field.createDiv({ text: 'No valid items were found for this starting-equipment choice.', cls: 'guided-character-sheet__warning' });
      }
      for (const diagnostic of node.diagnostics) parent.createDiv({ text: diagnostic, cls: 'guided-character-sheet__warning' });
    };
    for (const node of summary.roots) render(root, node);
    for (const diagnostic of summary.diagnostics) root.createDiv({ text: diagnostic, cls: 'guided-character-sheet__warning' });
    if (saved === undefined && !hasEquipmentChoice(summary.roots)) commit({ selected: {}, semantic: {} });
  }

  private async resolveEquipmentChoices(summary: EquipmentPackageSummary, ruleset: '2014' | '2024'): Promise<Map<string, FoundryItemSummary[]>> {
    const choices = new Map<string, FoundryItemSummary[]>();
    const visit = async (node: EquipmentPackageNode): Promise<void> => {
      if (node.semantic) choices.set(node.nodeId, await this.sourceIndex.resolveSelector(equipmentSearchSelector(node), ruleset));
      for (const child of node.children ?? []) await visit(child);
    };
    for (const node of summary.roots) await visit(node);
    return choices;
  }

  private async hydrateEquipmentNodes(nodes: EquipmentPackageNode[]): Promise<void> {
    for (const node of nodes) {
      if (node.children) await this.hydrateEquipmentNodes(node.children);
      if (node.type === 'linked' && node.item === undefined && node.key?.startsWith('Compendium.')) node.item = (await this.sourceIndex.getByUuid(node.key)) ?? undefined;
    }
  }

  private renderClassTraits(root: HTMLElement, state: Extract<ClassRenderState, { kind: 'class-summary' }>, weaponLabels?: ReadonlyMap<string, string>): void {
    const traits = root.createDiv({ cls: 'guided-character-sheet__traits' });
    traits.createEl('h4', { text: 'Core traits' });
    const list = traits.createEl('dl');
    list.createEl('dt', { text: 'Hit die' }); list.createEl('dd', { text: state.hitDie });
    if (state.proficiencies) for (const [label, values] of [['Armor', state.proficiencies.armor], ['Weapons', state.proficiencies.weapons], ['Saving throws', state.proficiencies.savingThrows], ['Languages', state.proficiencies.languages]] as const) if (values.length > 0) { list.createEl('dt', { text: label }); list.createEl('dd', { text: [...new Set(values.map((value) => label === 'Weapons' ? weaponLabels?.get(value) ?? selectorLabel(value) : selectorLabel(value)))].join(', ') }); }
  }

  private renderClassCallout(root: HTMLElement, label: string, open: boolean, render: (content: HTMLElement) => void): HTMLElement {
    const callout = root.createEl('details', { cls: 'guided-character-sheet__callout' });
    callout.open = open;
    callout.createEl('summary', { text: label });
    const content = callout.createDiv({ cls: 'guided-character-sheet__callout-content' });
    render(content);
    return content;
  }

  private async renderBackgroundStep(root: HTMLElement): Promise<void> {
    if (this.document!.ruleset === null) { this.renderStateMessage(root, 'Choose a ruleset in Identity first.'); return; }
    if (this.document!.origin === undefined) { this.renderStateMessage(root, 'Choose a species before choosing a background.'); return; }
    if (this.document!.classProgressions?.length !== 1) { this.renderStateMessage(root, 'Choose a class before choosing a background.'); return; }
    const ruleset = this.document!.ruleset!;
    const options = await this.sourceReader.listBackgrounds(ruleset);
    const selected = this.document!.background;
    const availability = getBackgroundRenderState(this.document!, undefined, options);
    if (availability.kind === 'background-unavailable') { this.renderStateMessage(root, availability.message); return; }
    const field = root.createDiv({ cls: 'guided-character-sheet__field' }); field.createEl('label', { text: 'Background' }); const select = field.createEl('select'); const placeholder = select.createEl('option', { value: '', text: 'Select a background' }); placeholder.disabled = true; placeholder.selected = selected === undefined; for (const option of options) { const element = select.createEl('option', { value: option.id, text: option.name }); element.selected = selected?.id === option.id; }
    select.addEventListener('change', () => { const option = options.find((candidate) => candidate.id === select.value); if (option) { this.activeSection = 'background'; this.queueUpdate((document) => withBackground(document, option)); } });
    if (selected === undefined) { root.createEl('h3', { text: 'Background' }); return; }
    let summary: BackgroundSourceSummary;
    try { summary = await this.sourceIndex.getBackgroundSummary(ruleset, selected.sourcePath); } catch (error) { root.createDiv({ text: `Unable to read saved background source: ${selected.sourcePath}`, cls: 'guided-character-sheet__warning' }); root.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' }); return; }
    const state = getBackgroundRenderState(this.document!, summary);
    if (state.kind !== 'background-summary') return;
    root.createEl('h3', { text: state.name });
    root.createDiv({ text: 'Review what this choice provides before continuing.', cls: 'guided-character-sheet__hint' });
    this.renderClassCallout(root, 'Overview', true, (content) => this.renderBackgroundOverview(content, getBackgroundOverview(state)));
    const languageChoice = state.languageChoices.find((choice) => Number.isInteger(choice.count) && choice.count > 0);
    const features = getBackgroundFeatureCallouts(state);
    if (features.length > 0) {
      root.createEl('h4', { text: 'Features', cls: 'guided-character-sheet__features-heading' });
      for (const feature of features) this.renderClassCallout(root, feature.name, false, (content) => content.createDiv({ text: feature.description ?? 'No description is available for this feature.' }));
    }
    if (languageChoice) {
      root.createEl('h4', { text: 'Feature selections', cls: 'guided-character-sheet__features-heading' });
      const [classSummary, speciesSummary] = await Promise.all([
        this.sourceIndex.getClassSummary(ruleset, this.document!.classProgressions![0]!.class.sourcePath),
        this.sourceIndex.getSpeciesSummary(ruleset, this.document!.origin!.sourcePath),
      ]);
      const knownLanguages = getKnownLanguageKeys(this.document!, { warnings: [], species: speciesSummary, class: classSummary, background: summary });
      this.renderClassCallout(root, 'Languages', true, (content) => this.renderBackgroundLanguageChoice(content, summary, this.document!.backgroundChoices?.languages ?? [], languageChoice.count, knownLanguages));
    }
    if (ruleset === '2024') {
      const abilityConfiguration = buildBackgroundAbilityConfiguration(summary);
      if (abilityConfiguration.kind !== 'none') this.renderClassCallout(root, 'Ability score improvement', true, (content) => renderBackgroundAbilityControls(content, abilityConfiguration, this.document!.backgroundChoices?.abilityScores, (selection) => this.queueUpdate((document) => withBackgroundAbilityScores(document, selection, abilityConfiguration))));
      const featConfiguration = buildGrantedFeatConfiguration(summary.grantedFeat);
      if (featConfiguration.kind !== 'none') this.renderClassCallout(root, 'Feat choices', true, (content) => renderBackgroundGrantedFeatControls(content, featConfiguration, this.document!.backgroundChoices?.grantedFeat, (selection) => this.queueUpdate((document) => withBackgroundGrantedFeat(document, selection, featConfiguration))));
    }
    if (state.startingEquipment) {
      const content = this.renderClassCallout(root, 'Starting equipment', true, (content) => {
        content.createDiv({ text: 'Choose the starting package and any specific items it requires.', cls: 'guided-character-sheet__hint' });
        this.renderEquipmentPackages(content, state.startingEquipment!, this.document!.backgroundEquipment, new Map(), (selection) => this.queueUpdate((document) => {
          const next = withBackgroundEquipment(document, selection);
          const backgroundInventory = flattenSelectedEquipment(state.startingEquipment!.roots, selection, { sourcePath: summary.source.sourcePath, packageNodeId: summary.source.id });
          return withInventory(next, replaceInventorySource(document.inventory ?? emptyInventory(), summary.source.sourcePath, backgroundInventory));
        }));
      });
      void resolveStartingEquipmentItems(state.startingEquipment, (key) => key.startsWith('Compendium.') ? this.sourceIndex.getByUuid(key) : Promise.resolve(null)).then((equipmentSummary) => this.resolveEquipmentChoices(equipmentSummary, ruleset).then((itemChoices) => ({ equipmentSummary, itemChoices }))).then(({ equipmentSummary, itemChoices }) => {
        if (!content.isConnected) return;
        content.empty();
        content.createDiv({ text: 'Choose the starting package and any specific items it requires.', cls: 'guided-character-sheet__hint' });
        this.renderEquipmentPackages(content, equipmentSummary, this.document!.backgroundEquipment, itemChoices, (selection) => this.queueUpdate((document) => {
          const next = withBackgroundEquipment(document, selection);
          const backgroundInventory = flattenSelectedEquipment(equipmentSummary.roots, selection, { sourcePath: summary.source.sourcePath, packageNodeId: summary.source.id });
          return withInventory(next, replaceInventorySource(document.inventory ?? emptyInventory(), summary.source.sourcePath, backgroundInventory));
        }));
      }).catch((error: unknown) => content.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' }));
    }
  }

  private renderBackgroundOverview(root: HTMLElement, state: BackgroundOverview): void {
    if (state.description !== undefined) root.createDiv({ text: state.description });
    if (state.abilityScores !== undefined) {
      root.createEl('h4', { text: 'Ability scores' });
      const list = root.createEl('ul');
      if (state.abilityScores.points !== undefined) list.createEl('li', { text: `${state.abilityScores.points} points` });
      for (const ability of state.abilityScores.locked ?? []) list.createEl('li', { text: `${selectorLabel(ability)} fixed` });
      for (const [ability, value] of Object.entries(state.abilityScores.fixed ?? {})) list.createEl('li', { text: `${selectorLabel(ability)} +${value}` });
    }
    this.renderBackgroundList(root, 'Skill proficiencies', state.skills);
    this.renderBackgroundList(root, 'Languages', state.languages);
    this.renderBackgroundList(root, 'Tool proficiencies', state.tools);
    if ((state.equipment ?? []).length > 0) {
      root.createEl('h4', { text: 'Equipment' });
      const list = root.createEl('ul');
      for (const item of state.equipment ?? []) list.createEl('li', { text: [item.type, item.key, item.count === undefined ? undefined : `×${item.count}`].filter((value): value is string => value !== undefined).join(': ') });
    }
    if (state.wealth !== undefined) { root.createEl('h4', { text: 'Starting wealth' }); root.createDiv({ text: state.wealth }); }
  }

  private renderBackgroundList(root: HTMLElement, label: string, values: string[]): void {
    if (values.length === 0) return;
    root.createEl('h4', { text: label });
    const list = root.createEl('ul');
    for (const value of values) list.createEl('li', { text: selectorLabel(value) });
  }

  private renderBackgroundLanguageChoice(root: HTMLElement, summary: BackgroundSourceSummary | string[], selected: string[], count: number, knownLanguages: ReadonlySet<string> = new Set()): void {
    const field = root.createDiv({ cls: 'guided-character-sheet__choice' });
    field.createEl('label', { text: `Choose ${count} languages` });
    const selectedKeys = new Set(selected.map(languageSelectorKey));
    const options = (Array.isArray(summary) ? summary.flatMap((value) => languageSelectorOptions(value)) : getBackgroundLanguageOptions(summary))
      .filter((option) => !knownLanguages.has(languageSelectorKey(option.value)) || selectedKeys.has(languageSelectorKey(option.value)));
    const normalizedSelected = selected.map((value) => options.find((option) => option.value === value || option.value.replace(/^languages:(?:standard|exotic):/, 'languages:') === value)?.value ?? value);
    const status = field.createDiv({ text: normalizedSelected.length === count ? `${count} languages selected.` : `Select ${count - normalizedSelected.length} more language${count - normalizedSelected.length === 1 ? '' : 's'}.` });
    renderRepeatedDropdownChoice(field, {
      count,
      options,
      selected: normalizedSelected,
      placeholder: (index) => `Select language ${index + 1}`,
      ariaLabel: (index) => `Language ${index + 1} of ${count}`,
      unavailableLabel: (value) => `${value} (unavailable)`,
    }, (values) => {
      status.textContent = values.length === count ? `${count} languages selected.` : `Select ${count - values.length} more language${count - values.length === 1 ? '' : 's'}.`;
      if (values.length === count) this.queueUpdate((document) => withBackgroundLanguages(document, values, count));
    });
  }

  private async selectClass(option: CharacterSourceOption): Promise<void> { const summary = await this.sourceIndex.getClassSummary(this.document!.ruleset!, option.sourcePath); const configuration = buildClassConfiguration(summary, { owner: 'foundryvtt', repo: 'dnd5e', branch: this.document!.foundry.sourceBranch, commit: this.document!.foundry.sourceCommit, systemVersion: this.document!.foundry.systemVersion }, 1); this.queueUpdate((document) => { const updated = withClassProgression(document, toClassProgressionSelection(configuration)); if (document.classProgressions?.[0]?.class.sourcePath !== option.sourcePath) delete updated.classHitPoints; return updated; }); }

  private async renderCharacterPicker(): Promise<void> {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: 'guided-character-sheet' });
    await this.renderCharacterSelector(root);
    root.createEl('h2', { text: 'Character sheet', cls: 'guided-character-sheet__name' });
    this.renderStateMessage(root, 'Select a character above to continue.');
  }

  private async renderCharacterSelector(root: HTMLElement): Promise<void> {
    const field = root.createDiv({ cls: 'guided-character-sheet__field' });
    field.createEl('label', { text: 'Character' });
    const select = field.createEl('select');
    try {
      const files = await this.store.list();
      const placeholder = select.createEl('option', { value: '', text: 'Select a character' });
      placeholder.disabled = true;
      placeholder.selected = this.file === null;
      for (const file of files) {
        const document = await this.store.read(file);
        const option = select.createEl('option', { value: file.path, text: document.name });
        option.selected = this.file?.path === file.path;
      }
      if (files.length === 0) {
        placeholder.textContent = 'No characters found';
        placeholder.selected = true;
      }
      select.addEventListener('change', () => { if (select.value) void this.selectCharacter(select.value); });
    } catch {
      select.createEl('option', { value: '', text: 'Characters unavailable' });
    }
  }

  private async selectCharacter(filePath: string): Promise<void> {
    await this.flushPendingUpdate();
    const file = this.app.vault.getFileByPath(filePath);
    if (!(file instanceof TFile)) { this.renderUnavailable('The selected character file could not be found.'); return; }
    this.viewState = { mode: 'open', filePath, section: 'abilities' };
    await this.leaf.setViewState({ type: CHARACTER_VIEW_TYPE, state: this.viewState, active: true });
    await this.loadFromState();
  }

  private async editCharacter(): Promise<void> {
    await this.flushPendingUpdate();
    if (this.file === null) return;
    this.savedDocument = this.document === null ? undefined : structuredClone(this.document);
    this.completedEditMode = true;
    this.draftApplyError = undefined;
    this.classLevelPreview = undefined;
    this.viewState = { mode: 'create', filePath: this.file.path };
    await this.leaf.setViewState({ type: CHARACTER_VIEW_TYPE, state: this.viewState, active: true });
    await this.loadFromState();
  }

  private async selectSheetSection(section: CharacterSheetSection): Promise<void> {
    if (this.file === null) return;
    this.viewState = { mode: 'open', filePath: this.file.path, section };
    await this.leaf.setViewState({ type: CHARACTER_VIEW_TYPE, state: this.viewState, active: true });
    await this.render();
  }

  private renderRuleset(root: HTMLElement, options: ['2014', '2024']): void {
    const field = root.createDiv({ cls: 'guided-character-sheet__field' });
    field.createEl('label', { text: 'Ruleset' });
    const select = field.createEl('select');
    const placeholder = select.createEl('option', { value: '', text: 'Select a ruleset' });
    placeholder.disabled = true;
    placeholder.selected = this.document?.ruleset === null;
    for (const option of options) { const element = select.createEl('option', { value: option, text: option }); element.selected = this.document?.ruleset === option; }
    select.addEventListener('change', () => {
      const value = select.value;
      if (value !== '2014' && value !== '2024' || value === this.document?.ruleset) return;
      const changeRuleset = (): void => { this.inactiveClassHitPoints = []; this.draftClassHitPoints = []; this.activeSection = 'species'; this.queueUpdate((document) => { const reset = withRuleset(document, value); delete reset.classHitPoints; return reset; }); };
      if (shouldConfirmRulesetReset(this.document!)) {
        new CharacterResetModal(this.app, 'Change ruleset?', 'Changing the ruleset resets this character’s selections and sheet state.', 'Reset character', changeRuleset, () => { void this.render(); }).open();
      } else changeRuleset();
    });
  }

  private renderOrigins(root: HTMLElement, label: 'Race' | 'Species', options: CharacterSourceOption[]): void {
    const field = root.createDiv({ cls: 'guided-character-sheet__field' });
    field.createEl('label', { text: label });
    const select = field.createEl('select');
    const selectedOriginId = this.document?.origin?.id ?? '';
    const placeholder = select.createEl('option', { value: '', text: `Select a ${label.toLowerCase()}` });
    placeholder.selected = selectedOriginId === '';
    for (const option of options) {
      const element = select.createEl('option', { value: option.id, text: option.name });
      element.selected = selectedOriginId === option.id;
    }
    select.addEventListener('change', () => { const option = options.find((candidate) => candidate.id === select.value); if (option) { this.activeSection = 'species'; this.queueUpdate((document) => withOrigin(document, option)); } });
  }

  private async renderSpeciesSummary(root: HTMLElement, state: SpeciesRenderState & { grants?: SpeciesConfiguration['grants']; choices?: SpeciesChoiceRenderControl[]; warnings?: string[] }, configuration: SpeciesConfiguration): Promise<void> {
    root.createDiv({ text: state.name, cls: 'guided-character-sheet__selected-choice' });
    root.createDiv({ text: 'Review what this choice provides before continuing.', cls: 'guided-character-sheet__hint' });
    this.renderSpeciesTraits(root, state);
    if (state.size !== undefined) {
      const field = root.createDiv({ cls: 'guided-character-sheet__field' });
      field.createEl('label', { text: 'Size' });
      if (state.size.required) {
        const select = field.createEl('select', { attr: { 'aria-label': 'Species size' } });
        const placeholder = select.createEl('option', { value: '', text: 'Select a size' }); placeholder.disabled = true; placeholder.selected = state.size.selected === undefined;
        for (const value of state.size.options) { const option = select.createEl('option', { value, text: speciesSizeLabel(value) }); option.selected = value === state.size.selected; }
        select.addEventListener('change', () => { try { this.queueUpdate((document) => withSpeciesConfiguration(document, setSpeciesSize(configuration, select.value))); } catch { /* retain incomplete control */ } });
      } else field.createSpan({ text: speciesSizeLabel(state.size.options[0] ?? '') });
    }
    this.renderSpeciesCallout(root, 'Overview', true, (content) => renderFoundryOverview(content, state.overviewHtml, state.description ?? 'No description is available for this source.'));
    const features = getSpeciesFeatureCallouts(state);
    if (features.length > 0) {
      root.createEl('h4', { text: 'Features', cls: 'guided-character-sheet__features-heading' });
      for (const feature of features) this.renderSpeciesFeatureCallout(root, feature);
    }
    if (state.pending.length > 0 || state.choices && state.choices.length > 0 || state.warnings && state.warnings.length > 0 || configuration.spellChoices.length > 0 || configuration.spellcastingAbility !== undefined && configuration.spellcastingAbility.options.length > 1) {
      const [classSummary, backgroundSummary] = await Promise.all([
        this.document!.classProgressions?.[0] === undefined ? Promise.resolve(undefined) : this.sourceIndex.getClassSummary(this.document!.ruleset!, this.document!.classProgressions[0].class.sourcePath).catch(() => undefined),
        this.document!.background === undefined ? Promise.resolve(undefined) : this.sourceIndex.getBackgroundSummary(this.document!.ruleset!, this.document!.background.sourcePath).catch(() => undefined),
      ]);
      const knownLanguages = getKnownLanguageKeys(this.document!, { warnings: [], species: undefined, class: classSummary, background: backgroundSummary });
      this.renderSpeciesCallout(root, 'Species choices', true, (content) => {
        renderSpeciesConfigurationControls(content, { choices: state.choices, spellChoices: getAvailableSpeciesSpellChoices(configuration), spellcastingAbility: configuration.spellcastingAbility, warnings: state.warnings, unresolvedWarnings: state.unresolvedWarnings }, configuration, (next) => this.queueUpdate((document) => withSpeciesConfiguration(document, next)), knownLanguages);
      });
    }
    for (const warning of state.unresolvedWarnings) root.createDiv({ text: warning, cls: 'guided-character-sheet__warning' });
  }

  private renderSpeciesTraits(root: HTMLElement, state: SpeciesRenderState): void {
    const traits = [
      ...getVisibleSpeciesTraitValues(state.movement).map((entry) => ({ label: entry.label === 'Walk' ? 'Speed' : entry.label, value: entry.value })),
      ...getVisibleSpeciesTraitValues(state.senses),
      ...getVisibleSpeciesTraitValues(state.creatureType).map((entry) => ({ label: entry.label === 'Value' ? 'Creature type' : entry.label, value: entry.value })),
    ];
    if (traits.length === 0) return;
    const section = root.createDiv({ cls: 'guided-character-sheet__traits' });
    section.createEl('h4', { text: 'Core traits' });
    const list = section.createEl('dl');
    for (const trait of traits) { list.createEl('dt', { text: trait.label }); list.createEl('dd', { text: trait.value }); }
  }

  private renderSpeciesFeatureCallout(root: HTMLElement, feature: SpeciesFeatureRenderCallout): void {
    this.renderSpeciesCallout(root, feature.name, false, (content) => {
      if (feature.description) content.createDiv({ text: feature.description });
    });
  }

  private renderSpeciesCallout(root: HTMLElement, label: string, open: boolean, render: (content: HTMLElement) => void): void {
    const callout = root.createEl('details', { cls: 'guided-character-sheet__callout' });
    callout.open = open;
    callout.createEl('summary', { text: label });
    const content = callout.createDiv({ cls: 'guided-character-sheet__callout-content' });
    render(content);
  }

  private renderUnavailable(message: string): void { this.contentEl.empty(); this.renderStateMessage(this.contentEl, message); }
  private renderStateMessage(root: HTMLElement, message: string): void { root.createDiv({ text: message, cls: 'guided-character-sheet__message' }); }

  private queueUpdate(update: (document: CharacterDocument) => CharacterDocument): void {
    if (this.opened === false) return;
    if (this.completedEditMode) {
      if (this.document === null || this.conflict) return;
      try { this.draftApplyError = undefined; this.document = parseCharacterDocument(update(this.document)); void this.render(); }
      catch (error) { this.renderUnavailable(error instanceof Error ? error.message : String(error)); }
      return;
    }
    this.queuedUpdateCount += 1;
    const pending = this.pendingUpdate;
    this.pendingUpdate = pending === undefined ? update : (document) => update(pending(document));
    if (this.pendingTimer !== undefined) window.clearTimeout(this.pendingTimer);
    this.pendingTimer = undefined;
    void CharacterView.prototype.flushPendingUpdate.call(this).finally(() => { this.queuedUpdateCount = Math.max(0, this.queuedUpdateCount - 1); });
  }

  private async flushPendingUpdate(): Promise<void> {
    if (this.file === null || this.conflict) return;
    const activeFlush = this.flushInProgress;
    if (activeFlush !== undefined) {
      await activeFlush;
      if (this.pendingUpdate !== undefined && !this.conflict) await this.flushPendingUpdate();
      return;
    }
    if (this.pendingUpdate === undefined) return;
    const flush = (async (): Promise<void> => {
      while (this.pendingUpdate !== undefined && this.file !== null && !this.conflict) {
        const update = this.pendingUpdate;
        this.pendingUpdate = undefined;
        if (this.pendingTimer !== undefined) { window.clearTimeout(this.pendingTimer); this.pendingTimer = undefined; }
        try {
          this.writingUpdate = true;
          let updated: CharacterDocument;
          try { updated = await this.store.update(this.file, update); }
          finally { this.writingUpdate = false; }
          this.document = updated;
          this.lastWrittenDocument = structuredClone(updated);
          await this.render();
        } catch (error) {
          this.renderUnavailable(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    })();
    this.flushInProgress = flush;
    try { await flush; }
    finally { if (this.flushInProgress === flush) this.flushInProgress = undefined; }
    if (this.pendingUpdate !== undefined && !this.conflict) await this.flushPendingUpdate();
  }

  private async handleExternalModification(): Promise<void> {
    if (this.writingUpdate) return;
    const activeFlush = this.flushInProgress;
    if (activeFlush !== undefined) await activeFlush;
    if (this.file === null) return;
    if (this.pendingUpdate === undefined && this.queuedUpdateCount > 0) { this.conflict = true; this.renderUnavailable('This character changed externally while you had a pending edit. Reload before retrying.'); return; }
    try {
      const latest = await this.store.read(this.file);
      if (this.completedEditMode) {
        if (this.savedDocument !== undefined && !sameCharacterDocument(latest, this.savedDocument)) {
          this.conflict = true;
          await this.render();
        }
        return;
      }
      if (this.lastWrittenDocument !== undefined && sameCharacterDocument(latest, this.lastWrittenDocument)) {
        this.lastWrittenDocument = undefined;
        return;
      }
      if (this.pendingUpdate !== undefined) {
        this.conflict = true;
        this.renderUnavailable('This character changed externally while you had a pending edit. Reload before retrying.');
        return;
      }
      this.document = latest;
      await this.render();
    } catch (error) {
      this.renderUnavailable(error instanceof Error ? error.message : String(error));
    }
  }
}

export async function resolveToolLabels(sourceIndex: SourceIndex, selectors: ReadonlySet<string>, ruleset: CharacterRuleset): Promise<ReadonlyMap<string, string>> {
  const labels = new Map<string, string>();
  await Promise.all([...selectors].map(async (selector) => {
    try {
      const items = await sourceIndex.resolveSelector(selector, ruleset);
      const finalSegment = selector.split(':').at(-1);
      const match = items.find((item) => item.identifier?.toLocaleLowerCase() === finalSegment || item.id.toLocaleLowerCase() === finalSegment || item.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '') === finalSegment?.replace(/[^a-z0-9]+/g, ''));
      if (match !== undefined || items.length === 1) labels.set(selector, (match ?? items[0]!).name);
    } catch {
      // The sheet model retains a readable final-segment fallback.
    }
  }));
  return labels;
}

export async function resolveWeaponLabels(sourceIndex: SourceIndex, selectors: ReadonlySet<string>, ruleset: CharacterRuleset): Promise<ReadonlyMap<string, string>> {
  const labels = new Map<string, string>();
  const specific = [...selectors].filter((selector) => selector.startsWith('weapon:') && !['weapon:sim', 'weapon:mar', 'weapon:*'].includes(selector));
  if (specific.length === 0) return labels;
  try {
    const items = await sourceIndex.resolveSelector('weapon:*', ruleset);
    for (const selector of specific) {
      const key = selector.split(':').at(-1)?.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
      const match = items.find((item) => [item.subcategory, item.identifier, item.id].some((value) => value?.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === key));
      if (match !== undefined) labels.set(selector, match.name);
    }
  } catch { /* Keep the readable fallback when source data is unavailable. */ }
  return labels;
}

function speciesSizeLabel(value: string): string { return ({ tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan' }[value] ?? value); }

function hasEquipmentChoice(nodes: EquipmentPackageNode[]): boolean { return nodes.some((node) => node.type === 'OR' && (node.children?.length ?? 0) > 1 || node.children !== undefined && hasEquipmentChoice(node.children)); }
export function validateCharacterCreationReadiness(document: CharacterDocument, sources: CharacterSheetSources): string[] {
  const errors: string[] = [];
  if (document.ruleset === null) errors.push('Choose a ruleset before creating the character.');
  if (document.origin === undefined) errors.push('Choose a species before creating the character.');
  if (document.classProgressions?.length !== 1) errors.push('Choose exactly one class before creating the character.');
  if (document.background === undefined) errors.push('Choose a background before creating the character.');
  if (document.abilityScores === undefined) errors.push(document.abilityScoreDraft?.method === 'dice-rolling' ? 'Enter all six rolled scores between 3 and 18 before creating the character.' : document.abilityScoreDraft?.method === 'point-buy' ? 'Spend exactly 27 points on Point Buy before creating the character.' : document.abilityScoreDraft === undefined ? 'Assign ability scores before creating the character.' : 'Complete all six Standard Array assignments before creating the character.');
  else if (document.abilityScores.method === 'dice-rolling') for (const ability of ABILITIES) if (!isValidRolledBase(document.abilityScores.base[ability])) errors.push(`Rolled ${abilityLabel(ability)} base score must be between 3 and 18.`);
  if (document.inventory === undefined) errors.push('Choose starting equipment before creating the character.');
  if (sources.species === undefined) errors.push('Species source is unavailable.'); if (sources.class === undefined) errors.push('Class source is unavailable.'); if (sources.background === undefined) errors.push('Background source is unavailable.');
  if (errors.length > 0 || document.ruleset === null || document.abilityScores === undefined) return errors;
  const snapshot: SourceSnapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: document.foundry.sourceBranch, commit: document.foundry.sourceCommit, systemVersion: document.foundry.systemVersion };
  let restoredSpeciesConfiguration: SpeciesConfiguration | undefined;
  let restoredClassConfiguration: ClassConfiguration | undefined;
  if (sources.species !== undefined && document.origin !== undefined) {
    const summary = { ...sources.species, source: { ...sources.species.source, identifier: sources.species.source.identifier ?? document.origin.identifier } };
    const built = buildSpeciesConfiguration(summary, snapshot);
    const source = { origin: document.origin, summary, grants: built.grants, choices: built.choices, spellChoices: built.spellChoices };
    const restored = document.speciesConfiguration === undefined ? built : restoreSpeciesConfiguration(document.speciesConfiguration, source);
    restoredSpeciesConfiguration = restored;
    errors.push(...validateSpeciesConfiguration(restored, { ...source, snapshot }));
  }
  if (sources.class !== undefined && document.classProgressions?.length === 1) {
    const progression = document.classProgressions[0];
    try {
      const built = buildClassConfiguration(sources.class, snapshot, progression.targetLevel);
      const restored = restoreClassConfiguration(progression, { class: progression.class, summary: sources.class, configuration: built, snapshot });
      restoredClassConfiguration = restored;
      errors.push(...validateClassConfiguration(restored, { class: progression.class, summary: sources.class, configuration: built, snapshot }));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unable to validate class configuration.');
    }
    const expertiseProficiencies = restoredClassConfiguration === undefined
      ? []
      : collectExpertiseProficiencies({ classSummary: sources.class, classConfiguration: restoredClassConfiguration, background: sources.background, speciesSummary: sources.species, speciesConfiguration: restoredSpeciesConfiguration });
    const expertiseAdvancements = sources.class.advancements.filter((advancement) => {
      const configuration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : undefined;
      return advancement.type === 'Trait' && advancement.level <= progression.targetLevel && (advancement.classRestriction === undefined || advancement.classRestriction === 'primary') && configuration?.mode === 'expertise';
    });
    for (const advancement of expertiseAdvancements) {
      const configuration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : undefined;
      const expected = configuration === undefined ? undefined : typeof configuration.choices === 'number' ? configuration.choices : Array.isArray(configuration.choices) && isRecord(configuration.choices[0]) && typeof configuration.choices[0].count === 'number' ? configuration.choices[0].count : isRecord(configuration.choices) && isRecord(configuration.choices['1']) && typeof configuration.choices['1'].count === 'number' ? configuration.choices['1'].count : undefined;
      const selection = (restoredClassConfiguration?.selections ?? progression.selections).find((candidate): candidate is Extract<ClassAdvancementSelection, { kind: 'expertise' }> => candidate.kind === 'expertise' && candidate.advancementId === advancement.id);
      if (selection === undefined) {
        if (expected !== undefined) errors.push(`Choose exactly ${expected} expertise skill${expected === 1 ? '' : 's'}.`);
        continue;
      }
      if (expected !== undefined && selection.selected.length !== expected) errors.push(`Choose exactly ${expected} expertise skill${expected === 1 ? '' : 's'}.`);
      errors.push(...validateExpertiseSelections(selection.selected, getExpertisePool(advancement), expertiseProficiencies, selectorLabel));
    }
  }
  if (document.ruleset === '2024' && sources.background !== undefined) {
    const progression = document.classProgressions?.[0];
    const preBackground = calculateAbilityScores(document.abilityScores, sumAbilityBonuses(collectAbilityBonuses(sources.species!, sources.class!, progression, undefined)));
    const preBackgroundScores = Object.fromEntries(ABILITIES.map((ability) => [ability, preBackground[ability].final])) as Record<Ability, number>;
    const ability = buildBackgroundAbilityConfiguration(sources.background); if (ability.kind === 'choice') { if (document.backgroundChoices?.abilityScores === undefined) errors.push('Choose a background ability allocation before creating the character.'); else errors.push(...validateBackgroundAbilitySelection(ability, document.backgroundChoices.abilityScores, preBackgroundScores)); } else if (ability.kind === 'unsupported') errors.push(ability.reason);
    const feat = buildGrantedFeatConfiguration(sources.background.grantedFeat); if (feat.kind === 'unsupported') errors.push(feat.reason); else if (feat.kind === 'choice') errors.push(...validateGrantedFeatConfiguration(restoreGrantedFeatConfiguration(feat, document.backgroundChoices?.grantedFeat)));
  }
  if (sources.background !== undefined) {
    const required = sources.background.languageChoices.reduce((total, choice) => total + choice.count, 0);
    const allowed = new Set(getBackgroundLanguageOptions(sources.background).map((option) => languageSelectorKey(option.value)));
    const fixed = new Set(sources.background.languages.map(languageSelectorKey)); fixed.add('common');
    const selected = document.backgroundChoices?.languages ?? [];
    const keys = selected.map(languageSelectorKey);
    if (keys.length !== required) errors.push(`Choose exactly ${required} background language${required === 1 ? '' : 's'}.`);
    if (new Set(keys).size !== keys.length) errors.push('Background languages must be unique.');
    if (keys.some((key) => fixed.has(key) || !allowed.has(key))) errors.push('Saved background language selection is not allowed by the current source.');
  }
  const known = new Set<string>([
    ...(sources.class?.proficiencies?.languages ?? []),
    ...(sources.background?.languages ?? []),
  ].map(languageSelectorKey));
  known.add('common');
  const targetLevel = document.classProgressions?.[0]?.targetLevel ?? 1;
  for (const advancement of sources.species?.advancements ?? []) if (advancement.level <= targetLevel) {
    const configured = advancement.raw.configuration;
    if (isRecord(configured) && Array.isArray(configured.grants)) for (const value of configured.grants) if (typeof value === 'string' && value.startsWith('languages:')) known.add(languageSelectorKey(value));
  }
  let duplicateLanguage = false;
  const addSelectedLanguage = (value: string): void => {
    if (!value.startsWith('languages:')) return;
    const key = languageSelectorKey(value);
    if (known.has(key)) duplicateLanguage = true;
    known.add(key);
  };
  for (const value of getCurrentLevelSavedLanguageChoices(document, sources)) addSelectedLanguage(value);
  for (const value of document.backgroundChoices?.languages ?? []) addSelectedLanguage(value);
  if (duplicateLanguage) errors.push('Language choices must be unique across species, class, and background.');
  errors.push(...validateAbilityScores(document.abilityScores)); return [...new Set(errors)];
}
export function collectFinalizationResources(document: CharacterDocument, classSummary: ClassSourceSummary, species: SpeciesSourceSummary, background: BackgroundSourceSummary, proficiencyBonus: number): CharacterResource[] {
  const resources = new Map<string, CharacterResource>();
  const classLevel = document.classProgressions?.find((progression) => progression.class.sourcePath === classSummary.source.sourcePath)?.targetLevel ?? 0;
  const classScales = getEligibleClassScales(document, classSummary);
  const add = (key: string, uses: FoundryUsesSummary | undefined, classResource = false): void => {
    const reset = recoverableResetForUses(uses);
    if (reset === undefined) return;
    const scaleValue = classResource && typeof uses?.maximum === 'string' && uses.maximum.startsWith('@scale.')
      ? resolveFeatureScaleLookup(uses.maximum, { classIdentifier: classSummary.source.identifier, targetLevel: classLevel, scales: classScales }).value
      : undefined;
    const maximum = typeof uses?.maximum === 'number'
      ? uses.maximum
      : typeof uses?.maximum === 'string' && /^\d+$/.test(uses.maximum) ? Number(uses.maximum)
        : uses?.maximum === '@prof' ? proficiencyBonus
          : scaleValue?.type === 'number' ? scaleValue.value : undefined;
    if (maximum === undefined || !Number.isInteger(maximum) || maximum < 0) return;
    const recovery = mutableRecoveryProfiles(uses);
    resources.set(key, { key, current: maximum, maximum, reset, ...(recovery.length === 0 ? {} : { recovery }) });
  };
  for (const feature of getEligibleClassFeatures(document, classSummary)) {
    collectFeatureResource(feature.source.sourcePath, feature.uses, feature.activities, (key, uses) => add(key, uses, true));
  }
  for (const feature of getEligibleSpeciesFeatures(document, species)) collectFeatureResource(feature.source.sourcePath, feature.uses, feature.activities, add);
  for (const feature of background.features ?? []) collectFeatureResource(feature.source.sourcePath, feature.uses, feature.activities, add);
  return [...resources.values()];
}
export function collectFinalizationSpellUses(document: CharacterDocument, classSummary: ClassSourceSummary, species: SpeciesSourceSummary, targetLevel: number, background?: BackgroundSourceSummary, proficiencyBonus?: number): CharacterSpellUse[] {
  const uses = new Map<string, CharacterSpellUse>();
  const add = (reference: { sourcePath: string; pack: string; type: string; id: string }, raw: Record<string, unknown> | undefined): void => {
    const configuration = raw !== undefined && isRecord(raw.configuration) ? raw.configuration : undefined;
    const spell = configuration !== undefined && isRecord(configuration.spell) ? configuration.spell : undefined;
    const value = spell !== undefined && isRecord(spell.uses) ? spell.uses : undefined;
    if (value === undefined || value.requireSlot !== false) return;
    const maximum = typeof value.max === 'number' ? value.max : value.max === '@prof' ? proficiencyBonus : typeof value.max === 'string' && /^\d+$/.test(value.max) ? Number(value.max) : undefined;
    if (maximum === undefined || !Number.isInteger(maximum) || maximum < 0) return;
    const key = `${reference.sourcePath}:${reference.pack}:${reference.type}:${reference.id}`;
    const per = typeof value.per === 'string' ? value.per : undefined;
    const reset = per === undefined ? 'none' : mutableResetForPeriod(per);
    if (reset === undefined) return;
    const recovery = reset === 'short-rest' || reset === 'long-rest' ? [{ period: reset, type: 'recover-all' as const }] : [];
    uses.set(key, { key, current: maximum, maximum, reset, ...(recovery.length === 0 ? {} : { recovery }) });
  };
  const classAdvancementIds = new Set([...classSummary.advancements.filter((entry) => entry.level <= targetLevel).map((entry) => entry.id), ...getLevelOneDerivedSpellChoices(classSummary, targetLevel).map((entry) => entry.advancementId)]);
  for (const selection of document.classProgressions?.flatMap((entry) => entry.selections) ?? []) if (selection.kind === 'spell' && classAdvancementIds.has(selection.advancementId)) for (const reference of selection.selected) add(reference, selection.raw);
  for (const choice of document.speciesConfiguration?.spellChoices ?? []) if (choice.kind === 'spell') { const advancement = species.advancements.find((entry) => entry.id === choice.advancementId); if (advancement !== undefined && advancement.level <= targetLevel) for (const reference of choice.selected) add(reference, advancement.raw); }
  for (const grant of species.spellGrants ?? []) if (grant.level <= targetLevel) for (const reference of grant.spells) add(reference, grant.raw);
  for (const choice of document.backgroundChoices?.grantedFeat?.spellChoices ?? []) if (choice.kind === 'spell') for (const reference of choice.selected) add(reference, background?.grantedFeat?.advancements.find((entry) => entry.id === choice.advancementId)?.raw);
  return [...uses.values()];
}
function collectFeatureResource(sourcePath: string, uses: FoundryUsesSummary | undefined, activities: Array<{ id: string; uses?: FoundryUsesSummary }> | undefined, add: (key: string, uses: FoundryUsesSummary | undefined) => void): void {
  add(`feature:${sourcePath}`, uses);
  for (const activity of activities ?? []) add(`feature:${sourcePath}:activity:${activity.id}`, activity.uses);
}

function restSelectionSignature(document: CharacterDocument): string {
  return JSON.stringify({
    ruleset: document.ruleset,
    origin: document.origin,
    speciesConfiguration: document.speciesConfiguration,
    classProgressions: document.classProgressions,
    background: document.background,
    backgroundChoices: document.backgroundChoices,
  });
}
function isReadyForCharacterCreation(document: CharacterDocument): boolean {
  return document.ruleset !== null && document.origin !== undefined && document.classProgressions?.length === 1 && document.background !== undefined && hasValidCreationAbilityScores(document) && document.inventory !== undefined;
}

function hasValidCreationAbilityScores(document: CharacterDocument): boolean {
  return document.abilityScores !== undefined && (document.abilityScores.method !== 'dice-rolling' || ABILITIES.every((ability) => isValidRolledBase(document.abilityScores?.base[ability]))) && (document.abilityScores.method !== 'point-buy' || pointBuyRemaining(document.abilityScores.base) === 0);
}
function pointBuyStatusText(draft: PointBuyDraft): string { const remaining = pointBuyRemaining(draft.base); return remaining === 0 ? 'Point Buy complete: exactly 27 points spent.' : `Spend exactly 27 points; ${remaining} points remaining.`; }
function abilityLabel(ability: Ability | string): string { return ({ str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' } as const)[ability as Ability] ?? ability; }
function backgroundLanguageLabel(value: string): string { const key = value.split(':').at(-1) ?? value; return selectorLabel(`languages:${key}`); }
function formatModifier(value: number): string { return value >= 0 ? `+${value}` : String(value); }
function equipmentSearchSelector(node: EquipmentPackageNode): string {
  if (node.semantic === undefined) return '*';
  if (node.semantic.category === 'weapon') {
    const category = node.semantic.selector.toLocaleLowerCase();
    return category.includes('martial') || category === 'mar' ? 'weapon:mar:*' : category.includes('simple') || category === 'sim' ? 'weapon:sim:*' : 'weapon:*';
  }
  if (node.semantic.category === 'tool') return `tool:${node.semantic.selector.replace(/:\*$/, '')}:*`;
  if (node.semantic.category === 'armor') return `armor:${node.semantic.selector.replace(/:\*$/, '')}:*`;
  if (node.semantic.category === 'focus') return 'focus:*';
  return `${node.semantic.category}:*`;
}

function spellCatalogQuery(sourceIndex: SourceIndex, ruleset: CharacterRuleset): SpellCatalogQuery | undefined {
  if (!isSpellSearchIndex(sourceIndex)) return undefined;
  return async (filters) => (await sourceIndex.searchSpells({ ruleset, ...filters })).map((spell) => ({ value: `${spell.pack}:${spell.type}:${spell.id}`, source: spell, label: spell.name, ...(spell.description === undefined ? {} : { description: spell.description }) }));
}

function isSpellSearchIndex(sourceIndex: SourceIndex): sourceIndex is SourceIndex & { searchSpells: (filters: SpellSearchFilters) => Promise<FoundrySpellSummary[]> } {
  return 'searchSpells' in sourceIndex && typeof sourceIndex.searchSpells === 'function';
}

function stableSpellReference(source: FoundrySourceReference): FoundrySourceReference {
  return { sourcePath: source.sourcePath, pack: source.pack, type: source.type, id: source.id, name: source.name, ...(source.identifier === undefined ? {} : { identifier: source.identifier }) };
}

function normalizeCharacterViewState(value: unknown): CharacterViewState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const filePath = record.filePath;
  if (filePath !== undefined && (typeof filePath !== 'string' || filePath.length === 0)) return null;
  if (record.mode === 'create') return typeof filePath === 'string' ? { mode: 'create', filePath } : null;
  if (record.mode === 'open') return { mode: 'open', ...(typeof filePath === 'string' ? { filePath } : {}), section: isCharacterSheetSection(record.section) ? record.section : 'abilities' };
  return null;
}
function isEmptyViewState(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0; }
function sameCharacterDocument(left: CharacterDocument, right: CharacterDocument): boolean { return JSON.stringify(left) === JSON.stringify(right); }
