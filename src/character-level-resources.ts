import type { CharacterDocument } from './character-model';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from './character-sources';
import { getEligibleClassFeatures, getEligibleClassScales } from './class-feature-eligibility';
import { getEligibleSpeciesFeatures } from './species-feature-eligibility';
import type { CharacterResource } from './mutable-character-state';
import { mutableRecoveryProfiles, mutableResetForPeriod, mutableResetForRecovery } from './resource-period';
import { resolveFeatureScaleLookup } from './feature-damage-resolver';
import { proficiencyBonusForLevel } from './proficiency-bonus';
import type { FoundryUsesSummary } from './foundry-activity-summary';

/** Rebuild source-backed limited feature resources for the effective class level. */
export function projectLevelResources(document: CharacterDocument, classSummary: ClassSourceSummary, species: SpeciesSourceSummary, background: BackgroundSourceSummary): { resources: CharacterResource[]; diagnostics: string[] } {
  const progression = document.classProgressions?.find((entry) => entry.class.sourcePath === classSummary.source.sourcePath);
  if (progression === undefined) return { resources: [], diagnostics: [`Class progression ${classSummary.source.sourcePath} is unavailable for resource projection.`] };
  const classScales = getEligibleClassScales(document, classSummary);
  const proficiency = proficiencyBonusForLevel(progression.targetLevel);
  const resources = new Map<string, CharacterResource>();
  const diagnostics: string[] = [];
  const add = (key: string, uses: FoundryUsesSummary | undefined, classResource = false): void => {
    if (uses === undefined) return;
    const reset = mutableResetForRecovery(uses.recovery);
    if (reset === undefined) { diagnostics.push(`${key}: unsupported recovery period in source.`); return; }
    const unsupportedProfile = uses.recovery.find((entry) => {
      if (mutableResetForPeriod(entry.period) === undefined) return true;
      if (entry.type === undefined || entry.type === 'recoverAll') return false;
      return entry.type !== 'formula' || typeof entry.formula !== 'string' || entry.formula.trim() !== entry.formula || entry.formula.length === 0;
    });
    if (unsupportedProfile !== undefined) { diagnostics.push(`${key}: unsupported recovery profile ${JSON.stringify(unsupportedProfile)}.`); return; }
    const raw = uses.maximum;
    const scale = classResource && typeof raw === 'string' && raw.startsWith('@scale.')
      ? resolveFeatureScaleLookup(raw, { classIdentifier: classSummary.source.identifier, targetLevel: progression.targetLevel, scales: classScales }).value
      : undefined;
    const maximum = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw === '@prof' ? proficiency : scale?.type === 'number' ? scale.value : undefined;
    if (maximum === undefined || !Number.isInteger(maximum) || maximum < 0) { diagnostics.push(`${key}: unsupported or unresolved source maximum ${String(raw)}.`); return; }
    const recovery = mutableRecoveryProfiles(uses);
    resources.set(key, { key, current: maximum, maximum, reset, ...(recovery.length === 0 ? {} : { recovery }) });
  };
  const feature = (sourcePath: string, uses: FoundryUsesSummary | undefined, activities: Array<{ id: string; uses?: FoundryUsesSummary }> | undefined, classResource = false): void => {
    add(`feature:${sourcePath}`, uses, classResource);
    for (const activity of activities ?? []) if (activity.uses !== undefined) add(`feature:${sourcePath}:activity:${activity.id}`, activity.uses, classResource);
  };
  for (const entry of getEligibleClassFeatures(document, classSummary)) feature(entry.source.sourcePath, entry.uses, entry.activities, true);
  for (const entry of getEligibleSpeciesFeatures(document, species)) feature(entry.source.sourcePath, entry.uses, entry.activities);
  for (const entry of background.features) feature(entry.source.sourcePath, entry.uses, entry.activities);
  return { resources: [...resources.values()], diagnostics };
}
