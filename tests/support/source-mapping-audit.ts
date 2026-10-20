import { buildClassConfiguration } from '../../src/class-configuration';
import type { ClassAdvancementSelection } from '../../src/class-configuration';
import { createCharacterDocument, withRuleset, type CharacterDocument } from '../../src/character-model';
import type { BackgroundSourceSummary, ClassAdvancementSummary, ClassFeatureSummary, ClassSourceSummary, FoundrySourceReference, SourceIndex, SpeciesAdvancementSummary, SpeciesFeatureEntitlement, SpeciesFeatureSummary, SpeciesSourceSummary } from '../../src/character-sources';
import { projectCharacterSheet } from '../../src/character-sheet-model';
import { projectFeatureSheet } from '../../src/feature-sheet-model';
import { getEligibleFixedClassTraitGrants } from '../../src/class-proficiency-eligibility';
import { isRecord, stringValues } from '../../src/foundry-utils';
import { buildSpeciesConfiguration, toSpeciesConfigurationSelection, type SpeciesConfigurationSelection } from '../../src/species-configuration';
import type { SourceSnapshot } from '../../src/source-tree';

export type SourceMappingSeverity = 'error' | 'warning';
export type SourceMappingStage = 'species' | 'class' | 'background' | 'sheet';

export interface SourceMappingFinding {
  invariant: string;
  severity: SourceMappingSeverity;
  stage: SourceMappingStage;
  sourceName: string;
  sourcePath: string;
  nodeId?: string;
  level?: number;
  observed: string;
  expected: string;
  route: string;
}

export interface SourceMappingCoverage {
  species: number;
  classes: number;
  backgrounds: number;
  speciesAdvancements: number;
  classAdvancements: number;
  backgroundAdvancements: number;
  speciesFeatureEntitlements: number;
  classFeatures: number;
  sheetCombinations: number;
  mappedRoutes: Record<string, number>;
}

export interface SourceMappingAuditResult {
  coverage: SourceMappingCoverage;
  findings: SourceMappingFinding[];
}

const AUDIT_SNAPSHOT: SourceSnapshot = {
  owner: 'foundryvtt',
  repo: 'dnd5e',
  branch: '6.0.x',
  commit: '7df9c03977619338725b607eae2fe4efda664028',
  systemVersion: '6.0.0',
};

const SUPPORTED_SPECIES_ADVANCEMENTS = new Set(['AbilityScoreImprovement', 'ItemChoice', 'ItemGrant', 'ScaleValue', 'Size', 'Trait']);
const SUPPORTED_CLASS_ADVANCEMENTS = new Set(['AbilityScoreImprovement', 'HitPoints', 'ItemChoice', 'ItemGrant', 'ScaleValue', 'Subclass', 'Trait']);
const SUPPORTED_BACKGROUND_ADVANCEMENTS = new Set(['AbilityScoreImprovement', 'ItemGrant', 'Trait']);

export async function audit2024SourceMappings(index: SourceIndex): Promise<SourceMappingAuditResult> {
  const [speciesSources, classSources, backgroundSources] = await Promise.all([
    index.listSpecies('2024'),
    index.listClasses('2024'),
    index.listBackgrounds('2024'),
  ]);
  const findings: SourceMappingFinding[] = [];
  const mappedRoutes = new Map<string, number>();
  let speciesAdvancements = 0;
  let classAdvancements = 0;
  let backgroundAdvancements = 0;
  let speciesFeatureEntitlements = 0;
  let classFeatures = 0;
  const speciesSummaries: SpeciesSourceSummary[] = [];
  const classSummaries: ClassSourceSummary[] = [];
  const backgroundSummaries: BackgroundSourceSummary[] = [];

  for (const source of speciesSources) {
    try {
      const summary = await index.getSpeciesSummary('2024', source.sourcePath);
      speciesSummaries.push(summary);
      speciesAdvancements += summary.advancements.length;
      speciesFeatureEntitlements += (summary.features ?? []).reduce((total, feature) => total + featureEntitlements(feature).length, 0);
      findings.push(...auditSpeciesMapping(source, summary, mappedRoutes));
    } catch (error) {
      findings.push(sourceFailure('species', source, error));
    }
  }

  for (const source of classSources) {
    try {
      const summary = await index.getClassSummary('2024', source.sourcePath);
      classSummaries.push(summary);
      classAdvancements += summary.advancements.length;
      classFeatures += summary.features?.length ?? 0;
      findings.push(...auditClassMapping(source, summary, mappedRoutes));
    } catch (error) {
      findings.push(sourceFailure('class', source, error));
    }
  }

  for (const source of backgroundSources) {
    try {
      const summary = await index.getBackgroundSummary('2024', source.sourcePath);
      backgroundSummaries.push(summary);
      const advancements = rawAdvancements(index.getRaw(source.sourcePath));
      backgroundAdvancements += advancements.length;
      findings.push(...auditBackgroundMapping(source, summary, advancements, mappedRoutes));
    } catch (error) {
      findings.push(sourceFailure('background', source, error));
    }
  }

  for (const species of speciesSummaries) for (const classSummary of classSummaries) for (const background of backgroundSummaries) {
    for (const level of [1, 5]) findings.push(...auditSheetCombination(species, classSummary, background, level));
  }

  return {
    coverage: {
      species: speciesSources.length,
      classes: classSources.length,
      backgrounds: backgroundSources.length,
      speciesAdvancements,
      classAdvancements,
      backgroundAdvancements,
      speciesFeatureEntitlements,
      classFeatures,
      sheetCombinations: speciesSummaries.length * classSummaries.length * backgroundSummaries.length * 2,
      mappedRoutes: Object.fromEntries([...mappedRoutes].sort(([left], [right]) => left.localeCompare(right))),
    },
    findings: findings.sort(compareFindings),
  };
}

