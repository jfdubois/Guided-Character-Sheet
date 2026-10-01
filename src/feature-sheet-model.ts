import type { CharacterDocument } from './character-model';
import type { BackgroundFeatureSummary, BackgroundSourceSummary, ClassFeatureSummary, ClassSourceSummary, SpeciesFeatureSummary, SpeciesSourceSummary } from './character-sources';
import type { FoundrySourceReference } from './foundry-source-catalog';
import type { FoundryActivitySummary, FoundryUsesSummary } from './foundry-activity-summary';
import type { SheetValue } from './character-sheet-model';
import { getLevelOneClassProgression } from './level-one-progression';
import { recoverableResetForUses } from './resource-period';
import { resolveFeatureDamagePart, resolveFeatureScaleLookup } from './feature-damage-resolver';

export type FeatureSheetCategory = 'class' | 'species' | 'background' | 'feats';

export interface FeatureSheetResource {
  /** Stable mutable-state key; actions may project the same resource read-only. */
  key: string;
  current: SheetValue<number>;
  maximum: SheetValue<number | string>;
  reset: SheetValue<string>;
}

export interface FeatureSheetEntry {
  key: string;
  name: string;
  category: FeatureSheetCategory;
  level?: number;
  source: SheetValue<FoundrySourceReference>;
  origins: string[];
  description: SheetValue<string>;
  activities: FeatureSheetActivity[];
  resource?: FeatureSheetResource;
  diagnostics: string[];
}

export type FeatureSheetActivity = FoundryActivitySummary & { resource?: FeatureSheetResource; resolvedDamage?: string };

export interface FeatureSheetGroup {
  category: FeatureSheetCategory;
  label: string;
  entries: FeatureSheetEntry[];
}

export interface FeatureSheetProjection {
  groups: FeatureSheetGroup[];
  warnings: string[];
}

export interface FeatureSheetSources {
  class?: ClassSourceSummary;
  species?: SpeciesSourceSummary;
  background?: BackgroundSourceSummary;
}

/** Stable key for a feature-level mutable resource. */
export function featureResourceKey(sourcePath: string): string { return `feature:${sourcePath}`; }
/** Stable key for an activity-level mutable resource. */
export function featureActivityResourceKey(sourcePath: string, activityId: string): string { return `feature:${sourcePath}:activity:${activityId}`; }

