import { ABILITIES, type Ability, type AbilityRecord } from './ability-scores';
import type { BackgroundSourceSummary } from './character-sources';

export interface BackgroundAbilitySelection {
  advancementId: string;
  assignments: Partial<Record<Ability, number>>;
}

export type BackgroundAbilityConfiguration =
  | { kind: 'none' }
  | { kind: 'unsupported'; reason: string }
  | BackgroundAbilityChoiceConfiguration;

export interface BackgroundAbilityChoiceConfiguration {
  kind: 'choice';
  advancementId: string;
  points: number;
  cap: number;
  eligibleAbilities: Ability[];
  fixed: Partial<Record<Ability, number>>;
}

const ABILITY_LABELS: Record<Ability, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

export function buildBackgroundAbilityConfiguration(summary: BackgroundSourceSummary): BackgroundAbilityConfiguration {
  const abilityScores = summary.abilityScores;
  if (abilityScores === undefined || abilityScores.points === undefined) return { kind: 'none' };
  if (!abilityScores.advancementId) return { kind: 'unsupported', reason: 'Background ability advancement identity is unavailable.' };
  if (!Number.isInteger(abilityScores.points) || abilityScores.points <= 0) return { kind: 'unsupported', reason: 'Background ability point total is invalid.' };
  const cap = abilityScores.cap;
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap <= 0) return { kind: 'unsupported', reason: 'Background ability increase cap is invalid.' };
  const locked = new Set(abilityScores.locked ?? []);
  const eligibleAbilities = ABILITIES.filter((ability) => !locked.has(ability));
  const fixed = Object.fromEntries(Object.entries(abilityScores.fixed ?? {}).filter(([ability, value]) => isAbility(ability) && typeof value === 'number' && Number.isFinite(value))) as Partial<Record<Ability, number>>;
  if (abilityScores.points !== 3 || cap !== 2 || eligibleAbilities.length < 3) {
    return { kind: 'unsupported', reason: 'Background ability choice shape is unsupported by the creation controls. Expected 3 points, a cap of 2, and at least 3 eligible abilities.' };
  }
  return { kind: 'choice', advancementId: abilityScores.advancementId, points: abilityScores.points, cap, eligibleAbilities, fixed };
}

export function validateBackgroundAbilitySelection(configuration: BackgroundAbilityConfiguration, selection: BackgroundAbilitySelection, preBackgroundScores?: AbilityRecord): string[] {
  if (configuration.kind === 'none') return ['This background has no ability score improvement choice.'];
  if (configuration.kind === 'unsupported') return [configuration.reason];
  const errors: string[] = [];
  if (selection.advancementId !== configuration.advancementId) errors.push('Background ability advancement does not match the current source.');
  const eligible = new Set(configuration.eligibleAbilities);
  let total = 0;
  for (const [rawAbility, value] of Object.entries(selection.assignments)) {
    if (!isAbility(rawAbility)) { errors.push(`${rawAbility} is not a recognized ability.`); continue; }
    const ability = rawAbility as Ability;
    if (!eligible.has(ability)) errors.push(`${ABILITY_LABELS[ability]} is not eligible for this background.`);
    if (!Number.isInteger(value) || value < 0) { errors.push(`${ABILITY_LABELS[ability]} increase must be a non-negative whole number.`); continue; }
    if (value > configuration.cap) errors.push(`${ABILITY_LABELS[ability]} exceeds the background increase cap of ${configuration.cap}.`);
    total += value;
  }
  if (total !== configuration.points) errors.push(`Background ability increases must allocate exactly ${configuration.points} points.`);
  if (preBackgroundScores !== undefined) for (const ability of ABILITIES) {
    const fixed = configuration.fixed[ability] ?? 0;
    const selected = selection.assignments[ability] ?? 0;
    if (typeof fixed === 'number' && typeof selected === 'number' && fixed + selected > 0 && (preBackgroundScores[ability] ?? 0) + fixed + selected > 20) errors.push(`${ABILITY_LABELS[ability]} cannot be increased above 20.`);
  }
  return errors;
}

export function createBackgroundAbilitySelection(configuration: BackgroundAbilityChoiceConfiguration, assignments: Partial<Record<Ability, number>>, preBackgroundScores?: AbilityRecord): BackgroundAbilitySelection {
  const selection: BackgroundAbilitySelection = { advancementId: configuration.advancementId, assignments };
  const error = validateBackgroundAbilitySelection(configuration, selection, preBackgroundScores)[0];
  if (error) throw new Error(error);
  return { advancementId: configuration.advancementId, assignments: Object.fromEntries(Object.entries(assignments).filter(([, value]) => value !== 0)) as Partial<Record<Ability, number>> };
}

function isAbility(value: string): value is Ability { return (ABILITIES as readonly string[]).includes(value); }
