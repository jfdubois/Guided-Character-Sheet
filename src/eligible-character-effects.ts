import type { CharacterDocument } from './character-model';
import type { CharacterSheetSources } from './character-sheet-model';
import { interpretPassiveEffects, type PassiveEffectContribution, type PassiveEffectDiagnostic, type PassiveEffectSource } from './passive-effects';
import { getEligibleClassFeatures } from './class-feature-eligibility';
import { getEligibleSpeciesFeatures, totalCharacterLevel } from './species-feature-eligibility';
import { isClassEntitlementEligible } from './class-feature-eligibility';
import type { FoundrySourceReference } from './character-sources';

export interface EligibleCharacterEffects { contributions: PassiveEffectContribution[]; diagnostics: PassiveEffectDiagnostic[]; }

export function collectEligibleCharacterEffects(document: CharacterDocument, sources: CharacterSheetSources): EligibleCharacterEffects {
  const effects: PassiveEffectSource[] = [];
  const diagnostics: PassiveEffectDiagnostic[] = [];
  const sourceKeys = new Set<string>();
  const add = (source: FoundrySourceReference, activeEffects: unknown[] | undefined): void => {
    const key = sourceKey(source);
    if (sourceKeys.has(key)) return;
    sourceKeys.add(key);
    if (activeEffects === undefined) return;
    effects.push({ source, effects: activeEffects });
  };

  for (const feature of getEligibleClassFeatures(document, sources.class)) add(feature.source, feature.activeEffects);
  for (const feature of getEligibleSpeciesFeatures(document, sources.species)) add(feature.source, feature.activeEffects);

  const activeBackground = document.background?.sourcePath === sources.background?.source.sourcePath;
  if (activeBackground) {
    const grantedFeats = sources.background?.grantedFeats ?? (sources.background?.grantedFeat === undefined ? [] : [sources.background.grantedFeat]);
    for (const feat of grantedFeats) add(feat.source, feat.activeEffects);
  }

  for (const progression of document.classProgressions ?? []) {
    if (progression.class.sourcePath !== sources.class?.source.sourcePath) continue;
    for (const selection of progression.selections) {
      const advancement = sources.class.advancements.find((candidate) => candidate.id === selection.advancementId);
      if (advancement === undefined || !isClassEntitlementEligible(progression, advancement)) continue;
      const selectedReferences = selection.kind === 'ability-score' ? selection.feat === undefined ? [] : [selection.feat]
        : selection.kind === 'item' ? selection.selected.filter((reference) => reference.type === 'feat') : [];
      for (const reference of selectedReferences) {
        const summary = sources.selectedFeatSummaries?.get(sourceKey(reference));
        if (summary === undefined || summary === null) {
          diagnostics.push({ source: reference, message: `Feat passive effect source is unavailable for ${reference.name}.` });
          continue;
        }
        if (summary.minimumLevel !== undefined && totalCharacterLevel(document) < summary.minimumLevel) continue;
        add(summary.source, summary.activeEffects);
      }
    }
  }

  const interpreted = interpretPassiveEffects(effects, document.ruleset ?? sources.background?.ruleset ?? sources.class?.ruleset ?? '2024');
  return { contributions: interpreted.contributions, diagnostics: [...diagnostics, ...interpreted.diagnostics] };
}

function sourceKey(source: FoundrySourceReference): string { return `${source.sourcePath}:${source.pack}:${source.type}:${source.id}`; }