export function projectFeatureSheet(document: CharacterDocument, sources: FeatureSheetSources): FeatureSheetProjection {
  const warnings: string[] = [];
  const proficiencyBonus = sources.class === undefined ? undefined : getLevelOneClassProgression(sources.class).proficiencyBonus;
  const groups: FeatureSheetGroup[] = [
    { category: 'class', label: 'Class features', entries: [] },
    { category: 'species', label: 'Species traits', entries: [] },
    { category: 'background', label: 'Background features', entries: [] },
    { category: 'feats', label: 'Feats', entries: [] },
  ];
  const entries = new Map<string, FeatureSheetEntry>();
  const classProgression = document.classProgressions?.find((progression) => progression.class.sourcePath === sources.class?.source.sourcePath);
  const resolveFeatureDescription = (category: FeatureSheetCategory, description: string | undefined): string | undefined => {
    if (description === undefined || category !== 'class') return description;
    const context = {
      classIdentifier: classProgression?.class.identifier ?? '',
      targetLevel: classProgression?.targetLevel ?? 0,
      scales: sources.class?.scales ?? [],
    };
    return description.replace(/\[\[lookup\s+(@scale\.[^.\s]+\.[^.\s]+)\]\]/g, (token, reference: string) => {
      const value = resolveFeatureScaleLookup(reference, context).value;
      if (value === undefined) return token;
      if (value.type === 'number') return String(value.value);
      if (value.type === 'dice') return `${value.number === null ? '' : value.number}d${value.faces}${value.modifiers.join('')}`;
      return `${value.value} ${value.units}`;
    });
  };
  const projectActivities = (activities: FoundryActivitySummary[] | undefined, sourcePath: string, category: FeatureSheetCategory, featureUses?: FoundryUsesSummary): { activities: FeatureSheetActivity[]; diagnostics: string[] } => {
    const diagnostics: string[] = [];
    const projected = (activities ?? []).map((activity) => {
      const resolutions = (activity.damage ?? []).filter((part) => part.customFormula !== undefined).map((part) => resolveFeatureDamagePart({
        ...part,
        types: category === 'species' && scaleOwner(part.customFormula!) === sources.species?.source.identifier
          ? speciesDamageTypes(document, part.types)
          : part.types,
      }, {
        classIdentifier: classProgression?.class.identifier ?? '',
        targetLevel: scaleOwner(part.customFormula!) === sources.species?.source.identifier ? totalCharacterLevel(document) ?? 0 : classProgression?.targetLevel ?? 0,
        scales: sources.class?.scales ?? [],
        speciesIdentifier: sources.species?.source.identifier,
        speciesScales: sources.species?.scales ?? [],
      }));
      diagnostics.push(...resolutions.flatMap((resolution) => resolution.diagnostic === undefined ? [] : [resolution.diagnostic]));
      const resolvedDamage = resolutions.flatMap((resolution) => resolution.damage === undefined ? [] : [resolution.damage]).join(', ');
      return {
        ...activity,
        ...(resolvedDamage.length === 0 ? {} : { resolvedDamage }),
        // Foundry sometimes puts the limited-use definition on the parent item
        // rather than on the activity. Keep the activity and feature views
        // pointed at the same authoritative mutable resource in that case.
        resource: projectResource(document, activity.uses === undefined ? featureResourceKey(sourcePath) : featureActivityResourceKey(sourcePath, activity.id), activity.uses ?? featureUses, proficiencyBonus),
      };
    });
    return { activities: projected, diagnostics };
  };
  const add = (category: FeatureSheetCategory, source: FoundrySourceReference, details: FeatureDetails, origin: string, featureLevel?: number): void => {
    const key = sourceKey(source);
    const existing = entries.get(key);
    if (existing !== undefined) {
      if (!existing.origins.includes(origin)) existing.origins.push(origin);
      const description = resolveFeatureDescription(category, details.description);
      if (description !== undefined && existing.description.kind === 'missing') existing.description = available(description);
      if (details.activities !== undefined && existing.activities.length === 0) {
        const projected = projectActivities(details.activities, source.sourcePath, category, details.uses);
        existing.activities = projected.activities;
        existing.diagnostics.push(...projected.diagnostics);
      }
      return;
    }
    const projected = projectActivities(details.activities, source.sourcePath, category, details.uses);
    const description = resolveFeatureDescription(category, details.description);
    const entry: FeatureSheetEntry = {
      key, name: source.name, category, ...(featureLevel === undefined ? {} : { level: featureLevel }), source: available(source), origins: [origin],
      description: description === undefined ? missing('Feature description is unavailable.') : available(description),
      activities: projected.activities, resource: projectResource(document, featureResourceKey(source.sourcePath), details.uses, proficiencyBonus), diagnostics: [...(details.activityDiagnostics ?? []), ...projected.diagnostics],
    };
    entries.set(key, entry);
    groups.find((group) => group.category === category)!.entries.push(entry);
  };

  if (sources.class === undefined) warnings.push('Class feature source is unavailable.');
  else for (const feature of sources.class.features ?? []) if (classProgression === undefined || feature.level <= classProgression.targetLevel) add('class', feature.source, feature, 'Class', feature.level);
  if (sources.species === undefined) warnings.push('Species feature source is unavailable.');
  else {
    warnings.push(...(sources.species.effectDiagnostics ?? []));
    for (const feature of sources.species.features ?? []) if (isSpeciesFeatureEntitled(document, feature)) add('species', feature.source, feature, 'Species', feature.level);
  }
  if (sources.background === undefined) warnings.push('Background feature source is unavailable.');
  else {
    for (const feature of sources.background.features ?? []) add('background', feature.source, feature, 'Background');
    if (sources.background.feat !== undefined) add('feats', sources.background.feat, {}, 'Background');
  }
  for (const progression of document.classProgressions ?? []) for (const selection of progression.selections) {
    if (selection.kind === 'ability-score' && selection.feat !== undefined) add('feats', selection.feat, {}, 'Class');
    if (selection.kind === 'item') for (const selected of selection.selected) if (selected.type === 'feat') add('feats', selected, {}, 'Class');
  }
  groups.forEach((group) => group.entries.sort((left, right) => left.source.kind === 'available' && right.source.kind === 'available' ? left.source.value.sourcePath.localeCompare(right.source.value.sourcePath) || left.name.localeCompare(right.name) : left.name.localeCompare(right.name)));
  return { groups, warnings };
}