function auditSheetCombination(species: SpeciesSourceSummary, classSummary: ClassSourceSummary, background: BackgroundSourceSummary, level: number): SourceMappingFinding[] {
  const document: CharacterDocument = {
    ...withRuleset(createCharacterDocument('Source mapping audit', AUDIT_SNAPSHOT), '2024'),
    step: 'background',
    origin: { sourcePath: species.source.sourcePath, identifier: species.source.identifier ?? '', id: species.source.id },
    classProgressions: [{ class: { sourcePath: classSummary.source.sourcePath, identifier: classSummary.source.identifier ?? '', id: classSummary.source.id }, targetLevel: level, selections: [] }],
    background: { sourcePath: background.source.sourcePath, identifier: background.source.identifier ?? '', id: background.source.id },
    abilityScores: { method: 'standard-array', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
  };
  const combination = `${species.source.name} / ${classSummary.source.name} / ${background.source.name}`;
  try {
    const sheet = projectCharacterSheet(document, { species, class: classSummary, background, warnings: [] });
    const expectedBonus = level === 1 ? 2 : 3;
    const invalid = [
      sheet.identity.species.kind !== 'available' || sheet.identity.species.value !== species.source.name ? 'species identity' : undefined,
      sheet.identity.className.kind !== 'available' || sheet.identity.className.value !== classSummary.source.name ? 'class identity' : undefined,
      sheet.identity.background.kind !== 'available' || sheet.identity.background.value !== background.source.name ? 'background identity' : undefined,
      sheet.identity.level.kind !== 'available' || sheet.identity.level.value !== level ? 'character level' : undefined,
      sheet.header.proficiencyBonus.kind !== 'available' || sheet.header.proficiencyBonus.value !== expectedBonus ? 'proficiency bonus' : undefined,
      sheet.abilities.some((ability) => ability.score.kind !== 'available' || ability.modifier.kind !== 'available') ? 'ability values' : undefined,
      sheet.savingThrows.some((save) => save.modifier.kind !== 'available') ? 'saving throws' : undefined,
      sheet.skills.some((skill) => skill.modifier.kind !== 'available') ? 'skills' : undefined,
    ].filter((value): value is string => value !== undefined);
    return invalid.length === 0 ? [] : [{ invariant: 'projection.sheet-combination', severity: 'error', stage: 'sheet', sourceName: combination, sourcePath: `${species.source.sourcePath} | ${classSummary.source.sourcePath} | ${background.source.sourcePath}`, level, observed: `Unavailable or incorrect ${invalid.join(', ')}`, expected: 'A complete stable level-based sheet projection', route: 'species + class + background -> character sheet' }];
  } catch (error) {
    return [{ invariant: 'projection.sheet-combination', severity: 'error', stage: 'sheet', sourceName: combination, sourcePath: `${species.source.sourcePath} | ${classSummary.source.sourcePath} | ${background.source.sourcePath}`, level, observed: error instanceof Error ? error.message : String(error), expected: 'A sheet projection without an exception', route: 'species + class + background -> character sheet' }];
  }
}

function auditSpeciesMapping(source: FoundrySourceReference, summary: SpeciesSourceSummary, routes: Map<string, number>): SourceMappingFinding[] {
  const findings: SourceMappingFinding[] = [];
  const maximumLevel = Math.max(1, ...summary.advancements.map((advancement) => advancement.level));
  const configuration = buildSpeciesConfiguration(summary, AUDIT_SNAPSHOT, maximumLevel);
  const choices = new Set(configuration.choices.map((choice) => advancementId(choice.key)));
  const spellChoices = new Set(configuration.spellChoices.map((choice) => choice.advancementId));
  const grants = new Set(configuration.grants.flatMap((grant) => summary.advancements.filter((advancement) => grant.key.startsWith(`species:${advancement.id}:`)).map((advancement) => advancement.id)));
  const spellGrants = new Set((summary.spellGrants ?? []).map((grant) => grant.advancementId));
  const scales = new Set((summary.scales ?? []).map((scale) => scale.advancementId));
  const featureIds = new Set((summary.features ?? []).flatMap((feature) => featureEntitlements(feature).flatMap((entitlement) => entitlement.advancementId === undefined ? [] : [entitlement.advancementId])));
  const resistanceIds = new Set((summary.resistances ?? []).map((resistance) => resistance.advancementId));

  for (const advancement of summary.advancements) {
    if (!SUPPORTED_SPECIES_ADVANCEMENTS.has(advancement.type)) findings.push(unsupportedFinding('species', source, advancement));
    const mapped = [
      choices.has(advancement.id) ? 'configuration.choice' : undefined,
      spellChoices.has(advancement.id) ? 'configuration.spell-choice' : undefined,
      grants.has(advancement.id) ? 'configuration.grant' : undefined,
      spellGrants.has(advancement.id) ? 'sheet.spell' : undefined,
      scales.has(advancement.id) ? 'sheet.scale' : undefined,
      featureIds.has(advancement.id) ? 'sheet.feature' : undefined,
      resistanceIds.has(advancement.id) ? 'sheet.resistance' : undefined,
      summary.size?.advancementId === advancement.id ? 'identity.size' : undefined,
    ].filter((route): route is string => route !== undefined);
    for (const route of mapped) increment(routes, `species.${route}`);
    findings.push(...validateSpeciesAdvancementRoute(source, advancement, mapped));
  }

  for (const feature of summary.features ?? []) {
    for (const entitlement of featureEntitlements(feature)) findings.push(...auditSpeciesFeatureBoundary(source, summary, feature, entitlement));
    findings.push(...featureDiagnostics('species', source, feature));
  }
  for (const scale of summary.scales ?? []) for (const diagnostic of scale.diagnostics) findings.push(diagnosticFinding('species', source, scale.advancementId, scale.level, diagnostic, 'source.scale'));
  return findings;
}

function validateSpeciesAdvancementRoute(source: FoundrySourceReference, advancement: SpeciesAdvancementSummary, mapped: string[]): SourceMappingFinding[] {
  const findings: SourceMappingFinding[] = [];
  const resolvedTypes = new Set(advancement.dependencies.flatMap((dependency) => dependency.source?.type === undefined ? [] : [dependency.source.type]));
  if (advancement.type === 'Size' && !mapped.includes('identity.size')) findings.push(missingRoute(source, 'species', advancement, 'identity.size'));
  if (advancement.type === 'ScaleValue' && !mapped.includes('sheet.scale')) findings.push(missingRoute(source, 'species', advancement, 'sheet.scale'));
  if (advancement.type === 'ItemGrant' && [...resolvedTypes].some((type) => type === 'feat') && !mapped.includes('sheet.feature')) findings.push(missingRoute(source, 'species', advancement, 'sheet.feature'));
  if (advancement.type === 'ItemGrant' && [...resolvedTypes].some((type) => type === 'spell') && !mapped.includes('sheet.spell')) findings.push(missingRoute(source, 'species', advancement, 'sheet.spell'));
  if (!advancement.automatic && hasChoiceConfiguration(advancement.raw) && !mapped.some((route) => route === 'configuration.choice' || route === 'configuration.spell-choice')) findings.push(missingRoute(source, 'species', advancement, 'configuration choice'));
  return findings;
}

function auditClassMapping(source: FoundrySourceReference, summary: ClassSourceSummary, routes: Map<string, number>): SourceMappingFinding[] {
  const findings: SourceMappingFinding[] = [];
  const maximumLevel = Math.max(1, ...summary.advancements.map((advancement) => advancement.level));
  const configuration = buildClassConfiguration(summary, AUDIT_SNAPSHOT, maximumLevel);
  const selectionIds = new Set(configuration.selections.map((selection) => selection.advancementId));
  const featureIds = new Set((summary.features ?? []).map((feature) => feature.advancementId));
  const scaleIds = new Set((summary.scales ?? []).map((scale) => scale.advancementId));
  const proficiencyChoiceIds = new Set(summary.proficiencies?.choices.map((choice) => choice.advancementId) ?? []);

  for (const advancement of summary.advancements) {
    if (!SUPPORTED_CLASS_ADVANCEMENTS.has(advancement.type)) findings.push(unsupportedFinding('class', source, advancement));
    const mapped = [
      selectionIds.has(advancement.id) ? 'configuration.selection' : undefined,
      featureIds.has(advancement.id) ? 'sheet.feature' : undefined,
      scaleIds.has(advancement.id) ? 'sheet.scale' : undefined,
      proficiencyChoiceIds.has(advancement.id) ? 'sheet.proficiency' : undefined,
      fixedTraitGrants(advancement).length > 0 && fixedTraitGrants(advancement).every((grant) => getEligibleFixedClassTraitGrants(classDocument(summary, advancement.level), summary).includes(grant)) ? 'sheet.proficiency' : undefined,
      advancement.type === 'HitPoints' ? 'calculation.hit-points' : undefined,
    ].filter((route): route is string => route !== undefined);
    for (const route of mapped) increment(routes, `class.${route}`);
    findings.push(...validateClassAdvancementRoute(source, advancement, mapped));
    findings.push(...auditFixedClassTraitBoundary(source, summary, advancement));
  }

  for (const feature of summary.features ?? []) {
    findings.push(...auditClassFeatureBoundary(source, summary, feature));
    findings.push(...featureDiagnostics('class', source, feature));
  }
  for (const scale of summary.scales ?? []) for (const diagnostic of scale.diagnostics) findings.push(diagnosticFinding('class', source, scale.advancementId, scale.level, diagnostic, 'source.scale'));
  return findings;
}

function validateClassAdvancementRoute(source: FoundrySourceReference, advancement: ClassAdvancementSummary, mapped: string[]): SourceMappingFinding[] {
  const findings: SourceMappingFinding[] = [];
  const hasFeatDependency = advancement.dependencies.some((dependency) => dependency.source?.type === 'feat');
  if (advancement.type === 'ScaleValue' && !mapped.includes('sheet.scale')) findings.push(missingRoute(source, 'class', advancement, 'sheet.scale'));
  if (advancement.type === 'ItemGrant' && hasFeatDependency && !mapped.includes('sheet.feature')) findings.push(missingRoute(source, 'class', advancement, 'sheet.feature'));
  if (['AbilityScoreImprovement', 'ItemChoice', 'Subclass'].includes(advancement.type) && !mapped.includes('configuration.selection')) findings.push(missingRoute(source, 'class', advancement, 'configuration selection'));
  if (advancement.type === 'Trait' && hasChoiceConfiguration(advancement.raw) && !mapped.includes('configuration.selection')) findings.push(missingRoute(source, 'class', advancement, 'configuration selection'));
  if (advancement.type === 'Trait' && fixedTraitGrants(advancement).length > 0 && !mapped.includes('sheet.proficiency')) findings.push(missingRoute(source, 'class', advancement, 'sheet.proficiency'));
  return findings;
}

function fixedTraitGrants(advancement: ClassAdvancementSummary): string[] {
  if (advancement.type !== 'Trait') return [];
  const configuration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : {};
  return stringValues(configuration.grants);
}

function auditFixedClassTraitBoundary(source: FoundrySourceReference, summary: ClassSourceSummary, advancement: ClassAdvancementSummary): SourceMappingFinding[] {
  const grants = fixedTraitGrants(advancement);
  if (grants.length === 0 || advancement.classRestriction === 'secondary') return [];
  const atLevel = new Set(getEligibleFixedClassTraitGrants(classDocument(summary, Math.max(1, advancement.level), advancement), summary));
  const findings = grants.filter((grant) => !atLevel.has(grant)).map((grant) => classTraitBoundaryFinding(source, advancement, grant, Math.max(1, advancement.level), 'absent at its source level', `Present at level ${Math.max(1, advancement.level)}`));
  if (advancement.level > 1) {
    const priorLevel = advancement.level - 1;
    const beforeLevel = new Set(getEligibleFixedClassTraitGrants(classDocument(summary, priorLevel, advancement), summary));
    for (const grant of grants) if (beforeLevel.has(grant)) findings.push(classTraitBoundaryFinding(source, advancement, grant, priorLevel, 'visible before its source level', `Absent before level ${advancement.level}`));
  }
  return findings;
}

function auditSpeciesFeatureBoundary(source: FoundrySourceReference, summary: SpeciesSourceSummary, feature: SpeciesFeatureSummary, entitlement: SpeciesFeatureEntitlement): SourceMappingFinding[] {
  const findings: SourceMappingFinding[] = [];
  const eligibleLevel = Math.max(1, entitlement.level);
  const isolated = { ...feature, level: entitlement.level, automatic: entitlement.automatic, advancementId: entitlement.advancementId, selection: entitlement.selection, entitlements: [{ ...entitlement }] };
  const species = { ...summary, features: [isolated] };
  const atLevel = speciesDocument(summary, isolated, entitlement, eligibleLevel);
  if (!hasProjectedFeature(atLevel, species, feature.source.sourcePath)) findings.push(boundaryFinding(source, entitlement, feature, eligibleLevel, 'absent at its source level', `Present at level ${eligibleLevel}`));
  if (entitlement.level > 1) {
    const priorLevel = entitlement.level - 1;
    const beforeLevel = speciesDocument(summary, isolated, entitlement, priorLevel);
    if (hasProjectedFeature(beforeLevel, species, feature.source.sourcePath)) findings.push(boundaryFinding(source, entitlement, feature, priorLevel, 'visible before its source level', `Absent before level ${entitlement.level}`));
  }
  return findings;
}

function auditClassFeatureBoundary(source: FoundrySourceReference, summary: ClassSourceSummary, feature: ClassFeatureSummary): SourceMappingFinding[] {
  const findings: SourceMappingFinding[] = [];
  const eligibleLevel = Math.max(1, feature.level);
  const atLevel = classDocument(summary, eligibleLevel, feature);
  if (!hasProjectedFeature(atLevel, { ...summary, features: [feature] }, feature.source.sourcePath)) findings.push(classBoundaryFinding(source, feature, eligibleLevel, 'absent at its source level', `Present at level ${eligibleLevel}`));
  if (feature.level > 1) {
    const priorLevel = feature.level - 1;
    const beforeLevel = classDocument(summary, priorLevel, feature);
    if (hasProjectedFeature(beforeLevel, { ...summary, features: [feature] }, feature.source.sourcePath)) findings.push(classBoundaryFinding(source, feature, priorLevel, 'visible before its source level', `Absent before level ${feature.level}`));
  }
  return findings;
}

function auditBackgroundMapping(source: FoundrySourceReference, summary: Awaited<ReturnType<SourceIndex['getBackgroundSummary']>>, advancements: RawAdvancement[], routes: Map<string, number>): SourceMappingFinding[] {
  const findings: SourceMappingFinding[] = [];
  for (const advancement of advancements) {
    if (!SUPPORTED_BACKGROUND_ADVANCEMENTS.has(advancement.type)) findings.push(unsupportedRawFinding(source, advancement));
    let route: string | undefined;
    if (advancement.type === 'AbilityScoreImprovement' && summary.abilityScores?.advancementId === advancement.id) route = 'configuration.ability-scores';
    else if (advancement.type === 'ItemGrant' && summary.feat !== undefined) route = 'configuration.granted-feat';
    else if (advancement.type === 'Trait' && summary.skills.length + summary.languages.length + summary.languageChoices.length + summary.tools.length > 0) route = 'sheet.training';
    if (route !== undefined) increment(routes, `background.${route}`);
    else findings.push({
      invariant: 'mapping.background-advancement', severity: 'error', stage: 'background', sourceName: source.name, sourcePath: source.sourcePath,
      nodeId: advancement.id, ...(advancement.level === undefined ? {} : { level: advancement.level }), observed: `${advancement.type} has no normalized consumer`,
      expected: 'A source-backed background configuration or sheet projection', route: 'source.background -> normalized summary',
    });
  }
  for (const feature of summary.features) findings.push(...featureDiagnostics('background', source, feature));
  for (const diagnostic of summary.startingEquipment?.diagnostics ?? []) findings.push(diagnosticFinding('background', source, undefined, undefined, diagnostic, 'source.starting-equipment'));
  return findings;
}

function speciesDocument(summary: SpeciesSourceSummary, feature: SpeciesFeatureSummary, entitlement: SpeciesFeatureEntitlement, level: number): CharacterDocument {
  const configuration = buildSpeciesConfiguration(summary, AUDIT_SNAPSHOT, Math.max(level, entitlement.level));
  const selection = toSpeciesConfigurationSelection(configuration);
  entitleSpeciesFeature(selection, feature, entitlement);
  return {
    ...withRuleset(createCharacterDocument('Source mapping audit', AUDIT_SNAPSHOT), '2024'),
    origin: { sourcePath: summary.source.sourcePath, identifier: summary.source.identifier ?? '', id: summary.source.id },
    speciesConfiguration: selection,
    classProgressions: [{ class: { sourcePath: 'audit/class', identifier: 'audit', id: 'audit' }, targetLevel: level, selections: [] }],
  };
}

function entitleSpeciesFeature(selection: SpeciesConfigurationSelection, feature: SpeciesFeatureSummary, entitlement: SpeciesFeatureEntitlement): void {
  if (entitlement.selection !== undefined) {
    const existing = selection.choices.find((choice) => choice.key === entitlement.selection?.key);
    if (existing === undefined) selection.choices.push({ key: entitlement.selection.key, source: { id: entitlement.advancementId ?? entitlement.selection.key, type: 'Trait' }, selected: [entitlement.selection.value] });
    else existing.selected = [entitlement.selection.value];
    return;
  }
  if (entitlement.automatic === true) return;
  if (!selection.grants.some((grant) => grant.source.id === feature.source.id && grant.source.type === feature.source.type)) selection.grants.push({ key: `species:${entitlement.advancementId ?? feature.source.id}:${feature.source.id}`, source: { id: feature.source.id, type: feature.source.type, name: feature.source.name } });
}

function classDocument(summary: ClassSourceSummary, level: number, entitlement?: Pick<ClassFeatureSummary, 'requiresChoice'>): CharacterDocument {
  const selections = entitlement?.requiresChoice === undefined ? [] : classEntitlementSelections(summary, entitlement.requiresChoice);
  return {
    ...withRuleset(createCharacterDocument('Source mapping audit', AUDIT_SNAPSHOT), '2024'),
    classProgressions: [{ class: { sourcePath: summary.source.sourcePath, identifier: summary.source.identifier ?? '', id: summary.source.id }, targetLevel: level, selections }],
  };
}

function classEntitlementSelections(summary: ClassSourceSummary, requirement: { key: string; value: string }): ClassAdvancementSelection[] {
  const advancementId = requirement.key.replace(/^class:/, '');
  const advancement = summary.advancements.find((candidate) => candidate.id === advancementId);
  const requiredId = requirement.value.split('.').at(-1);
  const source = advancement?.dependencies.find((dependency) => dependency.uuid === requirement.value || dependency.source?.id === requiredId)?.source;
  if (advancement === undefined || source === null || source === undefined) return [];
  if (advancement.type === 'Subclass') return [{ advancementId, kind: 'subclass', selected: source, options: [source] }];
  if (advancement.type === 'AbilityScoreImprovement') return [{ advancementId, kind: 'ability-score', assignments: {}, points: 0, feat: source, featOptions: [source] }];
  return [{ advancementId, kind: 'item', selected: [source], configuredPool: [requirement.value] }];
}

function hasProjectedFeature(document: CharacterDocument, source: SpeciesSourceSummary | ClassSourceSummary, sourcePath: string): boolean {
  const sheet = 'hitDie' in source ? projectFeatureSheet(document, { class: source }) : projectFeatureSheet(document, { species: source });
  return sheet.groups.flatMap((group) => group.entries).some((entry) => entry.source.kind === 'available' && entry.source.value.sourcePath === sourcePath);
}

function featureEntitlements(feature: SpeciesFeatureSummary): SpeciesFeatureEntitlement[] {
  return feature.entitlements ?? [{ level: feature.level, automatic: feature.automatic, advancementId: feature.advancementId, selection: feature.selection }];
}

function featureDiagnostics(stage: SourceMappingStage, source: FoundrySourceReference, feature: { advancementId?: string; level?: number; source: FoundrySourceReference; activityDiagnostics?: string[]; effectDiagnostics?: string[] }): SourceMappingFinding[] {
  return [...(feature.activityDiagnostics ?? []), ...(feature.effectDiagnostics ?? [])].map((diagnostic) => diagnosticFinding(stage, source, feature.advancementId, feature.level, diagnostic, `source.feature:${feature.source.sourcePath}`));
}

function boundaryFinding(source: FoundrySourceReference, entitlement: SpeciesFeatureEntitlement, feature: SpeciesFeatureSummary, level: number, observed: string, expected: string): SourceMappingFinding {
  return { invariant: 'eligibility.species-feature-boundary', severity: 'error', stage: 'sheet', sourceName: `${source.name}: ${feature.source.name}`, sourcePath: source.sourcePath, ...(entitlement.advancementId === undefined ? {} : { nodeId: entitlement.advancementId }), level, observed, expected, route: 'source entitlement -> eligible species feature -> feature sheet' };
}

function classBoundaryFinding(source: FoundrySourceReference, feature: ClassFeatureSummary, level: number, observed: string, expected: string): SourceMappingFinding {
  return { invariant: 'eligibility.class-feature-boundary', severity: 'error', stage: 'sheet', sourceName: `${source.name}: ${feature.source.name}`, sourcePath: source.sourcePath, nodeId: feature.advancementId, level, observed, expected, route: 'source grant -> class feature -> feature sheet' };
}

function classTraitBoundaryFinding(source: FoundrySourceReference, advancement: ClassAdvancementSummary, grant: string, level: number, observed: string, expected: string): SourceMappingFinding {
  return { invariant: 'eligibility.class-trait-boundary', severity: 'error', stage: 'sheet', sourceName: `${source.name}: ${grant}`, sourcePath: source.sourcePath, nodeId: advancement.id, level, observed, expected, route: 'source Trait grant -> eligible class proficiency -> character sheet' };
}

function missingRoute(source: FoundrySourceReference, stage: 'species' | 'class', advancement: SpeciesAdvancementSummary | ClassAdvancementSummary, expectedRoute: string): SourceMappingFinding {
  const secondaryClassRoute = stage === 'class' && 'classRestriction' in advancement && advancement.classRestriction === 'secondary';
  const deferredClassRoute = stage === 'class' && advancement.level > 1;
  return {
    invariant: secondaryClassRoute ? 'mapping.secondary-class-advancement' : deferredClassRoute ? 'mapping.deferred-class-advancement' : `mapping.${stage}-advancement`,
    severity: secondaryClassRoute || deferredClassRoute ? 'warning' : 'error',
    stage,
    sourceName: source.name,
    sourcePath: source.sourcePath,
    nodeId: advancement.id,
    level: advancement.level,
    observed: `${advancement.type} does not reach ${expectedRoute}`,
    expected: secondaryClassRoute
      ? 'Intentional exclusion from primary-class creation with a future multiclass route'
      : deferredClassRoute
      ? 'A future-level implementation route before level-up workflows are supported'
      : `A normalized ${expectedRoute} mapping`,
    route: `source.${stage} -> ${expectedRoute}`,
  };
}

function unsupportedFinding(stage: 'species' | 'class', source: FoundrySourceReference, advancement: SpeciesAdvancementSummary | ClassAdvancementSummary): SourceMappingFinding {
  return { invariant: `mapping.${stage}-advancement-type`, severity: 'error', stage, sourceName: source.name, sourcePath: source.sourcePath, nodeId: advancement.id, level: advancement.level, observed: `Unsupported advancement type ${advancement.type}`, expected: 'An explicitly supported or intentionally deferred advancement type', route: `source.${stage} -> normalized advancement` };
}

function unsupportedRawFinding(source: FoundrySourceReference, advancement: RawAdvancement): SourceMappingFinding {
  return { invariant: 'mapping.background-advancement-type', severity: 'error', stage: 'background', sourceName: source.name, sourcePath: source.sourcePath, nodeId: advancement.id, ...(advancement.level === undefined ? {} : { level: advancement.level }), observed: `Unsupported advancement type ${advancement.type}`, expected: 'An explicitly supported background advancement type', route: 'source.background -> normalized summary' };
}

function diagnosticFinding(stage: SourceMappingStage, source: FoundrySourceReference, nodeId: string | undefined, level: number | undefined, diagnostic: string, route: string): SourceMappingFinding {
  return { invariant: 'mapping.partial-diagnostic', severity: 'warning', stage, sourceName: source.name, sourcePath: source.sourcePath, ...(nodeId === undefined ? {} : { nodeId }), ...(level === undefined ? {} : { level }), observed: diagnostic, expected: 'A fully resolved source-backed projection', route };
}

function sourceFailure(stage: 'species' | 'class' | 'background', source: FoundrySourceReference, error: unknown): SourceMappingFinding {
  return { invariant: 'mapping.source-read', severity: 'error', stage, sourceName: source.name, sourcePath: source.sourcePath, observed: error instanceof Error ? error.message : String(error), expected: 'A readable normalized source mapping', route: `source.${stage} -> normalized summary` };
}

interface RawAdvancement { id: string; type: string; level?: number; raw: Record<string, unknown>; }

function rawAdvancements(raw: Record<string, unknown> | undefined): RawAdvancement[] {
  const advancement = isRecord(raw?.system) ? raw.system.advancement : undefined;
  const entries = Array.isArray(advancement) ? advancement : Object.values(isRecord(advancement) ? advancement : {});
  return entries.flatMap((value) => {
    if (!isRecord(value) || typeof value._id !== 'string' || typeof value.type !== 'string') return [];
    return [{ id: value._id, type: value.type, ...(typeof value.level === 'number' ? { level: value.level } : {}), raw: value }];
  });
}

function hasChoiceConfiguration(raw: Record<string, unknown>): boolean {
  const configuration = isRecord(raw.configuration) ? raw.configuration : {};
  if (typeof configuration.choices === 'number') return configuration.choices > 0;
  if (Array.isArray(configuration.choices)) return configuration.choices.length > 0;
  if (Object.keys(isRecord(configuration.choices) ? configuration.choices : {}).length > 0) return true;
  return Array.isArray(configuration.pool) && configuration.pool.length > 0;
}

function advancementId(key: string): string { return key.startsWith('species:') ? key.slice('species:'.length) : key; }
function increment(routes: Map<string, number>, route: string): void { routes.set(route, (routes.get(route) ?? 0) + 1); }

function compareFindings(left: SourceMappingFinding, right: SourceMappingFinding): number {
  return left.severity.localeCompare(right.severity) || left.invariant.localeCompare(right.invariant) || left.sourcePath.localeCompare(right.sourcePath) || (left.nodeId ?? '').localeCompare(right.nodeId ?? '') || (left.level ?? -1) - (right.level ?? -1);
}

export function formatSourceMappingJson(result: SourceMappingAuditResult): string { return JSON.stringify(result); }

export function formatSourceMappingMarkdown(result: SourceMappingAuditResult): string {
  const { coverage } = result;
  const lines = [
    '# 2024 source-mapping audit',
    '',
    `Sources: ${coverage.species} species, ${coverage.classes} classes, ${coverage.backgrounds} backgrounds.`,
    `Mapped nodes: ${coverage.speciesAdvancements} species advancements, ${coverage.classAdvancements} class advancements, ${coverage.backgroundAdvancements} background advancements, ${coverage.speciesFeatureEntitlements} species feature entitlements, ${coverage.classFeatures} class features.`,
    `Projected sheets: ${coverage.sheetCombinations} combinations across levels 1 and 5.`,
    '',
    '## Mapping routes',
    '',
    ...Object.entries(coverage.mappedRoutes).map(([route, count]) => `- ${route}: ${count}`),
    '',
  ];
  if (result.findings.length === 0) return [...lines, '## Findings', '', 'No mapping violations or partial diagnostics found.'].join('\n');
  const grouped = new Map<string, SourceMappingFinding[]>();
  for (const finding of result.findings) grouped.set(`${finding.severity}:${finding.invariant}`, [...(grouped.get(`${finding.severity}:${finding.invariant}`) ?? []), finding]);
  lines.push('## Findings', '');
  for (const [group, findings] of grouped) {
    lines.push(`### ${group} (${findings.length})`, '');
    for (const finding of findings) {
      const node = finding.nodeId === undefined ? '' : `, node \`${finding.nodeId}\``;
      const level = finding.level === undefined ? '' : `, level ${finding.level}`;
      lines.push(`- ${finding.sourceName}: \`${finding.sourcePath}\`${node}${level} — ${finding.observed}; expected ${finding.expected}. Route: ${finding.route}.`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
