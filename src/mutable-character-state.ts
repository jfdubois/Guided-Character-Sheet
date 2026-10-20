import type { FoundrySourceReference } from './foundry-source-catalog';
import { isCharacterInventory, type CharacterInventory } from './inventory';
import { isFoundrySourceReference, isSafeSourcePath } from './foundry-source-reference';
import type { MutableRecoveryProfile, MutableReset } from './resource-period';

export interface EquipmentStatus { entryId: string; equipped: boolean; attuned: boolean; }
export interface CharacterResource { key: string; current: number; maximum: number; reset: 'none' | 'short-rest' | 'long-rest'; recovery?: MutableRecoveryProfile[]; }
export type CharacterSpellSlotKind = 'spell' | 'pact';
export type CharacterRestPeriod = 'short-rest' | 'long-rest';
export interface CharacterSpellSlot { key?: string; kind?: CharacterSpellSlotKind; level: number; current: number; maximum: number; recovery?: CharacterRestPeriod[]; }
export interface CharacterHitDicePool { classSourcePath: string; denomination: string; current: number; maximum: number; }
export interface CharacterSpellUse { key: string; current: number; maximum: number; reset: MutableReset; recovery?: MutableRecoveryProfile[]; }
export type MutableSpellOwnership = 'cantrips-known' | 'known-spells' | 'spellbook';
export interface MutableSpellOverlayEntry { reference: FoundrySourceReference; ownership: MutableSpellOwnership; }
export interface MutableSpellOverlay { added: MutableSpellOverlayEntry[]; removed: FoundrySourceReference[]; }
/** Temporary HP and the effective-maximum override are optional for older character files. */
export interface MutableHitPoints { current: number; maximum: number; temporary?: number; maximumOverride?: number; }
export interface MutableCharacterState {
  preparedSpells: FoundrySourceReference[];
  inventory: CharacterInventory;
  equipmentStatus: EquipmentStatus[];
  resources: CharacterResource[];
  hitPoints?: MutableHitPoints;
  hitDice?: CharacterHitDicePool[];
  inspiration?: boolean;
  spellSlots?: CharacterSpellSlot[];
  spellUses?: CharacterSpellUse[];
  /** Optional post-creation changes to source-owned spell lists. */
  spellOverlay?: MutableSpellOverlay;
}

export interface FinalizedMutableStateOptions {
  ruleset?: '2014' | '2024';
  classSourcePath: string;
  classHitDie: string;
  constitutionModifier: number;
  spellSlots: Array<{ key?: string; kind?: CharacterSpellSlotKind; level: number; maximum: number; recovery?: CharacterRestPeriod[] }>;
  spellUses?: CharacterSpellUse[];
  resources?: CharacterResource[];
  characterLevel?: number;
  permanentHitPointModifiers?: Array<{ perLevel: number; sourcePath: string }>;
}

/** Adjust a tracked resource without allowing it outside its authoritative bounds. */
export function adjustMutableResourceCurrent(current: number, maximum: number, delta: number): number {
  if (!Number.isInteger(current) || !Number.isInteger(maximum) || maximum < 0 || current < 0 || current > maximum || !Number.isInteger(delta)) throw new Error('Invalid mutable resource adjustment.');
  return Math.max(0, Math.min(maximum, current + delta));
}

export type HitPointAdjustment = 'heal' | 'damage' | 'temp' | 'maximum' | 'clear-maximum';

export function effectiveHitPointMaximum(state: MutableHitPoints): number { return state.maximumOverride ?? state.maximum; }

export function adjustHitPoints(state: MutableHitPoints, operation: HitPointAdjustment, amount: number): MutableHitPoints & { temporary: number } {
  if (!isNonNegativeInteger(amount) || !isValidHitPoints(state)) throw new Error('Invalid hit-point adjustment.');
  const temporary = state.temporary ?? 0;
  if (operation === 'heal') return { ...state, temporary, current: Math.min(effectiveHitPointMaximum(state), state.current + amount) };
  if (operation === 'damage') {
    const temporaryDamage = Math.min(temporary, amount);
    return { ...state, temporary: temporary - temporaryDamage, current: Math.max(0, state.current - (amount - temporaryDamage)) };
  }
  if (operation === 'temp') return { ...state, temporary: amount };
  if (operation === 'maximum') {
    return { ...state, maximumOverride: amount, temporary, current: Math.min(state.current, amount) };
  }
  if (operation === 'clear-maximum') {
    const { maximumOverride: _maximumOverride, ...base } = state;
    return { ...base, temporary, current: Math.min(state.current, state.maximum) };
  }
  throw new Error('Invalid hit-point adjustment.');
}

export function createInitialMutableCharacterState(inventory: CharacterInventory): MutableCharacterState {
  const result: MutableCharacterState = {
    preparedSpells: [],
    inventory: structuredClone(inventory),
    equipmentStatus: inventory.items.map((item) => ({ entryId: item.entryId, equipped: false, attuned: false })),
    resources: [],
  };
  if (!isMutableCharacterState(result)) throw new Error('Invalid initial mutable character state.');
  return result;
}