interface FeatureDetails { description?: string; activities?: FoundryActivitySummary[]; activityDiagnostics?: string[]; uses?: FoundryUsesSummary; }

function totalCharacterLevel(document: CharacterDocument): number | undefined {
  const progressions = document.classProgressions ?? [];
  return progressions.length === 0 ? undefined : progressions.reduce((total, progression) => total + progression.targetLevel, 0);
}

function speciesDamageTypes(document: CharacterDocument, inherited: string[]): string[] {
  const selected = document.speciesConfiguration?.choices.flatMap((choice) => choice.selected).find((value) => value.startsWith('dr:'))?.slice(3);
  if (selected === undefined) return inherited;
  const matching = inherited.filter((type) => type.toLowerCase() === selected.toLowerCase());
  return matching.length === 0 ? inherited : matching;
}

function scaleOwner(formula: string): string | undefined {
  return /^@scale\.([^\.\s]+)\./.exec(formula)?.[1];
}

function isSpeciesFeatureEntitled(document: CharacterDocument, feature: SpeciesFeatureSummary): boolean {
  const level = totalCharacterLevel(document);
  if (level !== undefined && feature.level > level) return false;
  const configuration = document.speciesConfiguration;
  if (configuration === undefined) return true;
  if (feature.selection !== undefined) {
    const { key, value } = feature.selection;
    return configuration.choices.some((choice) => choice.key === key && choice.selected.includes(value));
  }
  if (feature.automatic === true) return true;
  if (configuration.grants.some((grant) => grant.source.id === feature.source.id && grant.source.type === feature.source.type)) return true;
  return false;
}

function projectResource(document: CharacterDocument, key: string, uses: FoundryUsesSummary | undefined, proficiencyBonus: number | undefined): FeatureSheetResource | undefined {
  if (uses === undefined || recoverableResetForUses(uses) === undefined) return undefined;
  const resource = document.mutable?.resources.find((candidate) => candidate.key === key);
  const maximum = resource !== undefined
    ? available(resource.maximum)
    : uses.maximum === undefined ? missing<number | string>('Feature resource maximum is unavailable.')
      : uses.maximum === '@prof' && proficiencyBonus !== undefined ? available(proficiencyBonus) : available(uses.maximum);
  return {
    key,
    current: resource === undefined ? missing('Current resource value is unavailable.') : available(resource.current),
    maximum,
    reset: resource === undefined ? missing('Resource reset state is unavailable.') : available(resource.reset),
  };
}

function sourceKey(source: FoundrySourceReference): string { return `${source.sourcePath}:${source.pack}:${source.type}:${source.id}`; }
function available<T>(value: T): SheetValue<T> { return { kind: 'available', value }; }
function missing<T>(reason: string): SheetValue<T> { return { kind: 'missing', reason }; }

export type { ClassFeatureSummary, SpeciesFeatureSummary, BackgroundFeatureSummary };
