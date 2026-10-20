import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from './character-sources';
import type { ClassProgressionSelection } from './class-configuration';
import { buildBackgroundAbilityConfiguration, validateBackgroundAbilitySelection, type BackgroundAbilitySelection } from './background-ability-configuration';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = typeof ABILITIES[number];
export type AbilityScoreMethod = 'standard-array' | 'point-buy' | 'dice-rolling';
export type AbilityRecord = Record<Ability, number>;
export interface AbilityScoreSelection { method: AbilityScoreMethod; base: AbilityRecord; manual: AbilityRecord; rolls?: Partial<Record<Ability, number[]>>; }
export interface StandardArrayDraft { method: 'standard-array'; base: Partial<AbilityRecord>; manual: AbilityRecord; }
export interface RolledAbilityDraft { method: 'dice-rolling'; base: Partial<AbilityRecord>; manual: AbilityRecord; }
export interface PointBuyDraft { method: 'point-buy'; base: AbilityRecord; manual: AbilityRecord; }
export interface AbilityScoreResult { base: number; sourceBonus: number; manual: number; final: number; modifier: number; }
export type AbilityScoreResults = Record<Ability, AbilityScoreResult>;
export interface AbilityBonusSources { species: AbilityRecord; class: AbilityRecord; background: AbilityRecord; }
export interface AbilityScoreMethodOption { value: '' | AbilityScoreMethod; label: string; placeholder: boolean; }

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_COSTS: Readonly<Record<number, number>> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export function createDefaultAbilityScores(): AbilityScoreSelection {
  return { method: 'standard-array', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, manual: zeroAbilities() };
}

export function createStandardArrayDraft(): StandardArrayDraft {
  return { method: 'standard-array', base: {}, manual: zeroAbilities() };
}

export function createRolledAbilityDraft(): RolledAbilityDraft {
  return { method: 'dice-rolling', base: {}, manual: zeroAbilities() };
}

export function isValidRolledBase(value: number | undefined): boolean { return value !== undefined && Number.isInteger(value) && value >= 3 && value <= 18; }

export function moveStandardArrayValue(draft: StandardArrayDraft, ability: Ability, value: number | undefined): StandardArrayDraft {
  if (value !== undefined && !STANDARD_ARRAY.includes(value)) throw new Error('Invalid Standard Array value');
  const base = { ...draft.base };
  if (value !== undefined) for (const other of ABILITIES) if (other !== ability && base[other] === value) delete base[other];
  if (value === undefined) delete base[ability];
  else base[ability] = value;
  return { method: 'standard-array', base, manual: { ...draft.manual } };
}

export function createPointBuyAbilityScores(): PointBuyDraft {
  return { method: 'point-buy', base: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, manual: zeroAbilities() };
}

export function getAbilityScoreMethodOptions(selected?: AbilityScoreMethod): AbilityScoreMethodOption[] {
  const options: AbilityScoreMethodOption[] = [
    { value: '', label: 'Select an option', placeholder: true },
    { value: 'standard-array', label: 'Standard array', placeholder: false },
    { value: 'point-buy', label: 'Point buy', placeholder: false },
    { value: 'dice-rolling', label: 'Rolled scores (enter totals)', placeholder: false },
  ];
  return options.map((option) => ({ ...option, placeholder: option.value === '' ? selected === undefined : false }));
}

export function getAbilityModifier(score: number): number { return Math.floor((score - 10) / 2); }
export function scoreFromRolls(rolls: number[]): number { return rolls.length < 4 ? 0 : [...rolls].sort((a, b) => a - b).slice(1).reduce((total, value) => total + value, 0); }

export function calculateAbilityScores(selection: AbilityScoreSelection, sourceBonuses: AbilityRecord = zeroAbilities()): AbilityScoreResults {
  return Object.fromEntries(ABILITIES.map((ability) => {
    const base = selection.base[ability] ?? 0;
    const sourceBonus = sourceBonuses[ability] ?? 0;
    const manual = selection.manual[ability] ?? 0;
    const final = base + sourceBonus + manual;
    return [ability, { base, sourceBonus, manual, final, modifier: getAbilityModifier(final) }];
  })) as AbilityScoreResults;
}

