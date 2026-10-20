import type { ClassConfiguration } from './class-configuration';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from './character-sources';
import type { SpeciesConfiguration } from './species-configuration';
import { isSpeciesChoiceAvailable } from './species-configuration';
import { isRecord, stringValues } from './foundry-utils';

export interface ExpertiseProficiencySources {
  classSummary: ClassSourceSummary;
  classConfiguration: ClassConfiguration;
  background?: BackgroundSourceSummary;
  speciesSummary?: SpeciesSourceSummary;
  speciesConfiguration?: SpeciesConfiguration;
}

/** Collects only proficiencies granted by source records active at the current class level. */
export function collectExpertiseProficiencies(sources: ExpertiseProficiencySources): string[] {
  const level = sources.classConfiguration.targetLevel;
  const activeClassAdvancements = sources.classSummary.advancements.filter((advancement) =>
    advancement.level <= level && (advancement.classRestriction === undefined || advancement.classRestriction === 'primary'),
  );
  const proficiencySelectors = new Set<string>();

  for (const advancement of activeClassAdvancements) {
    if (advancement.type !== 'Trait') continue;
    const configuration = record(advancement.raw.configuration);
    for (const grant of stringValues(configuration.grants)) {
      if (isProficiencySelector(grant)) proficiencySelectors.add(grant);
    }
    if (configuration.mode === 'expertise') continue;

    const selection = sources.classConfiguration.selections.find((candidate) =>
      candidate.advancementId === advancement.id && candidate.kind === 'trait',
    );
    if (selection?.kind !== 'trait') continue;
    const pool = configuredPool(configuration);
    for (const value of selection.selected) {
      if (isProficiencySelector(value) && matchesAnySelector(value, pool)) proficiencySelectors.add(value);
    }
  }

  const activeClassGrants = new Set(activeClassAdvancements.flatMap((advancement) => {
    if (advancement.type !== 'Trait') return [];
    return stringValues(record(advancement.raw.configuration).grants).filter(isProficiencySelector);
  }));
  for (const value of [...(sources.classSummary.proficiencies?.skills ?? []), ...(sources.classSummary.proficiencies?.tools ?? [])]) {
    if (activeClassGrants.has(value) && isProficiencySelector(value)) proficiencySelectors.add(value);
  }

  for (const value of [...(sources.background?.skills ?? []), ...(sources.background?.tools ?? [])]) {
    if (isProficiencySelector(value)) proficiencySelectors.add(value);
  }

  const speciesSummary = sources.speciesSummary;
  const speciesConfiguration = sources.speciesConfiguration;
  if (speciesSummary !== undefined && speciesConfiguration !== undefined) {
    for (const advancement of speciesSummary.advancements) {
      if (advancement.level > level || advancement.type !== 'Trait') continue;
      const configuration = record(advancement.raw.configuration);
      for (const grant of stringValues(configuration.grants)) {
        if (isProficiencySelector(grant)) proficiencySelectors.add(grant);
      }
    }

    for (const choice of speciesConfiguration.choices) {
      // Restored source-backed choices carry the current source options and level even when their key is nested.
      // Stale saved choices have no current options after restore, so they cannot grant proficiency here.
      if (choice.level > level || choice.source.type !== 'Trait' || !isSpeciesChoiceAvailable(choice, speciesConfiguration)) continue;
      const available = new Set(choice.options.map((option) => option.value));
      for (const value of choice.selected) {
        if (available.has(value) && isProficiencySelector(value)) proficiencySelectors.add(value);
      }
    }
  }

  return [...proficiencySelectors];
}

/** Applies the Foundry expertise pool and the character's source-backed proficiencies together. */
export function isExpertiseEligibleValue(value: string, configuredPool: readonly string[], proficiencies: readonly string[]): boolean {
  return matchesAnySelector(value, configuredPool) && matchesAnySelector(value, proficiencies);
}

export function filterExpertiseCandidates<T extends { id: string }>(
  candidates: readonly T[],
  configuredPool: readonly string[],
  proficiencies: readonly string[],
): T[] {
  return candidates.filter((candidate) => isExpertiseEligibleValue(candidate.id, configuredPool, proficiencies));
}

export function validateExpertiseSelections(
  selected: readonly string[],
  configuredPool: readonly string[],
  proficiencies: readonly string[],
  label: (value: string) => string = (value) => value,
): string[] {
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  for (const value of selected) {
    if (seen.has(value)) diagnostics.push(`Duplicate expertise selection: ${label(value)}.`);
    seen.add(value);
    if (!matchesAnySelector(value, configuredPool)) {
      diagnostics.push(`Saved expertise ${label(value)} is outside the current source-defined pool. Choose an option from the current pool.`);
    } else if (!matchesAnySelector(value, proficiencies)) {
      diagnostics.push(`Expertise requires proficiency in ${label(value)}.`);
      diagnostics.push(`Update the expertise selection for ${label(value)} or restore that proficiency.`);
    }
  }
  return diagnostics;
}

export function matchesAnySelector(value: string, selectors: readonly string[]): boolean {
  return selectors.some((selector) => matchesSelector(selector, value));
}

export function getExpertisePool(advancement: { raw: Record<string, unknown> }): string[] {
  return configuredPool(record(advancement.raw.configuration));
}

function matchesSelector(selector: string, value: string): boolean {
  const normalizedSelector = poolValueId(selector);
  const normalizedValue = poolValueId(value);
  return normalizedSelector.endsWith(':*')
    ? normalizedValue.startsWith(normalizedSelector.slice(0, -1))
    : normalizedSelector === normalizedValue;
}

function poolValueId(value: string): string {
  return value.startsWith('Compendium.') ? value.split('.').at(-1) ?? value : value;
}

function isProficiencySelector(value: string): boolean {
  return value.startsWith('skills:') || value.startsWith('tool:') || value.startsWith('tools:');
}

function configuredPool(configuration: Record<string, unknown>): string[] {
  const direct = stringValues(configuration.pool);
  if (direct.length > 0) return direct;
  const groups = configuration.choices;
  const entries = Array.isArray(groups) ? groups : Object.values(record(groups));
  return entries.flatMap((entry) => stringValues(record(entry).pool));
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
