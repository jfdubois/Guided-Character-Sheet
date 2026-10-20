import type { CharacterDocument } from './character-model';
import type { ClassProficiencies, ClassSourceSummary } from './character-sources';
import { isClassEntitlementEligible } from './class-feature-eligibility';
import { isRecord, stringValues } from './foundry-utils';

const CATEGORIES = ['armor', 'weapon', 'tool', 'saves', 'languages', 'skills'] as const;
type ProficiencyCategory = typeof CATEGORIES[number];

/** Returns fixed Trait grants whose source advancement is active for this class progression. */
export function getEligibleFixedClassTraitGrants(document: CharacterDocument, summary: ClassSourceSummary | undefined): string[] {
  if (summary === undefined) return [];
  const progression = document.classProgressions?.find((entry) => entry.class.sourcePath === summary.source.sourcePath);
  if (progression === undefined) return [];
  const grants = new Set<string>();
  for (const advancement of summary.advancements) {
    if (advancement.type !== 'Trait' || !isClassEntitlementEligible(progression, advancement)) continue;
    const configuration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : {};
    for (const grant of stringValues(configuration.grants)) if (isProficiencySelector(grant)) grants.add(grant);
  }
  return [...grants];
}

/** Projects the legacy level-one summary plus later fixed Trait grants active at the selected level. */
export function getEligibleClassProficiencies(document: CharacterDocument, summary: ClassSourceSummary | undefined): ClassProficiencies | undefined {
  if (summary === undefined) return undefined;
  const progression = document.classProgressions?.find((entry) => entry.class.sourcePath === summary.source.sourcePath);
  if (progression === undefined) return undefined;
  const fixed = getEligibleFixedClassTraitGrants(document, summary);
  const legacy = summary.proficiencies;
  return {
    armor: mergeCategory('armor', legacy?.armor, fixed),
    weapons: mergeCategory('weapon', legacy?.weapons, fixed),
    tools: mergeCategory('tool', legacy?.tools, fixed),
    savingThrows: mergeCategory('saves', legacy?.savingThrows, fixed),
    languages: mergeCategory('languages', legacy?.languages, fixed),
    skills: mergeCategory('skills', legacy?.skills, fixed),
    choices: legacy?.choices.map((choice) => ({ ...choice, pool: [...choice.pool] })) ?? [],
  };
}

function mergeCategory(category: ProficiencyCategory, legacy: readonly string[] | undefined, fixed: readonly string[]): string[] {
  return [...new Set([...(legacy ?? []), ...fixed.filter((value) => value.startsWith(`${category}:`))])];
}

function isProficiencySelector(value: string): boolean {
  return CATEGORIES.some((category) => value.startsWith(`${category}:`));
}
