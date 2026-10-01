import { calculateAbilityScores, collectAbilityBonuses, createDefaultAbilityScores, sumAbilityBonuses, type AbilityBonusSources } from '../../src/ability-scores';
import { buildBackgroundAbilityConfiguration, createBackgroundAbilitySelection, validateBackgroundAbilitySelection, type BackgroundAbilitySelection } from '../../src/background-ability-configuration';
import { buildClassConfiguration, setClassSelection, toClassProgressionSelection } from '../../src/class-configuration';
import { createCharacterDocument, withOrigin, withRuleset, type CharacterDocument } from '../../src/character-model';
import { projectCharacterSheet } from '../../src/character-sheet-model';
import { projectFeatureSheet } from '../../src/feature-sheet-model';
import type { BackgroundAbilityScores, ClassAdvancementSummary, FoundrySourceReference, SourceIndex, SpeciesAdvancementSummary } from '../../src/character-sources';
import type { FoundrySpellSummary } from '../../src/foundry-source-catalog';
import { getBackgroundLanguageOptions, getBackgroundOverview, getBackgroundRenderState, getCharacterCreationSections, getClassFeatureCallouts, getClassRenderState, getSpeciesFeatureCallouts, getSpeciesRenderState, validateCharacterCreationReadiness } from '../../src/character-view';
import { buildGrantedFeatConfiguration, getAvailableGrantedFeatSpellChoices, restoreGrantedFeatConfiguration, setGrantedFeatSpellChoice, setGrantedFeatSpellcastingAbility, toGrantedFeatSelection, validateGrantedFeatConfiguration, type GrantedFeatChoiceConfiguration, type GrantedFeatSelection } from '../../src/granted-feat-configuration';
import { projectSpellSheet } from '../../src/spell-sheet-model';
import { createFinalizedMutableCharacterState } from '../../src/mutable-character-state';
import type { CharacterSheetSources } from '../../src/character-sheet-model';
import { resolveStartingEquipmentItems, type EquipmentPackageNode, type EquipmentPackageSummary } from '../../src/equipment';
import { languageSelectorKey } from '../../src/foundry-source-catalog';
import { emptyInventory, flattenSelectedEquipment, mergeInventories, type CharacterInventory, type EquipmentSelection, type InventoryCurrency } from '../../src/inventory';
import { buildSpeciesConfiguration, setSpeciesSize, setSpeciesSpellcastingAbility, toSpeciesConfigurationSelection } from '../../src/species-configuration';
import type { SourceSnapshot } from '../../src/source-tree';
import { stringValues } from '../../src/foundry-utils';

export type AuditCategory = 'eligibility' | 'choice' | 'equipment' | 'selector' | 'presentation' | 'resolution' | 'calculation';
export type AuditSeverity = 'error' | 'warning';
export type AuditStage = 'species' | 'class' | 'background' | 'ability-scores' | 'inventory' | 'sheet';

export interface AuditFinding {
  invariant: string;
  category: AuditCategory;
  severity: AuditSeverity;
  ruleset: '2024';
  stage: AuditStage;
  sourceName: string;
  sourcePath: string;
  nodeId?: string;
  observed: string;
  expected: string;
  relatedSourcePaths: string[];
  rootCause: string;
}

export interface AuditCoverage {
  species: number;
  classes: number;
  backgrounds: number;
}

export interface CharacterCreationAuditResult {
  coverage: AuditCoverage;
  findings: AuditFinding[];
}

/** Source-backed level-one facts which must eventually reach creation or the sheet. */
export interface LevelOneSourceCompletenessInventory {
  sizeChoices: Array<{ sourcePath: string; advancementId: string; options: string[] }>;
  fixedSpells: Array<{ sourcePath: string; advancementId: string; spellKey: string; abilityOptions: string[]; freeUses?: string; recovery?: string; requireSlot?: boolean }>;
  scales: Array<{ sourcePath: string; advancementId: string; identifier?: string; levelOneValue?: string }>;
  hpEffects: Array<{ sourcePath: string; advancementId: string; value: number; key: string }>;
  advantageAnnotations: Array<{ sourcePath: string; advancementId: string; abilities: string[] }>;
  expertise: Array<{ sourcePath: string; advancementId: string; count: number; pool: string[] }>;
}

export interface LevelOneCreationSheetProjection {
  sizeChoices?: Array<{ sourcePath: string; advancementId: string; selected?: string }>;
  fixedSpells?: Array<{ sourcePath: string; advancementId: string; spellKey: string; freeUses?: string; recovery?: string; requireSlot?: boolean }>;
  spellcastingAbilities?: Array<{ sourcePath: string; advancementIds?: string[]; selected?: string }>;
  scales?: Array<{ sourcePath: string; advancementId: string; value?: string }>;
  hpEffects?: Array<{ sourcePath: string; advancementId: string; value: number; key: string }>;
  advantageAnnotations?: Array<{ sourcePath: string; advancementId: string; abilities: string[] }>;
  expertise?: Array<{ sourcePath: string; advancementId: string; selected: string[] }>;
}

export type AuditFindingInput = Omit<AuditFinding, 'severity' | 'ruleset' | 'relatedSourcePaths'>
  & Partial<Pick<AuditFinding, 'severity' | 'relatedSourcePaths'>>;

export interface EligibilityAuditFixture {
  targetLevel: number;
  visibleSpeciesFeatures: Array<{ name: string; sourcePath: string; level: number; advancementId: string }>;
  classSource: { name: string; sourcePath: string };
  classAdvancements: Array<{ id: string; type: string; level: number; raw: Record<string, unknown> }>;
}

export interface AuditProfileFixture {
  sourceName: string;
  sourcePath: string;
  sourceStage?: 'class' | 'background';
  abilityScores?: BackgroundAbilityScores;
  abilitySelection?: BackgroundAbilitySelection;
  abilityAllocationReason?: string;
  featAdvancements?: unknown[];
  grantedFeatConfiguration?: GrantedFeatChoiceConfiguration;
  grantedFeatSelection?: GrantedFeatSelection;
  startingEquipment?: EquipmentPackageSummary;
  wealth?: string;
  knownLanguages?: string[];
  languagePools?: string[];
  availableLanguageValues?: string[];
  userFacingValues?: unknown[];
}

interface InteractionSource {
  sourceName: string;
  sourcePath: string;
}

export interface AbilityProjectionAuditFixture extends InteractionSource {
  targetLevel: number;
  bonuses: AbilityBonusSources;
}

export interface LanguageOptionAuditFixture extends InteractionSource {
  knownLanguages: string[];
  availableLanguages: string[];
}

export interface EquipmentMergeAuditFixture extends InteractionSource {
  inventory: CharacterInventory;
  expectedSourcePaths: string[];
  expectedCurrency: Partial<InventoryCurrency>;
}

export interface FeatureProjectionAuditFixture extends InteractionSource {
  featureKeys: string[];
}

export interface BackgroundCompletionAuditFixture extends InteractionSource {
  requiresFeatChoice: boolean;
  backgroundComplete: boolean;
}

const AUDIT_SNAPSHOT: SourceSnapshot = {
  owner: 'foundryvtt',
  repo: 'dnd5e',
  branch: '6.0.x',
  commit: '7df9c03977619338725b607eae2fe4efda664028',
  systemVersion: '6.0.0',
};
const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

export function createAuditFinding(input: AuditFindingInput): AuditFinding {
  return {
    ...input,
    severity: input.severity ?? 'error',
    ruleset: '2024',
    relatedSourcePaths: [...(input.relatedSourcePaths ?? [])],
  };
}

/**
 * Inventory of the pinned source meanings which are relevant to level-one
 * completeness. Later-level records remain in the source index, but are not
 * included in this level-one contract.
 */