export function validateAbilityScores(selection: AbilityScoreSelection): string[] {
  const errors: string[] = [];
  if (!['standard-array', 'point-buy', 'dice-rolling'].includes(selection.method)) errors.push('Choose a valid ability score method.');
  if (selection.method === 'standard-array' && !sameNumbers(ABILITIES.map((ability) => selection.base[ability]), STANDARD_ARRAY)) errors.push('Standard array values must be used exactly once.');
  if (selection.method === 'point-buy' && pointBuyTotal(selection.base) !== 27) errors.push('Point buy must use exactly 27 points.');
  for (const ability of ABILITIES) {
    const value = selection.base[ability];
    const manual = selection.manual[ability];
    if (!Number.isInteger(value) || value < 1) errors.push(`${ability.toUpperCase()} must have a valid base score.`);
    if (!Number.isInteger(manual)) errors.push(`${ability.toUpperCase()} manual adjustment must be a whole number.`);
  }
  return errors;
}

export function pointBuyTotal(scores: AbilityRecord): number {
  return ABILITIES.reduce((total, ability) => total + (POINT_BUY_COSTS[scores[ability]] ?? 999), 0);
}

export function pointBuyRemaining(scores: AbilityRecord): number { return 27 - pointBuyTotal(scores); }

export function canAffordPointBuyScore(scores: AbilityRecord, ability: Ability, value: number): boolean {
  const oldCost = POINT_BUY_COSTS[scores[ability]];
  const newCost = POINT_BUY_COSTS[value];
  if (oldCost === undefined || newCost === undefined) return false;
  return pointBuyTotal(scores) - oldCost + newCost <= 27;
}

export function collectAbilityBonuses(species: SpeciesSourceSummary | undefined, classSummary: ClassSourceSummary | undefined, progression: ClassProgressionSelection | undefined, background: BackgroundSourceSummary | undefined, backgroundSelection?: BackgroundAbilitySelection): AbilityBonusSources {
  const speciesBonuses = fixedBonuses(species?.advancements.map((entry) => entry.raw.configuration) ?? []);
  const eligibleClassAdvancements = classSummary?.advancements.filter((entry) => progression === undefined || entry.level <= progression.targetLevel) ?? [];
  const classBonuses = fixedBonuses(eligibleClassAdvancements.map((entry) => entry.raw.configuration));
  const eligibleClassAdvancementIds = new Set(eligibleClassAdvancements.map((entry) => entry.id));
  for (const selection of progression?.selections ?? []) {
    if (selection.kind === 'ability-score' && (classSummary === undefined || eligibleClassAdvancementIds.has(selection.advancementId))) for (const [ability, value] of Object.entries(selection.assignments)) if (isAbility(ability)) classBonuses[ability] += value;
  }
  const backgroundBonuses = fixedBonuses(background?.abilityScores ? [background.abilityScores] : []);
  if (background?.ruleset === '2024' && backgroundSelection !== undefined) {
    const configuration = buildBackgroundAbilityConfiguration(background);
    if (configuration.kind === 'choice' && validateBackgroundAbilitySelection(configuration, backgroundSelection).length === 0) {
      for (const [ability, value] of Object.entries(backgroundSelection.assignments)) if (isAbility(ability) && typeof value === 'number') backgroundBonuses[ability] += value;
    }
  }
  return { species: speciesBonuses, class: classBonuses, background: backgroundBonuses };
}

export function sumAbilityBonuses(sources: AbilityBonusSources): AbilityRecord {
  return Object.fromEntries(ABILITIES.map((ability) => [ability, sources.species[ability] + sources.class[ability] + sources.background[ability]])) as AbilityRecord;
}

export function zeroAbilities(): AbilityRecord { return { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }; }

function fixedBonuses(configurations: unknown[]): AbilityRecord {
  const result = zeroAbilities();
  for (const value of configurations) {
    const configuration = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    const fixed = configuration?.fixed;
    if (!fixed || typeof fixed !== 'object' || Array.isArray(fixed)) continue;
    for (const [ability, value] of Object.entries(fixed)) if (isAbility(ability) && typeof value === 'number' && Number.isFinite(value)) result[ability] += value;
  }
  return result;
}

function isAbility(value: string): value is Ability { return (ABILITIES as readonly string[]).includes(value); }
function sameNumbers(left: number[], right: number[]): boolean { return [...left].sort((a, b) => a - b).join(',') === [...right].sort((a, b) => a - b).join(','); }
