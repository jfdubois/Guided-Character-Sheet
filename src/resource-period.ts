import type { FoundryUsesSummary } from './foundry-activity-summary';

export type MutableReset = 'none' | 'short-rest' | 'long-rest';

/** Normalize only recovery periods supported by the pinned Foundry source. */
export function mutableResetForPeriod(period: string): MutableReset | undefined {
  if (period === 'sr' || period === 'shortRest' || period === 'short-rest') return 'short-rest';
  if (period === 'lr' || period === 'longRest' || period === 'long-rest') return 'long-rest';
  if (period === 'none') return 'none';
  return undefined;
}

export function mutableResetForRecovery(recovery: Array<{ period: string }>): MutableReset | undefined {
  if (recovery.length === 0) return 'none';
  const values = recovery.map((entry) => mutableResetForPeriod(entry.period));
  return values.some((value) => value === undefined) ? undefined : values.find((value) => value !== 'none') ?? 'none';
}

/** Return a rest reset only when source uses can represent a mutable resource. */
export function recoverableResetForUses(uses: FoundryUsesSummary | undefined): Exclude<MutableReset, 'none'> | undefined {
  if (uses === undefined) return undefined;
  const maximum = uses.maximum;
  const hasUsableMaximum = typeof maximum === 'number'
    ? Number.isInteger(maximum) && maximum >= 0
    : typeof maximum === 'string'
      && maximum === maximum.trim()
      && (/^\d+$/.test(maximum) || maximum === '@prof' || /^@scale\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(maximum));
  if (!hasUsableMaximum) return undefined;
  const reset = mutableResetForRecovery(uses.recovery);
  return reset === 'short-rest' || reset === 'long-rest' ? reset : undefined;
}