export async function inventoryLevelOneSourceCompleteness(index: SourceIndex): Promise<LevelOneSourceCompletenessInventory> {
  const [speciesSources, classSources] = await Promise.all([index.listSpecies('2024'), index.listClasses('2024')]);
  const inventory: LevelOneSourceCompletenessInventory = {
    sizeChoices: [], fixedSpells: [], scales: [], hpEffects: [], advantageAnnotations: [], expertise: [],
  };
  for (const source of speciesSources) {
    const summary = await index.getSpeciesSummary('2024', source.sourcePath);
    for (const advancement of summary.advancements) {
      if (advancement.level > 1) continue;
      const configuration = record(advancement.raw.configuration);
      if (advancement.type === 'Size') {
        const options = stringValues(configuration.sizes);
        if (options.length > 1) inventory.sizeChoices.push({ sourcePath: source.sourcePath, advancementId: advancement.id, options });
      }
      if (advancement.type === 'ScaleValue') {
        const scale = record(configuration.scale);
        const levelOne = record(scale['0']);
        inventory.scales.push({
          sourcePath: source.sourcePath,
          advancementId: advancement.id,
          ...(typeof configuration.identifier === 'string' ? { identifier: configuration.identifier } : {}),
          ...(typeof levelOne.number === 'number' && typeof levelOne.faces === 'number' ? { levelOneValue: `${levelOne.number}d${levelOne.faces}` } : {}),
        });
      }
      if (advancement.type === 'ItemGrant' && record(configuration.spell).ability !== undefined) {
        const spell = record(configuration.spell);
        const uses = record(spell.uses);
        for (const dependency of advancement.dependencies) {
          if (dependency.source?.type !== 'spell') continue;
          inventory.fixedSpells.push({
            sourcePath: source.sourcePath,
            advancementId: advancement.id,
            spellKey: sourceReferenceKey(dependency.source),
            abilityOptions: stringValues(spell.ability),
            ...(typeof uses.max === 'string' && uses.max.length > 0 ? { freeUses: uses.max } : {}),
            ...(typeof uses.per === 'string' && uses.per.length > 0 ? { recovery: uses.per } : {}),
            ...(typeof uses.requireSlot === 'boolean' ? { requireSlot: uses.requireSlot } : {}),
          });
        }
      }
      if (advancement.type !== 'ItemGrant') continue;
      for (const dependency of advancement.dependencies) {
        if (dependency.source?.type !== 'feat') continue;
        const raw = index.getRaw(dependency.source.sourcePath);
        const effects = Array.isArray(raw?.effects) ? raw.effects : [];
        const hpChanges = effects.flatMap((effect) => record(effect).system).flatMap((system) => {
          const rawChanges = record(system).changes;
          const changes: unknown[] = Array.isArray(rawChanges) ? rawChanges : [];
          return changes.flatMap((change) => {
            const value = record(change);
            return value.key === 'system.attributes.hp.bonuses.level' && typeof value.value === 'number' ? [{ value: value.value, key: value.key }] : [];
          });
        });
        for (const change of hpChanges) inventory.hpEffects.push({ sourcePath: source.sourcePath, advancementId: advancement.id, ...change });
        const saveAbilities = effects.flatMap((effect) => record(effect).system).flatMap((system) => {
          const rawChanges = record(system).changes;
          const changes: unknown[] = Array.isArray(rawChanges) ? rawChanges : [];
          return changes.flatMap((change) => {
            const key = record(change).key;
            const match = typeof key === 'string' ? key.match(/^system\.abilities\.(str|dex|con|int|wis|cha)\.save\.roll\.mode$/) : null;
            return match?.[1] !== undefined && record(change).value === 1 ? [match[1]] : [];
          });
        });
        if (saveAbilities.length > 0) inventory.advantageAnnotations.push({ sourcePath: source.sourcePath, advancementId: advancement.id, abilities: [...new Set(saveAbilities)] });
      }
    }
  }
  for (const source of classSources) {
    const summary = await index.getClassSummary('2024', source.sourcePath);
    for (const advancement of summary.advancements) {
      if (advancement.level > 1 || advancement.type !== 'Trait') continue;
      const configuration = record(advancement.raw.configuration);
      if (configuration.mode !== 'expertise') continue;
      const choices = Array.isArray(configuration.choices) ? configuration.choices : [];
      const choice = record(choices[0]);
      inventory.expertise.push({ sourcePath: source.sourcePath, advancementId: advancement.id, count: typeof choice.count === 'number' ? choice.count : 0, pool: stringValues(choice.pool) });
    }
  }
  return inventory;
}

function completenessFinding(input: Omit<AuditFindingInput, 'category'> & { category: AuditCategory }): AuditFinding {
  return createAuditFinding({ ...input, severity: 'error' });
}

/** Compare source inventory with the currently available creation/sheet projection. */
export function auditLevelOneSourceCompleteness(inventory: LevelOneSourceCompletenessInventory, projection: LevelOneCreationSheetProjection = {}): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const expected of inventory.sizeChoices) if (!(projection.sizeChoices ?? []).some((entry) => entry.sourcePath === expected.sourcePath && entry.advancementId === expected.advancementId && entry.selected !== undefined && expected.options.includes(entry.selected))) findings.push(completenessFinding({ invariant: 'choice.species-size', category: 'choice', stage: 'species', sourceName: expected.sourcePath, sourcePath: expected.sourcePath, nodeId: expected.advancementId, observed: `No valid selected size for ${expected.options.join(' or ')}`, expected: `One persisted size choice from ${expected.options.join(', ')}`, rootCause: 'species-size-projection' }));
  for (const expected of inventory.fixedSpells) {
    const projected = (projection.fixedSpells ?? []).find((entry) => entry.sourcePath === expected.sourcePath && entry.advancementId === expected.advancementId && entry.spellKey === expected.spellKey);
    if (projected === undefined) findings.push(completenessFinding({ invariant: 'presentation.species-spell', category: 'presentation', stage: 'sheet', sourceName: expected.sourcePath, sourcePath: expected.sourcePath, nodeId: expected.advancementId, observed: `Fixed spell ${expected.spellKey} is absent`, expected: 'Every eligible fixed species spell in the spell projection', rootCause: 'species-spell-projection' }));
    const expectedMaximum = expected.freeUses === '@prof' ? '2' : expected.freeUses;
    if (expected.freeUses !== undefined && (projected?.freeUses !== expectedMaximum || projected?.recovery !== expected.recovery || projected?.requireSlot !== expected.requireSlot)) findings.push(completenessFinding({ invariant: 'presentation.species-spell-use', category: 'presentation', stage: 'sheet', sourceName: expected.sourcePath, sourcePath: expected.sourcePath, nodeId: expected.advancementId, observed: `Free-use metadata for maximum ${expected.freeUses} is absent or incorrect`, expected: `Free-use maximum ${expected.freeUses}, recovery ${expected.recovery ?? 'none'}, require slot ${String(expected.requireSlot)}`, rootCause: 'species-spell-use-projection' }));
  }
  const spellsBySpecies = new Map<string, LevelOneSourceCompletenessInventory['fixedSpells']>();
  for (const spell of inventory.fixedSpells) {
    if (spell.abilityOptions.length <= 1) continue;
    const spells = spellsBySpecies.get(spell.sourcePath) ?? [];
    spells.push(spell);
    spellsBySpecies.set(spell.sourcePath, spells);
  }
  for (const [sourcePath, spells] of spellsBySpecies) {
    const allowed = [...new Set(spells.flatMap((entry) => entry.abilityOptions))];
    const advancementIds = [...new Set(spells.map((entry) => entry.advancementId))];
    const projected = (projection.spellcastingAbilities ?? []).find((entry) => entry.sourcePath === sourcePath && entry.selected !== undefined && spells.every((spell) => spell.abilityOptions.some((ability) => ability.toLowerCase().startsWith(entry.selected!.toLowerCase().slice(0, 3)))));
    if (projected === undefined) findings.push(completenessFinding({ invariant: 'choice.species-spellcasting-ability', category: 'choice', stage: 'species', sourceName: sourcePath, sourcePath, nodeId: advancementIds.join(','), observed: `No species-wide selected ability from ${allowed.join(', ')}`, expected: 'One selected ability valid for every eligible fixed species spell grant', rootCause: 'species-spellcasting-ability' }));
  }
  for (const expected of inventory.scales) if (!(projection.scales ?? []).some((entry) => entry.sourcePath === expected.sourcePath && entry.advancementId === expected.advancementId && entry.value === expected.levelOneValue)) findings.push(completenessFinding({ invariant: 'presentation.species-scale', category: 'presentation', stage: 'sheet', sourceName: expected.sourcePath, sourcePath: expected.sourcePath, nodeId: expected.advancementId, observed: 'No correct projected level-one scale value', expected: expected.levelOneValue ?? 'A projected level-one scale value', rootCause: 'species-scale-projection' }));
  for (const expected of inventory.hpEffects) if (!(projection.hpEffects ?? []).some((entry) => entry.sourcePath === expected.sourcePath && entry.advancementId === expected.advancementId && entry.value === expected.value && entry.key === expected.key)) findings.push(completenessFinding({ invariant: 'calculation.species-hp-effect', category: 'calculation', stage: 'sheet', sourceName: expected.sourcePath, sourcePath: expected.sourcePath, nodeId: expected.advancementId, observed: `HP level bonus ${expected.value} is not projected`, expected: `Maximum HP includes ${expected.value} per level`, rootCause: 'species-hp-effect' }));
  for (const expected of inventory.advantageAnnotations) if (!(projection.advantageAnnotations ?? []).some((entry) => entry.sourcePath === expected.sourcePath && entry.advancementId === expected.advancementId && expected.abilities.every((ability) => entry.abilities.includes(ability)))) findings.push(completenessFinding({ invariant: 'presentation.species-save-advantage', category: 'presentation', stage: 'sheet', sourceName: expected.sourcePath, sourcePath: expected.sourcePath, nodeId: expected.advancementId, observed: `No advantage annotations for ${expected.abilities.join(', ')}`, expected: 'Systematic saving-throw advantage annotations', rootCause: 'species-save-advantage' }));
  for (const expected of inventory.expertise) if (!(projection.expertise ?? []).some((entry) => entry.sourcePath === expected.sourcePath && entry.advancementId === expected.advancementId && entry.selected.length === expected.count)) findings.push(completenessFinding({ invariant: 'choice.class-expertise', category: 'choice', stage: 'class', sourceName: expected.sourcePath, sourcePath: expected.sourcePath, nodeId: expected.advancementId, observed: 'No level-one expertise selection', expected: `${expected.count} proficient skill expertise selections`, rootCause: 'class-expertise-projection' }));
  return findings.sort(compareFindings);
}

