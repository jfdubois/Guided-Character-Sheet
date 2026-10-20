import type { CharacterResource, CharacterSpellUse } from './mutable-character-state';
import type { MutableRecoveryProfile } from './resource-period';

export type RecoverableEntry = CharacterResource | CharacterSpellUse;
export type RecoveryPeriod = MutableRecoveryProfile['period'];

export interface RestRecoveryResult<T extends RecoverableEntry> {
  entry: T;
  changed: boolean;
  unsupported: boolean;
}

/** Applies the first matching recovery profile in the supplied rest-period order. */
export function recoverForRest<T extends RecoverableEntry>(entry: T, periods: RecoveryPeriod[]): RestRecoveryResult<T> {
  const profiles = entry.recovery ?? legacyRecovery(entry.reset);
  const profile = periods.flatMap((period) => profiles.filter((candidate) => candidate.period === period)).at(0);
  const clone = { ...entry, ...(entry.recovery === undefined ? {} : { recovery: entry.recovery.map((candidate) => ({ ...candidate })) }) } as T;
  if (profile === undefined) return { entry: clone, changed: false, unsupported: false };
  const recovered = recoveredCurrent(entry, profile);
  if (recovered === undefined) return { entry: clone, changed: false, unsupported: profile.type === 'formula' };
  if (recovered === entry.current) return { entry: clone, changed: false, unsupported: false };
  return { entry: { ...clone, current: recovered }, changed: true, unsupported: false };
}

function recoveredCurrent(entry: RecoverableEntry, profile: MutableRecoveryProfile): number | undefined {
  if (profile.type === 'recover-all') return entry.maximum;
  const amount = profile.formula !== undefined && /^[1-9]\d*$/.test(profile.formula) ? Number(profile.formula) : undefined;
  return amount === undefined || !Number.isSafeInteger(amount) ? undefined : Math.min(entry.maximum, entry.current + amount);
}

function legacyRecovery(reset: RecoverableEntry['reset']): MutableRecoveryProfile[] {
  return reset === 'short-rest' || reset === 'long-rest' ? [{ period: reset, type: 'recover-all' }] : [];
}