/** Build the complete character-owned state written by the finalization handoff. */
export function createFinalizedMutableCharacterState(inventory: CharacterInventory, options: FinalizedMutableStateOptions): MutableCharacterState {
  const hitDie = /^d(\d+)$/.exec(options.classHitDie.trim());
  const dieMaximum = hitDie?.[1] === undefined ? undefined : Number(hitDie[1]);
  if (dieMaximum === undefined || !Number.isInteger(dieMaximum) || dieMaximum < 1) throw new Error(`Unable to determine class hit die from ${options.classSourcePath}.`);
  if (!Number.isInteger(options.constitutionModifier)) throw new Error('Unable to determine Constitution modifier for hit points.');
  const characterLevel = options.characterLevel ?? 1;
  if (!Number.isInteger(characterLevel) || characterLevel < 1) throw new Error('Invalid character level for hit points.');
  const permanentHitPointModifiers = options.permanentHitPointModifiers ?? [];
  if (new Set(permanentHitPointModifiers.map((modifier) => modifier.sourcePath)).size !== permanentHitPointModifiers.length) throw new Error('Duplicate permanent hit-point modifier sources.');
  const permanentBonus = permanentHitPointModifiers.reduce((total, modifier) => {
    if (!Number.isInteger(modifier.perLevel) || modifier.perLevel < 0 || modifier.sourcePath.trim().length === 0) throw new Error('Invalid permanent hit-point modifier.');
    return total + modifier.perLevel * characterLevel;
  }, 0);
  const maximumHitPoints = dieMaximum + options.constitutionModifier + permanentBonus;
  if (maximumHitPoints < 1) throw new Error('Calculated maximum hit points must be positive.');
  const spellSlots = options.spellSlots.map((slot) => {
    if (!Number.isInteger(slot.level) || slot.level < 1 || !Number.isInteger(slot.maximum) || slot.maximum < 0) throw new Error('Invalid authoritative spell-slot progression.');
    return { ...(slot.key === undefined ? {} : { key: slot.key }), ...(slot.kind === undefined ? {} : { kind: slot.kind }), level: slot.level, current: slot.maximum, maximum: slot.maximum, ...(slot.recovery === undefined ? {} : { recovery: [...slot.recovery] }) };
  });
  if (hasDuplicateSpellSlots(spellSlots)) throw new Error('Duplicate authoritative spell slots.');
  const result: MutableCharacterState = {
    ...createInitialMutableCharacterState(inventory),
    hitPoints: { current: maximumHitPoints, maximum: maximumHitPoints, temporary: 0 },
    ...(options.ruleset === '2024' ? { hitDice: [{ classSourcePath: options.classSourcePath, denomination: options.classHitDie.trim(), current: characterLevel, maximum: characterLevel }] } : {}),
    inspiration: false,
    spellSlots,
    spellUses: [...(options.spellUses ?? [])],
    resources: [...(options.resources ?? [])],
  };
  if (!isMutableCharacterState(result)) throw new Error('Invalid finalized mutable character state.');
  return result;
}

export function isMutableCharacterState(value: unknown): value is MutableCharacterState {
  if (!isRecord(value) || !Array.isArray(value.preparedSpells) || !value.preparedSpells.every((entry) => isFoundrySourceReference(entry) && entry.type === 'spell') || !isCharacterInventory(value.inventory) || !Array.isArray(value.equipmentStatus) || !value.equipmentStatus.every(isEquipmentStatus) || !Array.isArray(value.resources) || !value.resources.every(isCharacterResource)) return false;
  if (value.hitPoints !== undefined && (!isRecord(value.hitPoints) || !isNonNegativeInteger(value.hitPoints.current) || !isNonNegativeInteger(value.hitPoints.maximum) || value.hitPoints.maximum < 1 || value.hitPoints.maximumOverride !== undefined && !isNonNegativeInteger(value.hitPoints.maximumOverride) || value.hitPoints.current > (typeof value.hitPoints.maximumOverride === 'number' ? value.hitPoints.maximumOverride : value.hitPoints.maximum) || value.hitPoints.temporary !== undefined && !isNonNegativeInteger(value.hitPoints.temporary))) return false;
  if (value.hitDice !== undefined && (!Array.isArray(value.hitDice) || !value.hitDice.every(isCharacterHitDicePool) || new Set(value.hitDice.map((pool) => pool.classSourcePath)).size !== value.hitDice.length)) return false;
  if (value.inspiration !== undefined && typeof value.inspiration !== 'boolean') return false;
  if (value.spellSlots !== undefined && (!Array.isArray(value.spellSlots) || !value.spellSlots.every(isCharacterSpellSlot) || hasDuplicateSpellSlots(value.spellSlots))) return false;
  if (value.spellUses !== undefined && (!Array.isArray(value.spellUses) || !value.spellUses.every(isCharacterSpellUse) || new Set(value.spellUses.map((use) => use.key)).size !== value.spellUses.length)) return false;
  if (value.spellOverlay !== undefined && !isMutableSpellOverlay(value.spellOverlay)) return false;
  if (new Set(value.resources.map((resource) => resource.key)).size !== value.resources.length) return false;
  return true;
}