/** Build one deterministic, source-backed level-one projection for the completeness audit. */
export async function buildLevelOneCreationSheetProjection(index: SourceIndex, inventory?: LevelOneSourceCompletenessInventory): Promise<LevelOneCreationSheetProjection> {
  inventory ??= await inventoryLevelOneSourceCompleteness(index);
  const projection: LevelOneCreationSheetProjection = { sizeChoices: [], fixedSpells: [], spellcastingAbilities: [], scales: [], hpEffects: [], advantageAnnotations: [], expertise: [] };
  const speciesSources = await index.listSpecies('2024');
  const spellCatalog = [...await index.searchSpells({ ruleset: '2024', level: 0 }), ...await index.searchSpells({ ruleset: '2024', level: 1 })];
  const representativeClassSource = (await index.listClasses('2024'))[0];
  const representativeClass = representativeClassSource === undefined ? undefined : await index.getClassSummary('2024', representativeClassSource.sourcePath);
  for (const source of speciesSources) {
    const summary = await index.getSpeciesSummary('2024', source.sourcePath);
    let configuration = buildSpeciesConfiguration(summary, AUDIT_SNAPSHOT);
    const size = configuration.size;
    if (size !== undefined) {
      if (size.selected === undefined) configuration = setSpeciesSize(configuration, size.options[0]!);
      const selectedSize = configuration.size;
      if (selectedSize !== undefined) projection.sizeChoices!.push({ sourcePath: source.sourcePath, advancementId: selectedSize.advancementId, selected: selectedSize.selected });
    }
    const grants = configuration.spellGrants ?? [];
    const ability = configuration.spellcastingAbility;
    if (ability !== undefined) {
      if (ability.selected === undefined) configuration = setSpeciesSpellcastingAbility(configuration, 'species-spellcasting-ability', ability.options[0]!);
      const selectedAbility = configuration.spellcastingAbility;
      if (selectedAbility !== undefined) projection.spellcastingAbilities!.push({ sourcePath: source.sourcePath, advancementIds: selectedAbility.advancementIds, selected: selectedAbility.selected });
    }
    const spellSummaries = new Map<string, FoundrySpellSummary>();
    for (const grant of grants.filter((entry) => entry.level <= 1)) for (const spell of grant.spells) {
      const match = spellCatalog.find((candidate) => candidate.sourcePath === spell.sourcePath && candidate.id === spell.id);
      if (match !== undefined) spellSummaries.set(sourceReferenceKey(spell), match);
    }
    const speciesDocument = withOrigin(withRuleset(createCharacterDocument('Audit character', AUDIT_SNAPSHOT), '2024'), { sourcePath: source.sourcePath, identifier: source.identifier ?? '', id: source.id });
    const spellProjection = projectSpellSheet({ ...speciesDocument, speciesConfiguration: toSpeciesConfigurationSelection(configuration) }, { species: summary, spellSummaries, progression: { class: { sourcePath: 'audit', identifier: 'audit', id: 'audit' }, targetLevel: 1, selections: [] }, proficiencyBonus: { kind: 'available', value: 2 } });
    for (const grant of grants.filter((entry) => entry.level <= 1)) for (const spell of grant.spells) {
      const key = sourceReferenceKey(spell);
      const row = [...spellProjection.cantrips, ...spellProjection.levels.flatMap((level) => level.spells)].find((candidate) => candidate.source.kind === 'available' && sourceReferenceKey(candidate.source.value) === key);
      const free = spellProjection.freeUses.find((entry) => entry.key === key);
      if (row !== undefined) projection.fixedSpells!.push({ sourcePath: source.sourcePath, advancementId: grant.advancementId, spellKey: key, ...(free === undefined ? {} : { freeUses: String(free.maximum), recovery: free.recoveryPeriod, requireSlot: false }) });
    }
    const featureProjection = projectFeatureSheet({ ...speciesDocument, classProgressions: [{ class: { sourcePath: 'audit', identifier: 'audit', id: 'audit' }, targetLevel: 1, selections: [] }] }, { species: summary });
    for (const scale of summary.scales ?? []) {
      const value = scale.values.get(0);
      const text = value === undefined ? undefined : value.type === 'dice' ? `${value.number ?? ''}d${value.faces}` : value.type === 'number' ? String(value.value) : `${value.value} ${value.units}`;
      const resolved = featureProjection.groups.flatMap((group) => group.entries.flatMap((entry) => entry.activities.map((activity) => activity.resolvedDamage ?? ''))).some((damage) => text !== undefined && damage.includes(text));
      if (resolved) projection.scales!.push({ sourcePath: source.sourcePath, advancementId: scale.advancementId, value: text });
    }
    const hitPointModifiers = summary.hitPointModifiers ?? [];
    if (hitPointModifiers.length > 0) {
      const state = createFinalizedMutableCharacterState(emptyInventory(), { classSourcePath: 'audit', classHitDie: 'd8', constitutionModifier: 0, spellSlots: [], permanentHitPointModifiers: hitPointModifiers.map((modifier) => ({ perLevel: modifier.perLevel, sourcePath: modifier.source.sourcePath })) });
      for (const expected of inventory.hpEffects.filter((entry) => entry.sourcePath === source.sourcePath)) if (state.hitPoints?.maximum === 8 + expected.value) projection.hpEffects!.push({ ...expected });
    }
    const sheet = representativeClass === undefined ? undefined : projectCharacterSheet({ ...speciesDocument, speciesConfiguration: toSpeciesConfigurationSelection(configuration), classProgressions: [{ class: { sourcePath: representativeClass.source.sourcePath, identifier: representativeClass.source.identifier ?? '', id: representativeClass.source.id }, targetLevel: 1, selections: [] }] }, { species: summary, class: representativeClass, warnings: [] });
    for (const expected of inventory.advantageAnnotations.filter((entry) => entry.sourcePath === source.sourcePath)) if (sheet !== undefined && expected.abilities.every((ability) => sheet.savingThrows.find((row) => row.ability === ability)?.annotations?.some((annotation) => annotation.marker === 'A'))) projection.advantageAnnotations!.push({ ...expected });
  }
  const classSources = await index.listClasses('2024');
  for (const source of classSources) {
    const expected = inventory.expertise.find((entry) => entry.sourcePath === source.sourcePath);
    if (expected === undefined) continue;
    const configuration = buildClassConfiguration(await index.getClassSummary('2024', source.sourcePath), AUDIT_SNAPSHOT, 1);
    const choice = configuration.choices.find((entry): entry is Extract<typeof entry, { kind: 'expertise' }> => entry.kind === 'expertise' && entry.advancementId === expected.advancementId);
    if (choice === undefined) continue;
    let selected = expected.pool.flatMap((value) => value === 'skills:*' ? ['skills:acr', 'skills:ste'] : [value]).slice(0, expected.count);
    let applied = configuration;
    const skillChoice = configuration.choices.find((entry): entry is Extract<typeof entry, { kind: 'trait' }> => entry.kind === 'trait' && (entry.configuredPool ?? []).some((value) => value.startsWith('skills:')));
    if (skillChoice !== undefined) {
      const skillPool = (skillChoice.configuredPool ?? []).filter((value) => value.startsWith('skills:'));
      const raw = applied.advancements.find((entry) => entry.id === skillChoice.advancementId)?.raw.configuration;
      const groups = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).choices) ? (raw as Record<string, unknown>).choices as unknown[] : [];
      const count = groups[0] && typeof groups[0] === 'object' && typeof (groups[0] as Record<string, unknown>).count === 'number' ? (groups[0] as Record<string, unknown>).count as number : skillPool.length;
      applied = setClassSelection(applied, { ...skillChoice, selected: skillPool.slice(0, count) });
      selected = skillPool.slice(0, expected.count);
    }
    applied = setClassSelection(applied, { ...choice, selected });
    const progression = toClassProgressionSelection(applied);
    const classSummary = await index.getClassSummary('2024', source.sourcePath);
    const auditSpecies = await index.getSpeciesSummary('2024', (await index.listSpecies('2024'))[0]!.sourcePath);
    const auditBackground = await index.getBackgroundSummary('2024', (await index.listBackgrounds('2024'))[0]!.sourcePath);
    const sheet = projectCharacterSheet({ ...withRuleset(createCharacterDocument('Audit character', AUDIT_SNAPSHOT), '2024'), classProgressions: [progression], abilityScores: createDefaultAbilityScores() }, { species: auditSpecies, class: classSummary, background: auditBackground, warnings: [] });
    const projected = selected.every((skill) => {
      const row = sheet.skills.find((candidate) => candidate.key === skill.slice('skills:'.length));
      return row?.training?.kind === 'available' && row.training.value === 2;
    });
    if (projected) projection.expertise!.push({ sourcePath: source.sourcePath, advancementId: expected.advancementId, selected });
  }
  return projection;
}

