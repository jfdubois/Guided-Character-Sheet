import type { CharacterDocument } from './character-model';
import type { SpeciesFeatureEntitlement, SpeciesFeatureSummary, SpeciesSourceSummary } from './character-sources';

export function totalCharacterLevel(document: CharacterDocument): number {
  const progressions = document.classProgressions ?? [];
  return progressions.reduce((total, progression) => total + progression.targetLevel, 0);
}

/** Applies source level, choice, and grant provenance before a species feature can affect the sheet. */
export function isSpeciesFeatureEntitled(document: CharacterDocument, feature: SpeciesFeatureSummary, characterLevel = totalCharacterLevel(document)): boolean {
  const level = characterLevel;
  const configuration = document.speciesConfiguration;
  const entitled = (entitlement: SpeciesFeatureEntitlement): boolean => {
    if (entitlement.level > level) return false;
    if (entitlement.selection !== undefined) {
      if (configuration === undefined) return false;
      const { key, value } = entitlement.selection;
      return configuration.choices.some((choice) => choice.key === key && choice.selected.includes(value));
    }
    if (entitlement.automatic === true) return true;
    // Legacy character files predate persisted species grant provenance. Their
    // non-choice features remain available, but explicit choices never do.
    if (configuration === undefined) return true;
    return configuration.grants.some((grant) => grant.source.id === feature.source.id && grant.source.type === feature.source.type);
  };
  return (feature.entitlements ?? [{ level: feature.level, automatic: feature.automatic, advancementId: feature.advancementId, selection: feature.selection }]).some(entitled);
}

export function getEligibleSpeciesFeatures(document: CharacterDocument, species: SpeciesSourceSummary | undefined, characterLevel?: number): SpeciesFeatureSummary[] {
  return (species?.features ?? []).filter((feature) => isSpeciesFeatureEntitled(document, feature, characterLevel));
}
