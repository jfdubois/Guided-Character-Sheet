import { effectiveHitPointMaximum, type CharacterResource, type CharacterSpellUse, type MutableCharacterState } from './mutable-character-state';
import { recoverForRest } from './rest-recovery';

export interface LongRestSummary {
  hitPointsRestored: number;
  temporaryHitPointsCleared: number;
  hitDiceRestored: number;
  spellSlotLevelsRestored: number;
  spellUsesRestored: number;
  resourcesRestored: number;
  skippedRecoveryKeys: string[];
  changed: boolean;
}

export interface LongRestResult { state: MutableCharacterState; summary: LongRestSummary; }

/** Applies only the stable mutable-state effects supported by the pinned long-rest contract. */
export function applyLongRest(state: MutableCharacterState): LongRestResult {
  let changed = false;
  let hitPointsRestored = 0;
  let temporaryHitPointsCleared = 0;
  let hitDiceRestored = 0;
  let spellSlotLevelsRestored = 0;
  let spellUsesRestored = 0;
  let resourcesRestored = 0;
  const skippedRecoveryKeys: string[] = [];

  const hitPoints = state.hitPoints === undefined ? undefined : (() => {
    const maximum = effectiveHitPointMaximum(state.hitPoints!);
    const temporary = state.hitPoints!.temporary ?? 0;
    hitPointsRestored = Math.max(0, maximum - state.hitPoints!.current);
    temporaryHitPointsCleared = temporary;
    if (hitPointsRestored > 0 || temporary > 0) changed = true;
    return { ...state.hitPoints!, current: maximum, temporary: 0 };
  })();

  const hitDice = state.hitDice?.map((pool) => {
    hitDiceRestored += pool.maximum - pool.current;
    if (pool.current !== pool.maximum) changed = true;
    return { ...pool, current: pool.maximum };
  });

  const spellSlots = state.spellSlots?.map((slot) => {
    if (slot.recovery !== undefined && !slot.recovery.includes('long-rest')) return { ...slot, recovery: [...slot.recovery] };
    if (slot.current === slot.maximum) return { ...slot };
    changed = true;
    spellSlotLevelsRestored += 1;
    return { ...slot, current: slot.maximum };
  });

  const restore = <T extends CharacterResource | CharacterSpellUse>(entry: T): T => {
    const recovered = recoverForRest(entry, ['long-rest', 'short-rest']);
    if (recovered.unsupported) skippedRecoveryKeys.push(entry.key);
    if (recovered.changed) changed = true;
    return recovered.entry;
  };

  const spellUses = state.spellUses?.map((use) => {
    const next = restore(use);
    if (next.current !== use.current) spellUsesRestored += 1;
    return next;
  });
  const resources = state.resources.map((resource) => {
    const next = restore(resource);
    if (next.current !== resource.current) resourcesRestored += 1;
    return next;
  });

  const next = changed ? {
    ...state,
    ...(hitPoints === undefined ? {} : { hitPoints }),
    ...(hitDice === undefined ? {} : { hitDice }),
    ...(spellSlots === undefined ? {} : { spellSlots }),
    ...(spellUses === undefined ? {} : { spellUses }),
    resources,
  } : state;
  return { state: next, summary: { hitPointsRestored, temporaryHitPointsCleared, hitDiceRestored, spellSlotLevelsRestored, spellUsesRestored, resourcesRestored, skippedRecoveryKeys, changed } };
}