export function auditEligibilityFixtures(fixture: EligibilityAuditFixture): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const advancement of fixture.classAdvancements) {
    if (advancement.level <= fixture.targetLevel || advancement.type !== 'AbilityScoreImprovement') continue;
    const configuration = record(advancement.raw.configuration);
    const fixed = record(configuration.fixed);
    const bonuses = Object.entries(fixed).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] !== 0);
    if (bonuses.length === 0) continue;
    findings.push(createAuditFinding({
      invariant: 'eligibility.class-fixed-bonus', category: 'eligibility', stage: 'ability-scores',
      sourceName: fixture.classSource.name, sourcePath: fixture.classSource.sourcePath, nodeId: advancement.id,
      observed: bonuses.map(([ability, value]) => `${ability} ${value > 0 ? '+' : ''}${value}`).join(', '),
      expected: `No class ability bonus above level ${fixture.targetLevel}`,
      rootCause: 'class-advancement-level',
    }));
  }
  for (const feature of fixture.visibleSpeciesFeatures) {
    if (feature.level <= fixture.targetLevel) continue;
    findings.push(createAuditFinding({
      invariant: 'eligibility.species-feature-level', category: 'eligibility', stage: 'species',
      sourceName: feature.name, sourcePath: feature.sourcePath, nodeId: feature.advancementId,
      observed: `Feature level ${feature.level} is visible at level ${fixture.targetLevel}`,
      expected: `Feature level at or below ${fixture.targetLevel}`,
      rootCause: 'species-feature-level',
    }));
  }
  return findings.sort(compareFindings);
}

export function auditProfileFixture(fixture: AuditProfileFixture): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const sourceStage = fixture.sourceStage ?? 'background';
  const abilityScores = fixture.abilityScores;
  const abilityAllocationErrors = abilityScores === undefined || (abilityScores.points ?? 0) <= 0 || fixture.abilitySelection === undefined
    ? []
    : validateBackgroundAbilitySelection(buildBackgroundAbilityConfiguration({
      source: { sourcePath: fixture.sourcePath, pack: 'audit', type: 'background', id: fixture.sourceName, name: fixture.sourceName },
      ruleset: '2024', abilityScores, skills: [], languages: [], languageChoices: [], tools: [], features: [], equipment: [],
    }), fixture.abilitySelection);
  if ((abilityScores?.points ?? 0) > 0 && (fixture.abilitySelection === undefined || abilityAllocationErrors.length > 0)) {
    const eligible = ABILITY_IDS.filter((ability) => !(abilityScores?.locked ?? []).includes(ability));
    findings.push(createAuditFinding({
      invariant: 'choice.background-ability-allocation', category: 'choice', stage: sourceStage,
      sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
      observed: fixture.abilityAllocationReason ?? abilityAllocationErrors[0] ?? `${abilityScores?.points ?? 0} points across ${eligible.join(', ') || 'unspecified abilities'} with cap ${abilityScores?.cap ?? 'unspecified'}`,
      expected: 'An explicit background ability-score allocation choice',
      rootCause: 'background-choice-model',
    }));
  }
  if (fixture.grantedFeatConfiguration !== undefined) {
    const restored = fixture.grantedFeatSelection === undefined
      ? fixture.grantedFeatConfiguration
      : restoreGrantedFeatConfiguration(fixture.grantedFeatConfiguration, fixture.grantedFeatSelection);
    const errors = validateGrantedFeatConfiguration(restored, { requireComplete: true });
    if (errors.length > 0) findings.push(createAuditFinding({
      invariant: 'choice.granted-feat-configuration', category: 'choice', stage: sourceStage,
      sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
      observed: errors[0]!, expected: 'A complete source-backed granted-feat selection', rootCause: 'background-feat-choice-routing',
    }));
  } else for (const advancement of fixture.featAdvancements ?? []) {
    if (!isChoiceBearingAdvancement(advancement)) continue;
    const raw = record(advancement);
    findings.push(createAuditFinding({
      invariant: 'choice.granted-feat-configuration', category: 'choice', stage: sourceStage,
      sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
      ...(typeof raw._id === 'string' ? { nodeId: raw._id } : {}),
      observed: `Granted feat contains a ${typeof raw.type === 'string' ? raw.type : 'nested'} choice`,
      expected: 'A surfaced choice control for every granted-feat configuration',
      rootCause: 'background-feat-choice-routing',
    }));
  }
  if (fixture.startingEquipment !== undefined) {
    findings.push(...equipmentFindings(fixture));
    const wealth = parseWealth(fixture.wealth);
    if (wealth !== null && !hasWealthAlternative(fixture.startingEquipment.roots, wealth)) {
      findings.push(createAuditFinding({
        invariant: 'equipment.wealth-alternative', category: 'equipment', stage: sourceStage,
        sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
        ...(fixture.startingEquipment.roots[0] === undefined ? {} : { nodeId: fixture.startingEquipment.roots[0].nodeId }),
        observed: `${wealth.amount} ${wealth.denomination.toUpperCase()} is separate from the equipment package`,
        expected: 'Starting wealth represented as an equipment-package alternative',
        rootCause: 'equipment-alternative-model',
      }));
    }
  }
  const availableLanguages = fixture.availableLanguageValues ?? getBackgroundLanguageOptions({ languages: fixture.knownLanguages ?? [], languageChoices: (fixture.languagePools ?? []).map((pool) => ({ count: 2, pool: [pool] })) }).map((option) => option.value);
  const availableKeys = new Set(availableLanguages.map(languageSelectorKey));
  const overlaps = [...new Set((fixture.knownLanguages ?? []).filter((language) => availableKeys.has(languageSelectorKey(language))))];
  if (overlaps.length > 0) {
    findings.push(createAuditFinding({
      invariant: 'selector.known-language-overlap', category: 'selector', stage: sourceStage,
      sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
      observed: `Selectable known language${overlaps.length === 1 ? '' : 's'}: ${overlaps.join(', ')}`,
      expected: 'Known languages excluded from language choices',
      rootCause: 'language-option-filtering',
    }));
  }
  const technicalValues = flattenPresentationValues(fixture.userFacingValues ?? []).filter((value) => TECHNICAL_TEXT.test(value));
  if (technicalValues.length > 0) {
    findings.push(createAuditFinding({
      invariant: 'presentation.technical-token', category: 'presentation', stage: sourceStage,
      sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
      observed: `Technical token displayed: ${technicalValues[0]}`,
      expected: 'Human-readable labels in user-facing summaries',
      rootCause: 'presentation-projection',
    }));
  }
  return findings.sort(compareFindings);
}

export function auditAbilityProjectionConsistency(fixture: AbilityProjectionAuditFixture): AuditFinding[] {
  const bonuses = Object.entries(fixture.bonuses.class).filter(([, value]) => value !== 0);
  if (fixture.targetLevel > 1 || bonuses.length === 0) return [];
  return [createAuditFinding({
    invariant: 'eligibility.class-fixed-bonus', category: 'eligibility', stage: 'ability-scores',
    sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
    observed: bonuses.map(([ability, value]) => `${ability} ${value > 0 ? '+' : ''}${value}`).join(', '),
    expected: `No ineligible class fixed bonus at level ${fixture.targetLevel}`,
    rootCause: 'class-advancement-level',
  })];
}

export function auditLanguageOptionConsistency(fixture: LanguageOptionAuditFixture): AuditFinding[] {
  return auditProfileFixture({
    sourceName: fixture.sourceName,
    sourcePath: fixture.sourcePath,
    knownLanguages: fixture.knownLanguages,
    availableLanguageValues: fixture.availableLanguages,
  });
}

