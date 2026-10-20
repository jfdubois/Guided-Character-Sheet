import { effectiveHitPointMaximum, type CharacterResource, type CharacterSpellUse, type MutableCharacterState } from './mutable-character-state';
import { recoverForRest } from './rest-recovery';

export interface ShortRestInput { hitDieClassSourcePath?: string; healing: number; }

export interface ShortRestSummary {
  hitDiceSpent: number;
  hitPointsRestored: number;
  spellSlotLevelsRestored: number;
  spellUsesRestored: number;
  resourcesRestored: number;
  skippedRecoveryKeys: string[];
  changed: boolean;
}

export interface ShortRestResult { state: MutableCharacterState; summary: ShortRestSummary; }

/** Applies only source-backed level-one 2024 Short Rest effects; dice are resolved by the user. */
export function applyShortRest(state: MutableCharacterState, input: ShortRestInput): ShortRestResult {
  if (state.hitPoints === undefined) throw new Error('Mutable hit-point state is unavailable.');
  if (state.hitPoints.current < 1) throw new Error('A Short Rest requires at least 1 hit point.');
  if (!Number.isInteger(input.healing) || input.healing < 0) throw new Error('Short Rest healing must be a non-negative whole number.');
  const spendingDie = input.hitDieClassSourcePath !== undefined;
  if (!spendingDie && input.healing !== 0) throw new Error('Healing requires spending a Hit Point Die.');
  const pool = spendingDie ? state.hitDice?.find((candidate) => candidate.classSourcePath === input.hitDieClassSourcePath) : undefined;
  if (spendingDie && (pool === undefined || pool.current < 1)) throw new Error('The selected Hit Point Die is unavailable.');
  if (spendingDie && input.healing < 1) throw new Error('A spent Hit Point Die requires a positive healing result.');

  let changed = false;
  const hitDice = state.hitDice?.map((candidate) => {
    if (candidate !== pool) return { ...candidate };
    changed = true;
    return { ...candidate, current: candidate.current - 1 };
  });
  const maximum = effectiveHitPointMaximum(state.hitPoints);
  const nextCurrent = Math.min(maximum, state.hitPoints.current + input.healing);
  const hitPointsRestored = nextCurrent - state.hitPoints.current;
  if (hitPointsRestored > 0) changed = true;
  const hitPoints = { ...state.hitPoints, current: nextCurrent };

  let spellSlotLevelsRestored = 0;
  const spellSlots = state.spellSlots?.map((slot) => {
    const clone = { ...slot, ...(slot.recovery === undefined ? {} : { recovery: [...slot.recovery] }) };
    if (!slot.recovery?.includes('short-rest') || slot.current === slot.maximum) return clone;
    changed = true;
    spellSlotLevelsRestored += 1;
    return { ...clone, current: slot.maximum };
  });

  const skippedRecoveryKeys: string[] = [];
  const restore = <T extends CharacterResource | CharacterSpellUse>(entry: T): T => {
    const recovered = recoverForRest(entry, ['short-rest']);
    if (recovered.unsupported) skippedRecoveryKeys.push(entry.key);
    if (recovered.changed) changed = true;
    return recovered.entry;
  };
  let spellUsesRestored = 0;
  const spellUses = state.spellUses?.map((use) => {
    const next = restore(use);
    if (next.current !== use.current) spellUsesRestored += 1;
    return next;
  });
  let resourcesRestored = 0;
  const resources = state.resources.map((resource) => {
    const next = restore(resource);
    if (next.current !== resource.current) resourcesRestored += 1;
    return next;
  });

  const next = changed ? { ...state, hitPoints, ...(hitDice === undefined ? {} : { hitDice }), ...(spellSlots === undefined ? {} : { spellSlots }), ...(spellUses === undefined ? {} : { spellUses }), resources } : state;
  return { state: next, summary: { hitDiceSpent: spendingDie ? 1 : 0, hitPointsRestored, spellSlotLevelsRestored, spellUsesRestored, resourcesRestored, skippedRecoveryKeys, changed } };
}
