import type { LevelOneSpellSlot } from './level-one-progression';
import type { CharacterResource, CharacterSpellSlot, CharacterSpellUse, MutableCharacterState } from './mutable-character-state';

export interface LevelOne2024RestSource {
  classSourcePath: string;
  classHitDie: string;
  characterLevel: 1;
  spellSlots: LevelOneSpellSlot[];
  resources?: CharacterResource[];
  spellUses?: CharacterSpellUse[];
}

export interface RestStateCompatibilityResult {
  state: MutableCharacterState;
  hitDiceInitialized: boolean;
  spellSlotsInitialized: number;
  spellSlotsEnriched: number;
  resourcesInitialized: number;
  resourcesEnriched: number;
  resourcesRemoved: number;
  spellUsesInitialized: number;
  spellUsesEnriched: number;
  spellUsesRemoved: number;
  updateCount: number;
  changed: boolean;
}

/**
 * Projects newly supported rest state from an already selected authoritative
 * level-one 2024 class. Callers must validate that the source still matches
 * the latest character document before persisting the result.
 */
export function applyLevelOne2024RestCompatibility(state: MutableCharacterState, source: LevelOne2024RestSource): RestStateCompatibilityResult {
  if (source.classSourcePath.trim().length === 0 || !/^d(?:4|6|8|10|12)$/.test(source.classHitDie)) throw new Error('Invalid authoritative class rest source.');
  let changed = false;
  let hitDiceInitialized = false;
  let spellSlotsInitialized = 0;
  let spellSlotsEnriched = 0;

  const hitDice = state.hitDice === undefined ? (() => {
    changed = true;
    hitDiceInitialized = true;
    return [{ classSourcePath: source.classSourcePath, denomination: source.classHitDie, current: source.characterLevel, maximum: source.characterLevel }];
  })() : state.hitDice.map((pool) => ({ ...pool }));

  const spellSlots = (state.spellSlots ?? []).map((slot) => cloneSlot(slot));
  for (const authoritative of source.spellSlots) {
    const existingIndex = spellSlots.findIndex((slot) => slot.key === authoritative.key
      || slot.key === undefined && slot.level === authoritative.level && slot.maximum === authoritative.maximum);
    if (existingIndex < 0) {
      spellSlots.push({ ...authoritative, current: authoritative.maximum, recovery: [...authoritative.recovery] });
      spellSlotsInitialized += 1;
      changed = true;
      continue;
    }
    const existing = spellSlots[existingIndex]!;
    if (existing.maximum !== authoritative.maximum) continue;
    const enriched: CharacterSpellSlot = {
      ...existing,
      key: existing.key ?? authoritative.key,
      kind: existing.kind ?? authoritative.kind,
      recovery: existing.recovery === undefined ? [...authoritative.recovery] : [...existing.recovery],
    };
    if (existing.key === undefined || existing.kind === undefined || existing.recovery === undefined) {
      spellSlots[existingIndex] = enriched;
      spellSlotsEnriched += 1;
      changed = true;
    }
  }

  const resourceResult = source.resources === undefined ? undefined : reconcileEntries(state.resources, source.resources);
  const spellUseResult = source.spellUses === undefined ? undefined : reconcileEntries(state.spellUses ?? [], source.spellUses);
  if (resourceResult?.changed || spellUseResult?.changed) changed = true;
  const resourcesInitialized = resourceResult?.initialized ?? 0;
  const resourcesEnriched = resourceResult?.enriched ?? 0;
  const resourcesRemoved = resourceResult?.removed ?? 0;
  const spellUsesInitialized = spellUseResult?.initialized ?? 0;
  const spellUsesEnriched = spellUseResult?.enriched ?? 0;
  const spellUsesRemoved = spellUseResult?.removed ?? 0;
  const updateCount = (hitDiceInitialized ? 1 : 0) + spellSlotsInitialized + spellSlotsEnriched
    + resourcesInitialized + resourcesEnriched + resourcesRemoved
    + spellUsesInitialized + spellUsesEnriched + spellUsesRemoved;

  const next = changed ? {
    ...state,
    hitDice,
    spellSlots,
    ...(resourceResult === undefined ? {} : { resources: resourceResult.entries }),
    ...(spellUseResult === undefined ? {} : { spellUses: spellUseResult.entries }),
  } : state;
  return { state: next, hitDiceInitialized, spellSlotsInitialized, spellSlotsEnriched, resourcesInitialized, resourcesEnriched, resourcesRemoved, spellUsesInitialized, spellUsesEnriched, spellUsesRemoved, updateCount, changed };
}

function cloneSlot(slot: CharacterSpellSlot): CharacterSpellSlot {
  return { ...slot, ...(slot.recovery === undefined ? {} : { recovery: [...slot.recovery] }) };
}

function reconcileEntries<T extends CharacterResource | CharacterSpellUse>(existing: T[], authoritative: T[]): { entries: T[]; initialized: number; enriched: number; removed: number; changed: boolean } {
  const existingByKey = new Map(existing.map((entry) => [entry.key, entry]));
  let initialized = 0;
  let enriched = 0;
  const entries = authoritative.map((expected): T => {
    const current = existingByKey.get(expected.key);
    if (current === undefined) {
      initialized += 1;
      return cloneEntry(expected);
    }
    const reconciled = {
      ...expected,
      current: Math.min(current.current, expected.maximum),
      ...(expected.recovery === undefined ? {} : { recovery: expected.recovery.map((profile) => ({ ...profile })) }),
    } as T;
    if (!sameEntry(current, reconciled)) enriched += 1;
    return reconciled;
  });
  const authoritativeKeys = new Set(authoritative.map((entry) => entry.key));
  const removed = existing.filter((entry) => !authoritativeKeys.has(entry.key)).length;
  return { entries, initialized, enriched, removed, changed: initialized > 0 || enriched > 0 || removed > 0 };
}

function cloneEntry<T extends CharacterResource | CharacterSpellUse>(entry: T): T {
  return { ...entry, ...(entry.recovery === undefined ? {} : { recovery: entry.recovery.map((profile) => ({ ...profile })) }) };
}

function sameEntry(left: CharacterResource | CharacterSpellUse, right: CharacterResource | CharacterSpellUse): boolean {
  return left.key === right.key && left.current === right.current && left.maximum === right.maximum && left.reset === right.reset
    && JSON.stringify(left.recovery ?? []) === JSON.stringify(right.recovery ?? []);
}