export function auditEquipmentMergeConsistency(fixture: EquipmentMergeAuditFixture): AuditFinding[] {
  const itemPaths = new Set(fixture.inventory.items.flatMap((item) => item.provenance.map((entry) => entry.sourcePath)));
  const currencyPaths = new Set((fixture.inventory.currencyProvenance ?? []).map((entry) => entry.sourcePath));
  const missingPaths = fixture.expectedSourcePaths.filter((path) => !itemPaths.has(path) || !currencyPaths.has(path));
  const currencyMismatches = Object.entries(fixture.expectedCurrency).filter(([denomination, amount]) => fixture.inventory.currency[denomination as keyof InventoryCurrency] !== amount);
  if (missingPaths.length === 0 && currencyMismatches.length === 0) return [];
  return [createAuditFinding({
    invariant: 'equipment.provenance-merge', category: 'equipment', stage: 'inventory',
    sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
    observed: [...missingPaths.map((path) => `missing provenance ${path}`), ...currencyMismatches.map(([denomination, amount]) => `${denomination} expected ${amount}`)].join(', '),
    expected: 'Distinct source provenance and summed currency after equipment merge',
    rootCause: 'inventory-source-merge',
  })];
}

export function auditFeatureProjectionConsistency(fixture: FeatureProjectionAuditFixture): AuditFinding[] {
  const duplicate = fixture.featureKeys.find((key, index) => fixture.featureKeys.indexOf(key) !== index);
  if (duplicate === undefined) return [];
  return [createAuditFinding({
    invariant: 'presentation.duplicate-grant', category: 'presentation', stage: 'sheet',
    sourceName: fixture.sourceName, sourcePath: fixture.sourcePath, nodeId: duplicate,
    observed: `Feature ${duplicate} appears more than once`,
    expected: 'One projected feature entry per stable source grant',
    rootCause: 'feature-projection-deduplication',
  })];
}

export function auditBackgroundCompletionConsistency(fixture: BackgroundCompletionAuditFixture): AuditFinding[] {
  if (!fixture.requiresFeatChoice || !fixture.backgroundComplete) return [];
  return [createAuditFinding({
    invariant: 'choice.background-completion', category: 'choice', stage: 'background',
    sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
    observed: 'Background is complete while a granted feat still requires choices',
    expected: 'Background remains incomplete until nested feat choices are saved',
    rootCause: 'background-completion-contract',
  })];
}

export function auditGrantedFeatSelectionConsistency(fixture: {
  sourceName: string;
  sourcePath: string;
  document: CharacterDocument;
  configuration: GrantedFeatChoiceConfiguration;
  selection?: GrantedFeatSelection;
}): AuditFinding[] {
  const restored = fixture.selection === undefined
    ? fixture.configuration
    : restoreGrantedFeatConfiguration(fixture.configuration, fixture.selection);
  const errors = validateGrantedFeatConfiguration(restored, { requireComplete: true });
  const findings = errors.length === 0 ? [] : [createAuditFinding({
    invariant: 'choice.granted-feat-configuration', category: 'choice', stage: 'background',
    sourceName: fixture.sourceName, sourcePath: fixture.sourcePath,
    observed: errors[0]!, expected: 'A complete source-backed granted-feat selection', rootCause: 'background-feat-choice-routing',
  })];
  const backgroundComplete = getCharacterCreationSections(fixture.document, fixture.configuration).find((section) => section.id === 'background')?.status === 'complete';
  return [...findings, ...auditBackgroundCompletionConsistency({
    sourceName: fixture.sourceName,
    sourcePath: fixture.sourcePath,
    requiresFeatChoice: fixture.configuration.kind === 'choice' && errors.length > 0,
    backgroundComplete,
  })];
}

export async function audit2024CharacterCreation(index: SourceIndex, backgroundAbilitySelection?: BackgroundAbilitySelection): Promise<CharacterCreationAuditResult> {
  const listed = await Promise.allSettled([
    index.listSpecies('2024'),
    index.listClasses('2024'),
    index.listBackgrounds('2024'),
  ]);
  const findings: AuditFinding[] = [];
  const stages = ['species', 'class', 'background'] as const;
  for (const [listIndex, result] of listed.entries()) {
    if (result.status === 'rejected') findings.push(sourceListFinding(stages[listIndex]!, result.reason));
  }
  const speciesSources = listed[0].status === 'fulfilled' ? listed[0].value : [];
  const classSources = listed[1].status === 'fulfilled' ? listed[1].value : [];
  const backgroundSources = listed[2].status === 'fulfilled' ? listed[2].value : [];
  const equipmentMatrix: Array<{ stage: 'class' | 'background'; source: FoundrySourceReference; summary: EquipmentPackageSummary }> = [];

  for (const source of speciesSources) {
    try {
      const summary = await index.getSpeciesSummary('2024', source.sourcePath);
      const configuration = buildSpeciesConfiguration(summary, AUDIT_SNAPSHOT);
      findings.push(...configuration.diagnostics.map((diagnostic) => configurationFinding('species', source, diagnostic)));
      findings.push(...dependencyFindings('species', source, summary.advancements, 1));
      const document = withOrigin(withRuleset(createCharacterDocument('Audit character', AUDIT_SNAPSHOT), '2024'), {
        sourcePath: source.sourcePath,
        identifier: source.identifier ?? '',
        id: source.id,
      });
      const state = getSpeciesRenderState(document, summary, configuration);
      const callouts = state === null ? [] : getSpeciesFeatureCallouts(state);
      const visible = callouts.flatMap((callout) => (summary.features ?? []).filter((feature) => feature.source.sourcePath === callout.sourcePath).map((feature) => ({
        name: feature.source.name,
        sourcePath: feature.source.sourcePath,
        level: feature.level,
        advancementId: feature.advancementId ?? feature.source.id,
      })));
      findings.push(...auditEligibilityFixtures({ targetLevel: 1, visibleSpeciesFeatures: visible, classSource: { name: '', sourcePath: '' }, classAdvancements: [] }));
    } catch (error) {
      findings.push(sourceErrorFinding('species', source, error));
    }
  }

  for (const source of classSources) {
    try {
      const summary = await index.getClassSummary('2024', source.sourcePath);
      const configuration = buildClassConfiguration(summary, AUDIT_SNAPSHOT, 1);
      findings.push(...configuration.diagnostics.map((diagnostic) => configurationFinding('class', source, diagnostic)));
      findings.push(...dependencyFindings('class', source, summary.advancements, 1));
      const renderState = getClassRenderState(withRuleset(createCharacterDocument('Audit character', AUDIT_SNAPSHOT), '2024'), summary, configuration);
      const callouts = getClassFeatureCallouts(renderState);
      findings.push(...auditProjectedClassFeatures({ sourceName: source.name, sourcePath: source.sourcePath }, 1, callouts));
      findings.push(...auditFeatureProjectionConsistency({
        sourceName: source.name,
        sourcePath: source.sourcePath,
        featureKeys: (summary.features ?? []).map((feature) => feature.source.sourcePath),
      }));
      const progression = toClassProgressionSelection(configuration);
      const applied = collectAbilityBonuses(undefined, summary, progression, undefined).class;
      if (Object.values(applied).some((value) => value !== 0)) {
        findings.push(...auditEligibilityFixtures({
          targetLevel: 1,
          visibleSpeciesFeatures: [],
          classSource: { name: source.name, sourcePath: source.sourcePath },
          classAdvancements: summary.advancements,
        }));
      }
      const raw = index.getRaw(source.sourcePath);
      const system = record(raw?.system);
      findings.push(...auditProfileFixture({
        sourceName: source.name,
        sourcePath: source.sourcePath,
        sourceStage: 'class',
        ...(summary.startingEquipment === undefined ? {} : { startingEquipment: summary.startingEquipment }),
        ...(typeof system.wealth === 'string' ? { wealth: system.wealth } : {}),
      }));
      if (summary.startingEquipment !== undefined) equipmentMatrix.push({ stage: 'class', source, summary: summary.startingEquipment });
    } catch (error) {
      findings.push(sourceErrorFinding('class', source, error));
    }
  }

  for (const source of backgroundSources) {
    try {
      const summary = await index.getBackgroundSummary('2024', source.sourcePath);
      findings.push(...await rawBackgroundDependencyFindings(index, source, index.getRaw(source.sourcePath), 1));
      const featConfiguration = buildGrantedFeatConfiguration(summary.grantedFeat);
      const featSelection = featConfiguration.kind === 'choice' ? deterministicGrantedFeatSelection(featConfiguration) : undefined;
      const document = { ...withRuleset(createCharacterDocument('Audit character', AUDIT_SNAPSHOT), '2024'), step: 'background' as const };
      const allocation = deterministicBackgroundAbilitySelection(summary);
      const languages = deterministicBackgroundLanguageSelection(summary);
      const stateDocument = {
        ...document,
        ...(allocation.selection === undefined && featSelection === undefined && languages.length === 0 ? {} : {
          backgroundChoices: {
            ...(allocation.selection === undefined ? {} : { abilityScores: allocation.selection }),
            ...(featSelection === undefined ? {} : { grantedFeat: featSelection }),
            ...(languages.length === 0 ? {} : { languages }),
          },
        }),
      };
      const state = getBackgroundRenderState(stateDocument, summary);
      const overview = state.kind === 'background-summary' ? getBackgroundOverview(state) : undefined;
      findings.push(...auditProfileFixture({
        sourceName: source.name,
        sourcePath: source.sourcePath,
        sourceStage: 'background',
        ...(summary.abilityScores === undefined ? {} : { abilityScores: summary.abilityScores }),
        ...(allocation.selection === undefined ? {} : { abilitySelection: allocation.selection }),
        ...(allocation.reason === undefined ? {} : { abilityAllocationReason: allocation.reason }),
        ...(summary.startingEquipment === undefined ? {} : { startingEquipment: summary.startingEquipment }),
        ...(summary.wealth === undefined ? {} : { wealth: summary.wealth }),
        knownLanguages: summary.languages,
        languagePools: summary.languageChoices.flatMap((choice) => choice.pool),
        userFacingValues: overview === undefined ? [] : [overview.skills, overview.languages, overview.tools, overview.equipment],
      }));
      const selected = { ...stateDocument, background: { sourcePath: source.sourcePath, identifier: source.identifier ?? '', id: source.id } };
      if (featConfiguration.kind === 'choice') findings.push(...auditGrantedFeatSelectionConsistency({
        sourceName: source.name,
        sourcePath: source.sourcePath,
        document: selected,
        configuration: featConfiguration,
        ...(featSelection === undefined ? {} : { selection: featSelection }),
      }));
      if (featConfiguration.kind === 'choice' && featSelection !== undefined) {
        const spellSummaries = new Map<string, FoundrySpellSummary>(featSelection.spellChoices.flatMap((choice) => choice.kind === 'spell' ? choice.selected.map((spell) => [`${spell.sourcePath}:${spell.pack}:${spell.type}:${spell.id}`, spell as FoundrySpellSummary] as const) : []));
        findings.push(...await auditBackgroundReadinessAndProjection(index, speciesSources[0], classSources[0], source, summary, selected, featSelection, spellSummaries));
      }
      if (summary.startingEquipment !== undefined) equipmentMatrix.push({ stage: 'background', source, summary: summary.startingEquipment });
    } catch (error) {
      findings.push(sourceErrorFinding('background', source, error));
    }
  }

  findings.push(...await auditEquipmentInteractionMatrix(index, equipmentMatrix));
  findings.push(...await auditAbilityConsumerMatrix(index, speciesSources[0], classSources[0], backgroundSources[0], backgroundAbilitySelection));
  try {
    const inventory = await inventoryLevelOneSourceCompleteness(index);
    findings.push(...auditLevelOneSourceCompleteness(inventory, await buildLevelOneCreationSheetProjection(index, inventory)));
  } catch (error) {
    findings.push(createAuditFinding({
      invariant: 'resolution.level-one-source-completeness', category: 'resolution', stage: 'sheet',
      sourceName: 'Level-one source completeness', sourcePath: 'foundry://2024/level-one-completeness',
      observed: error instanceof Error ? error.message : String(error),
      expected: 'A readable level-one source completeness inventory', rootCause: 'source-completeness-inventory',
    }));
  }

  return {
    coverage: { species: speciesSources.length, classes: classSources.length, backgrounds: backgroundSources.length },
    findings: findings.sort(compareFindings),
  };
}

