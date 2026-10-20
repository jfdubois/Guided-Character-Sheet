import type { CharacterDocument } from './character-model';
import type { ClassFeatureSummary, ClassScaleValueSummary, ClassSourceSummary, FoundrySourceReference } from './character-sources';
import type { ClassAdvancementSelection, ClassProgressionSelection } from './class-configuration';

interface ClassEntitlement {
  level: number;
  requiresChoice?: { key: string; value: string };
  classRestriction?: string;
}

/** Applies class level, primary-class restriction, and owning choice provenance. */
export function isClassEntitlementEligible(progression: ClassProgressionSelection | undefined, entitlement: ClassEntitlement): boolean {
  if (progression === undefined || entitlement.level > progression.targetLevel) return false;
  if (entitlement.classRestriction !== undefined && entitlement.classRestriction !== 'primary') return false;
  if (entitlement.requiresChoice === undefined) return true;
  const advancementId = entitlement.requiresChoice.key.replace(/^class:/, '');
  const selection = progression.selections.find((candidate) => candidate.advancementId === advancementId);
  return selection !== undefined && selectionContains(selection, entitlement.requiresChoice.value);
}

export function getEligibleClassFeatures(document: CharacterDocument, summary: ClassSourceSummary | undefined): ClassFeatureSummary[] {
  const progression = classProgression(document, summary);
  return (summary?.features ?? []).filter((feature) => isClassEntitlementEligible(progression, feature));
}

export function getEligibleClassScales(document: CharacterDocument, summary: ClassSourceSummary | undefined): ClassScaleValueSummary[] {
  const progression = classProgression(document, summary);
  return (summary?.scales ?? []).filter((scale) => isClassEntitlementEligible(progression, scale));
}

function classProgression(document: CharacterDocument, summary: ClassSourceSummary | undefined): ClassProgressionSelection | undefined {
  if (summary === undefined) return undefined;
  return document.classProgressions?.find((progression) => progression.class.sourcePath === summary.source.sourcePath);
}

function selectionContains(selection: ClassAdvancementSelection, required: string): boolean {
  const requiredId = required.startsWith('Compendium.') ? required.split('.').at(-1) : required;
  if (selection.kind === 'item') return selection.selected.some((source) => matchesReference(source, required, requiredId));
  if (selection.kind === 'subclass') return selection.selected !== undefined && matchesReference(selection.selected, required, requiredId);
  if (selection.kind === 'ability-score') return selection.feat !== undefined && matchesReference(selection.feat, required, requiredId);
  if (selection.kind === 'trait' || selection.kind === 'expertise') return selection.selected.some((value) => value === required || value === requiredId);
  return selection.selected.some((source) => matchesReference(source, required, requiredId));
}

function matchesReference(source: FoundrySourceReference, required: string, requiredId: string | undefined): boolean {
  return source.id === required || requiredId !== undefined && source.id === requiredId
    || `Compendium.${source.pack}.Item.${source.id}` === required
    || `Compendium.${source.pack}.${source.id}` === required;
}
