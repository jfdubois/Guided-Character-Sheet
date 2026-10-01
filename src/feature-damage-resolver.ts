import type { ClassScaleValueSummary, SpeciesScaleValueSummary } from './character-sources';
import type { FoundryDamagePartSummary } from './foundry-activity-summary';
import type { FoundryScaleValue } from './foundry-scale-value';
import { evaluateScaleAtLevel } from './level-one-progression';

export interface FeatureDamageResolutionContext {
  classIdentifier?: string;
  speciesIdentifier?: string;
  targetLevel: number;
  scales?: ClassScaleValueSummary[];
  speciesScales?: SpeciesScaleValueSummary[];
}

export interface FeatureDamageResolution {
  damage?: string;
  diagnostic?: string;
}

export interface FeatureScaleResolution {
  value?: FoundryScaleValue;
  diagnostic?: string;
}

const INHERITED_DAMAGE_TYPES = new Set([
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]);

function specificDamageTypes(types: string[]): string[] {
  if (types.length === INHERITED_DAMAGE_TYPES.size && new Set(types).size === INHERITED_DAMAGE_TYPES.size
    && types.every((type) => INHERITED_DAMAGE_TYPES.has(type))) return [];
  return types;
}

export function resolveFeatureDamagePart(part: FoundryDamagePartSummary, context: FeatureDamageResolutionContext): FeatureDamageResolution {
  const formula = part.customFormula;
  if (formula === undefined) return {};
  const resolved = resolveFeatureScaleLookup(formula, context);
  if (resolved.value === undefined) return { diagnostic: resolved.diagnostic?.startsWith('Unsupported custom damage formula:') === true ? resolved.diagnostic : `Cannot resolve custom damage formula ${formula}: ${resolved.diagnostic ?? 'scale value is unavailable.'}` };
  const value = resolved.value;
  const damage = value.type === 'number' ? String(value.value)
    : value.type === 'dice' ? `${value.number === null ? '' : value.number}d${value.faces}${value.modifiers.join('')}`
      : undefined;
  if (damage !== undefined) {
    const types = specificDamageTypes(part.types);
    return { damage: `${damage}${types.length > 0 ? ` ${types.join(', ')}` : ''}` };
  }
  return { diagnostic: `Cannot resolve custom damage formula ${formula}: distance scales cannot be used as damage.` };
}

/** Resolves only a bare class or species scale reference against its owner. */
export function resolveFeatureScaleLookup(reference: string, context: FeatureDamageResolutionContext): FeatureScaleResolution {
  const match = /^@scale\.([^.\s]+)\.([^.\s]+)$/.exec(reference);
  if (match === null) return { diagnostic: `Unsupported custom damage formula: ${reference}` };

  const [, owner, identifier] = match;
  const speciesOwner = owner === context.speciesIdentifier && (context.speciesScales ?? []).some((candidate) => candidate.identifier === identifier);
  const classOwner = owner === context.classIdentifier && (context.scales ?? []).some((candidate) => candidate.identifier === identifier);
  if (!speciesOwner && !classOwner) return { diagnostic: 'scale owner does not match the selected class or species.' };
  const scales = speciesOwner ? context.speciesScales ?? [] : context.scales ?? [];
  const scale = scales.find((candidate) => candidate.identifier === identifier);
  if (scale === undefined) return { diagnostic: `${speciesOwner ? 'species' : 'class'} scale ${identifier} is unavailable.` };

  const value = evaluateScaleAtLevel(scale.values, context.targetLevel);
  return value === undefined ? { diagnostic: `${speciesOwner ? 'species' : 'class'} scale ${identifier} has no value at level ${context.targetLevel}.` } : { value };
}