export function formatAuditJson(result: CharacterCreationAuditResult): string {
  return JSON.stringify(sortedResult(result));
}

export function formatAuditMarkdown(result: CharacterCreationAuditResult): string {
  const sorted = sortedResult(result);
  const lines = [
    '# 2024 character-creation audit',
    '',
    `Coverage: ${sorted.coverage.species} species, ${sorted.coverage.classes} classes, ${sorted.coverage.backgrounds} backgrounds.`,
    '',
  ];
  if (sorted.findings.length === 0) return [...lines, 'No violations found.'].join('\n');

  const groups = new Map<string, AuditFinding[]>();
  for (const finding of sorted.findings) {
    const key = `${finding.invariant}\u0000${finding.rootCause}`;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  for (const findings of groups.values()) {
    const first = findings[0]!;
    lines.push(`## ${first.invariant} (${findings.length})`, '', `Root cause: ${first.rootCause}`, '');
    for (const finding of findings) {
      const node = finding.nodeId === undefined ? '' : `, node \`${finding.nodeId}\``;
      lines.push(`- ${finding.sourceName}: \`${finding.sourcePath}\`${node} — ${finding.observed}; expected ${finding.expected}.`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function sortedResult(result: CharacterCreationAuditResult): CharacterCreationAuditResult {
  const findings = result.findings.map(cloneFinding).sort(compareFindings);
  return { coverage: { ...result.coverage }, findings };
}

function cloneFinding(finding: AuditFinding): AuditFinding {
  return { ...finding, relatedSourcePaths: [...finding.relatedSourcePaths] };
}

function compareFindings(left: AuditFinding, right: AuditFinding): number {
  return left.invariant.localeCompare(right.invariant)
    || left.rootCause.localeCompare(right.rootCause)
    || left.sourcePath.localeCompare(right.sourcePath)
    || (left.nodeId ?? '').localeCompare(right.nodeId ?? '')
    || left.observed.localeCompare(right.observed)
    || left.expected.localeCompare(right.expected)
    || left.severity.localeCompare(right.severity)
    || left.relatedSourcePaths.join('\u0000').localeCompare(right.relatedSourcePaths.join('\u0000'));
}

function configurationFinding(stage: 'species' | 'class', source: FoundrySourceReference, diagnostic: string): AuditFinding {
  return createAuditFinding({
    invariant: 'resolution.configuration', category: 'resolution', stage,
    sourceName: source.name, sourcePath: source.sourcePath,
    observed: diagnostic, expected: 'A supported configuration without diagnostics',
    rootCause: 'configuration-projection',
  });
}

export function dependencyFindings(stage: 'species' | 'class' | 'background', source: FoundrySourceReference, advancements: Array<ClassAdvancementSummary | SpeciesAdvancementSummary>, targetLevel: number): AuditFinding[] {
  return advancements.flatMap((advancement) => advancement.dependencies.flatMap((dependency) => {
    if (dependency.source !== null || dependency.reason === 'unresolved selector') return [];
    return [createAuditFinding({
      invariant: 'resolution.dependency', category: 'resolution', stage,
      severity: advancement.level > targetLevel ? 'warning' : 'error',
      sourceName: source.name, sourcePath: source.sourcePath, nodeId: advancement.id,
      observed: `${dependency.uuid}: ${dependency.reason ?? 'unresolved dependency'}`,
      expected: 'A resolved source or supported selector',
      rootCause: dependency.reason === 'cyclic dependency' ? 'dependency-cycle' : dependency.reason === 'maximum dependency depth exceeded' ? 'dependency-depth' : 'dependency-resolution',
    })];
  }));
}

export function deterministicGrantedFeatSelection(configuration: GrantedFeatChoiceConfiguration): GrantedFeatSelection | undefined {
  let current = configuration;
  const selectedKeys = new Set<string>();
  const list = current.spellChoices[0];
  if (list === undefined || list.options[0] === undefined) return undefined;
  try {
    current = setGrantedFeatSpellChoice(current, list.key, [list.options[0]!.value]);
    for (const choice of current.spellChoices.slice(1)) {
      const available = getAvailableGrantedFeatSpellChoices(current).find((entry) => entry.key === choice.key);
      if (available === undefined) return undefined;
      const options = available.options.filter((option) => !selectedKeys.has(sourceReferenceKey(option.source))).slice(0, available.count);
      for (const option of options) selectedKeys.add(sourceReferenceKey(option.source));
      const values = options.map((option) => option.source);
      if (values.length !== available.count) return undefined;
      current = setGrantedFeatSpellChoice(current, available.key, values);
    }
    const ability = current.spellChoices.slice(1).flatMap((choice) => choice.abilityOptions)[0];
    if (ability === undefined) return undefined;
    current = setGrantedFeatSpellcastingAbility(current, ability);
    return toGrantedFeatSelection(current);
  } catch {
    return undefined;
  }
}

function sourceReferenceKey(source: FoundrySourceReference): string {
  return `${source.sourcePath}:${source.pack}:${source.type}:${source.id}`;
}

export function auditProjectedClassFeatures(source: InteractionSource, targetLevel: number, features: Array<{ name: string; level: number }>): AuditFinding[] {
  return features.filter((feature) => feature.level > targetLevel).map((feature) => createAuditFinding({
    invariant: 'eligibility.class-feature-level', category: 'eligibility', stage: 'class',
    sourceName: source.sourceName, sourcePath: source.sourcePath,
    observed: `${feature.name} at level ${feature.level} is visible at level ${targetLevel}`,
    expected: `No class feature above level ${targetLevel} in the creation projection`,
    rootCause: 'class-feature-level',
  }));
}

export async function rawBackgroundDependencyFindings(index: SourceIndex, source: FoundrySourceReference, raw: Record<string, unknown> | undefined, targetLevel: number): Promise<AuditFinding[]> {
  const rawAdvancements = record(raw?.system).advancement;
  const advancements = Array.isArray(rawAdvancements) ? rawAdvancements : Object.values(record(rawAdvancements));
  const findings: AuditFinding[] = [];
  for (const advancement of advancements) {
    const value = record(advancement);
    const configuration = record(value.configuration);
    const dependencyValues = [configuration.items, configuration.pool, configuration.grants];
    const uuids = [...new Set(flattenPresentationValues(dependencyValues).filter((entry) => entry.startsWith('Compendium.')))];
    for (const uuid of uuids) {
      if (await index.getByUuid(uuid) !== null) continue;
      const level = typeof value.level === 'number' ? value.level : 0;
      findings.push(createAuditFinding({
        invariant: 'resolution.dependency', category: 'resolution', stage: 'background',
        severity: level > targetLevel ? 'warning' : 'error',
        sourceName: source.name, sourcePath: source.sourcePath,
        ...(typeof value._id === 'string' ? { nodeId: value._id } : {}),
        observed: `${uuid}: unresolved source UUID`,
        expected: 'A resolved source dependency',
        rootCause: 'dependency-resolution',
      }));
    }
  }
  return findings;
}

async function auditBackgroundReadinessAndProjection(index: SourceIndex, speciesSource: FoundrySourceReference | undefined, classSource: FoundrySourceReference | undefined, backgroundSource: FoundrySourceReference, background: Awaited<ReturnType<SourceIndex['getBackgroundSummary']>>, selected: CharacterDocument, featSelection: GrantedFeatSelection, spellSummaries: ReadonlyMap<string, FoundrySpellSummary>): Promise<AuditFinding[]> {
  if (speciesSource === undefined || classSource === undefined) return [];
  try {
    const [species, classSummary] = await Promise.all([index.getSpeciesSummary('2024', speciesSource.sourcePath), index.getClassSummary('2024', classSource.sourcePath)]);
    const allocation = deterministicBackgroundAbilitySelection(background).selection;
    const languages = deterministicBackgroundLanguageSelection(background);
    const classConfiguration = buildClassConfiguration(classSummary, AUDIT_SNAPSHOT, 1);
    const progression = toClassProgressionSelection(classConfiguration);
    const equipment = background.startingEquipment === undefined ? emptyInventory() : flattenSelectedEquipment(background.startingEquipment.roots, selectFirstEquipmentBranches(background.startingEquipment.roots), { sourcePath: backgroundSource.sourcePath, packageNodeId: background.startingEquipment.roots[0]?.nodeId ?? 'root' });
    const document: CharacterDocument = {
      ...selected,
      origin: { sourcePath: speciesSource.sourcePath, identifier: speciesSource.identifier ?? '', id: speciesSource.id },
      classProgressions: [progression],
      background: { sourcePath: backgroundSource.sourcePath, identifier: backgroundSource.identifier ?? '', id: backgroundSource.id },
      abilityScores: createDefaultAbilityScores(),
      inventory: equipment,
      ...(allocation === undefined && featSelection === undefined && languages.length === 0 ? {} : { backgroundChoices: { ...(allocation === undefined ? {} : { abilityScores: allocation }), ...(languages.length === 0 ? {} : { languages }), grantedFeat: featSelection } }),
    };
    const sources: CharacterSheetSources = { species, class: classSummary, background, spellSummaries, warnings: [] };
    const readinessErrors = validateCharacterCreationReadiness(document, sources).filter((error) => /background|granted feat|spell/i.test(error));
    const findings: AuditFinding[] = readinessErrors.map((error) => createAuditFinding({ invariant: 'choice.background-readiness', category: 'choice', stage: 'background', sourceName: backgroundSource.name, sourcePath: backgroundSource.sourcePath, observed: error, expected: 'A complete level-one background creation state', rootCause: 'background-readiness' }));
    const projection = projectSpellSheet(document, { background, progression, spellSummaries });
    const expected = featSelection.spellChoices.flatMap((choice) => choice.kind === 'spell' ? choice.selected.map(sourceReferenceKey) : []);
    const actual = [...projection.cantrips, ...projection.levels.flatMap((level) => level.spells)].flatMap((row) => row.ownership.includes('granted') && row.source.kind === 'available' ? [sourceReferenceKey(row.source.value)] : []);
    if (expected.length !== actual.length || expected.some((key) => !actual.includes(key))) findings.push(createAuditFinding({ invariant: 'presentation.background-spell-projection', category: 'presentation', stage: 'sheet', sourceName: backgroundSource.name, sourcePath: backgroundSource.sourcePath, observed: `${actual.length} projected granted spells`, expected: `${expected.length} selected granted spells with matching source identities`, rootCause: 'background-spell-projection' }));
    return findings;
  } catch (error) {
    return [createAuditFinding({ invariant: 'resolution.interaction-matrix', category: 'resolution', stage: 'sheet', sourceName: backgroundSource.name, sourcePath: backgroundSource.sourcePath, observed: error instanceof Error ? error.message : String(error), expected: 'A complete readiness and spell projection interaction', rootCause: 'interaction-matrix' })];
  }
}

async function auditAbilityConsumerMatrix(index: SourceIndex, speciesSource: FoundrySourceReference | undefined, classSource: FoundrySourceReference | undefined, backgroundSource: FoundrySourceReference | undefined, backgroundAbilitySelection?: BackgroundAbilitySelection): Promise<AuditFinding[]> {
  if (speciesSource === undefined || classSource === undefined || backgroundSource === undefined) return [];
  try {
    const [species, classSummary, background] = await Promise.all([
      index.getSpeciesSummary('2024', speciesSource.sourcePath),
      index.getClassSummary('2024', classSource.sourcePath),
      index.getBackgroundSummary('2024', backgroundSource.sourcePath),
    ]);
    const allocation = backgroundAbilitySelection === undefined ? deterministicBackgroundAbilitySelection(background) : { selection: backgroundAbilitySelection };
    const configuration = buildClassConfiguration(classSummary, AUDIT_SNAPSHOT, 1);
    const progression = toClassProgressionSelection(configuration);
    const selection = createDefaultAbilityScores();
    const document = {
      ...withRuleset(createCharacterDocument('Audit character', AUDIT_SNAPSHOT), '2024'),
      step: 'background' as const,
      origin: { sourcePath: speciesSource.sourcePath, identifier: speciesSource.identifier ?? '', id: speciesSource.id },
      classProgressions: [progression],
      background: { sourcePath: backgroundSource.sourcePath, identifier: backgroundSource.identifier ?? '', id: backgroundSource.id },
      ...(allocation.selection === undefined ? {} : { backgroundChoices: { abilityScores: allocation.selection } }),
      abilityScores: selection,
    };
    const { creation, sheet } = projectAbilityConsumerProjection(document, species, classSummary, background, allocation.selection);
    const mismatches = sheet.abilities.flatMap((ability) => ability.score.kind === 'available' && ability.score.value !== creation[ability.key].final
      ? [`${ability.key}: creation ${creation[ability.key].final}, sheet ${ability.score.value}`]
      : []);
    if (mismatches.length === 0) return [];
    return [createAuditFinding({
      invariant: 'presentation.ability-projection-mismatch', category: 'presentation', stage: 'sheet',
      sourceName: `${speciesSource.name} + ${classSource.name} + ${backgroundSource.name}`,
      sourcePath: 'interaction/ability-consumers',
      observed: mismatches.join(', '),
      expected: 'Creation and character-sheet ability totals agree',
      rootCause: 'ability-consumer-consistency',
      relatedSourcePaths: [speciesSource.sourcePath, classSource.sourcePath, backgroundSource.sourcePath],
    })];
  } catch (error) {
    return [createAuditFinding({
      invariant: 'resolution.interaction-matrix', category: 'resolution', stage: 'sheet',
      sourceName: 'Ability consumer matrix', sourcePath: 'interaction/ability-consumers',
      observed: error instanceof Error ? error.message : String(error),
      expected: 'A complete representative creation and sheet projection',
      rootCause: 'interaction-matrix',
    })];
  }
}

function deterministicBackgroundAbilitySelection(summary: Awaited<ReturnType<SourceIndex['getBackgroundSummary']>>): { selection?: BackgroundAbilitySelection; reason?: string } {
  const configuration = buildBackgroundAbilityConfiguration(summary);
  if (configuration.kind !== 'choice') return { reason: configuration.kind === 'unsupported' ? configuration.reason : 'Background has no structured ability-score choice.' };
  let remaining = configuration.points;
  const assignments: Partial<Record<typeof ABILITY_IDS[number], number>> = {};
  for (const ability of configuration.eligibleAbilities) {
    if (remaining === 0) break;
    const value = Math.min(configuration.cap, remaining);
    assignments[ability] = value;
    remaining -= value;
  }
  if (remaining !== 0) return { reason: `Unable to allocate ${configuration.points} points across the source-defined eligible abilities.` };
  try {
    return { selection: createBackgroundAbilitySelection(configuration, assignments) };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

function deterministicBackgroundLanguageSelection(summary: Awaited<ReturnType<SourceIndex['getBackgroundSummary']>>): string[] {
  const required = summary.languageChoices.reduce((total, choice) => total + choice.count, 0);
  return getBackgroundLanguageOptions(summary).slice(0, required).map((option) => option.value);
}

export function projectAbilityConsumerProjection(document: ReturnType<typeof createCharacterDocument>, species: Awaited<ReturnType<SourceIndex['getSpeciesSummary']>>, classSummary: Awaited<ReturnType<SourceIndex['getClassSummary']>>, background: Awaited<ReturnType<SourceIndex['getBackgroundSummary']>>, backgroundAbilitySelection?: BackgroundAbilitySelection): { creation: ReturnType<typeof calculateAbilityScores>; sheet: ReturnType<typeof projectCharacterSheet> } {
  const progression = document.classProgressions?.[0];
  const creation = calculateAbilityScores(document.abilityScores!, sumAbilityBonuses(collectAbilityBonuses(species, classSummary, progression, background, backgroundAbilitySelection)));
  const sheet = projectCharacterSheet(document, { species, class: classSummary, background, warnings: [] });
  return { creation, sheet };
}

async function auditEquipmentInteractionMatrix(index: SourceIndex, entries: Array<{ stage: 'class' | 'background'; source: FoundrySourceReference; summary: EquipmentPackageSummary }>): Promise<AuditFinding[]> {
  const settled = await Promise.allSettled(entries.map(async (entry) => {
    const summary = await resolveStartingEquipmentItems(entry.summary, async (key) => index.getByUuid(key));
    const selection = selectFirstEquipmentBranches(summary.roots);
    const inventory = flattenSelectedEquipment(summary.roots, selection, { sourcePath: entry.source.sourcePath, packageNodeId: summary.roots[0]?.nodeId ?? 'root' });
    const diagnostics = auditProfileFixture({ sourceName: entry.source.name, sourcePath: entry.source.sourcePath, sourceStage: entry.stage, startingEquipment: summary });
    return { ...entry, inventory, diagnostics };
  }));
  const findings = settled.flatMap((result, position) => result.status === 'fulfilled' ? result.value.diagnostics : [createAuditFinding({
      invariant: 'resolution.interaction-matrix', category: 'resolution', stage: 'inventory',
      sourceName: entries[position]?.source.name ?? 'Equipment source', sourcePath: entries[position]?.source.sourcePath ?? 'interaction/class-background-equipment',
      observed: result.reason instanceof Error ? result.reason.message : String(result.reason),
      expected: 'Resolved equipment for the representative merge matrix',
      rootCause: 'interaction-matrix',
    })]);
  const candidates = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const classEntry = candidates.find((entry) => entry.stage === 'class' && entry.inventory.items.length > 0 && (entry.inventory.currencyProvenance?.length ?? 0) > 0);
  const backgroundEntry = candidates.find((entry) => entry.stage === 'background' && entry.inventory.items.length > 0 && (entry.inventory.currencyProvenance?.length ?? 0) > 0);
  if (classEntry === undefined || backgroundEntry === undefined) return findings;
  const merged = mergeInventories(classEntry.inventory, backgroundEntry.inventory);
  const expectedCurrency = Object.fromEntries((Object.keys(merged.currency) as Array<keyof InventoryCurrency>).map((denomination) => [denomination, classEntry.inventory.currency[denomination] + backgroundEntry.inventory.currency[denomination]]));
  return [...findings, ...auditEquipmentMergeConsistency({
    inventory: merged,
    expectedSourcePaths: [classEntry.source.sourcePath, backgroundEntry.source.sourcePath],
    expectedCurrency,
    sourceName: `${classEntry.source.name} + ${backgroundEntry.source.name}`,
    sourcePath: 'interaction/class-background-equipment',
  })];
}

function selectFirstEquipmentBranches(roots: EquipmentPackageNode[]): EquipmentSelection {
  const selection: EquipmentSelection = { selected: {}, semantic: {} };
  const visit = (node: EquipmentPackageNode): void => {
    if (node.type === 'OR') {
      const selected = node.children?.[0];
      if (selected !== undefined) {
        selection.selected[node.nodeId] = selected.nodeId;
        visit(selected);
      }
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return selection;
}

function sourceListFinding(stage: 'species' | 'class' | 'background', error: unknown): AuditFinding {
  return createAuditFinding({
    invariant: 'resolution.source-list', category: 'resolution', stage,
    sourceName: `${stage} source list`, sourcePath: `foundry://2024/${stage}`,
    observed: error instanceof Error ? error.message : String(error),
    expected: `Readable ${stage} source enumeration`,
    rootCause: 'source-list',
  });
}

function sourceErrorFinding(stage: 'species' | 'class' | 'background', source: FoundrySourceReference, error: unknown): AuditFinding {
  return createAuditFinding({
    invariant: 'resolution.source-summary', category: 'resolution', stage,
    sourceName: source.name, sourcePath: source.sourcePath,
    observed: error instanceof Error ? error.message : String(error),
    expected: 'A readable normalized source summary',
    rootCause: 'source-summary',
  });
}

const TECHNICAL_TEXT = /(?:Compendium\.|(?:skills|languages|tool|weapon|armor):|\[object Object\])/;

function isChoiceBearingAdvancement(value: unknown): boolean {
  const advancement = record(value);
  const type = typeof advancement.type === 'string' ? advancement.type : '';
  const configuration = record(advancement.configuration);
  if (type === 'ItemChoice') return true;
  if (type === 'Trait') return Object.keys(record(configuration.choices)).length > 0
    || (Array.isArray(configuration.choices) && configuration.choices.length > 0);
  if (type === 'AbilityScoreImprovement') {
    const points = configuration.points;
    return (typeof points === 'number' && points > 0)
      || Object.keys(record(configuration.choices)).length > 0;
  }
  if (Object.keys(record(configuration.choices)).length > 0) return true;
  return Object.values(configuration).some((entry) => Array.isArray(entry) && entry.length > 0);
}

function equipmentFindings(fixture: AuditProfileFixture): AuditFinding[] {
  const summary = fixture.startingEquipment;
  if (summary === undefined) return [];
  const findings: AuditFinding[] = [];
  const seen = new Set<string>();
  for (const diagnostic of summary.diagnostics) findings.push(equipmentDiagnostic(fixture, undefined, diagnostic));
  const visit = (node: EquipmentPackageNode): void => {
    if (seen.has(node.nodeId)) {
      findings.push(createAuditFinding({
        invariant: 'equipment.node-ownership', category: 'equipment', stage: fixture.sourceStage ?? 'background',
        sourceName: fixture.sourceName, sourcePath: fixture.sourcePath, nodeId: node.nodeId,
        observed: `Equipment node ${node.nodeId} occurs more than once`,
        expected: 'Each equipment node owned by exactly one package branch',
        rootCause: 'equipment-node-ownership',
      }));
    } else {
      seen.add(node.nodeId);
    }
    for (const diagnostic of node.diagnostics) findings.push(equipmentDiagnostic(fixture, node.nodeId, diagnostic));
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of summary.roots) visit(root);
  return findings;
}

function equipmentDiagnostic(fixture: AuditProfileFixture, nodeId: string | undefined, diagnostic: string): AuditFinding {
  return createAuditFinding({
    invariant: 'equipment.node-diagnostic', category: 'equipment', stage: fixture.sourceStage ?? 'background',
    sourceName: fixture.sourceName, sourcePath: fixture.sourcePath, ...(nodeId === undefined ? {} : { nodeId }),
    observed: diagnostic,
    expected: 'A fully supported and resolved equipment package',
    rootCause: 'equipment-normalization',
  });
}

function parseWealth(value: string | undefined): { amount: number; denomination: string } | null {
  if (value === undefined) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/i);
  if (match === null) return null;
  return { amount: Number(match[1]), denomination: (match[2] ?? 'gp').toLocaleLowerCase() };
}

function hasWealthAlternative(nodes: EquipmentPackageNode[], wealth: { amount: number; denomination: string }): boolean {
  const containsMatchingCurrency = (node: EquipmentPackageNode): boolean => {
    if (node.type === 'currency' && node.currency?.amount === wealth.amount && node.currency.denomination.toLocaleLowerCase() === wealth.denomination) return true;
    return (node.children ?? []).some(containsMatchingCurrency);
  };
  const visit = (node: EquipmentPackageNode): boolean => node.type === 'OR' && containsMatchingCurrency(node)
    || (node.children ?? []).some(visit);
  return nodes.some(visit);
}

function flattenPresentationValues(values: unknown[]): string[] {
  const flattened: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      flattened.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    for (const entry of Object.values(record(value))) visit(entry);
  };
  for (const value of values) visit(value);
  return flattened;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