function isMutableSpellOverlay(value: unknown): value is MutableSpellOverlay {
  if (!isRecord(value) || !Array.isArray(value.added) || !Array.isArray(value.removed)) return false;
  if (!value.added.every((entry) => isRecord(entry) && isFoundrySourceReference(entry.reference) && entry.reference.type === 'spell' && isMutableSpellOwnership(entry.ownership))) return false;
  if (!value.removed.every((reference) => isFoundrySourceReference(reference) && reference.type === 'spell')) return false;
  const addedKeys = value.added.map((entry) => referenceKey(entry.reference));
  const removedKeys = value.removed.map(referenceKey);
  return new Set(addedKeys).size === addedKeys.length && new Set(removedKeys).size === removedKeys.length && !addedKeys.some((key) => removedKeys.includes(key));
}
function isMutableSpellOwnership(value: unknown): value is MutableSpellOwnership { return value === 'cantrips-known' || value === 'known-spells' || value === 'spellbook'; }
function referenceKey(reference: FoundrySourceReference): string { return `${reference.sourcePath}:${reference.pack}:${reference.type}:${reference.id}`; }

function isEquipmentStatus(value: unknown): value is EquipmentStatus { return isRecord(value) && typeof value.entryId === 'string' && value.entryId.length > 0 && typeof value.equipped === 'boolean' && typeof value.attuned === 'boolean'; }
function isCharacterResource(value: unknown): value is CharacterResource { return isRecord(value) && typeof value.key === 'string' && value.key.length > 0 && isNonNegativeInteger(value.current) && isNonNegativeInteger(value.maximum) && value.current <= value.maximum && (value.reset === 'none' || value.reset === 'short-rest' || value.reset === 'long-rest') && isOptionalRecoveryProfiles(value.recovery); }
function isCharacterHitDicePool(value: unknown): value is CharacterHitDicePool { return isRecord(value) && typeof value.classSourcePath === 'string' && isSafeSourcePath(value.classSourcePath) && /^d(?:4|6|8|10|12)$/.test(String(value.denomination)) && isNonNegativeInteger(value.current) && isNonNegativeInteger(value.maximum) && value.maximum >= 1 && value.current <= value.maximum; }
function isCharacterSpellSlot(value: unknown): value is CharacterSpellSlot { return isRecord(value) && (value.key === undefined || typeof value.key === 'string' && value.key.trim().length > 0) && (value.kind === undefined || value.kind === 'spell' || value.kind === 'pact') && isNonNegativeInteger(value.level) && value.level >= 1 && isNonNegativeInteger(value.current) && isNonNegativeInteger(value.maximum) && value.current <= value.maximum && (value.recovery === undefined || Array.isArray(value.recovery) && value.recovery.length > 0 && value.recovery.every((period) => period === 'short-rest' || period === 'long-rest') && new Set(value.recovery).size === value.recovery.length); }
function hasDuplicateSpellSlots(slots: CharacterSpellSlot[]): boolean {
  const identities = slots.map((slot) => slot.key ?? `legacy-level:${slot.level}`);
  return new Set(identities).size !== identities.length;
}
function isCharacterSpellUse(value: unknown): value is CharacterSpellUse { return isRecord(value) && typeof value.key === 'string' && value.key.length > 0 && isNonNegativeInteger(value.current) && isNonNegativeInteger(value.maximum) && value.current <= value.maximum && (value.reset === 'none' || value.reset === 'short-rest' || value.reset === 'long-rest') && isOptionalRecoveryProfiles(value.recovery); }
function isOptionalRecoveryProfiles(value: unknown): value is MutableRecoveryProfile[] | undefined {
  return value === undefined || Array.isArray(value) && value.every((profile) => isRecord(profile)
    && (profile.period === 'short-rest' || profile.period === 'long-rest')
    && (profile.type === 'recover-all' && profile.formula === undefined || profile.type === 'formula' && typeof profile.formula === 'string' && profile.formula.trim() === profile.formula && profile.formula.length > 0));
}
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
function isValidHitPoints(value: MutableHitPoints): boolean { return isNonNegativeInteger(value.current) && isNonNegativeInteger(value.maximum) && value.maximum >= 1 && (value.maximumOverride === undefined || isNonNegativeInteger(value.maximumOverride)) && value.current <= effectiveHitPointMaximum(value) && (value.temporary === undefined || isNonNegativeInteger(value.temporary)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
