export type ClassHitPointGain = 'max' | 'avg' | number;

export interface ClassHitPointEntry {
  classSourcePath: string;
  level: number;
  value: ClassHitPointGain;
}

/** Apply one explicit per-level gain choice to the draft ledger. */
export function setClassHitPointGain(entries: readonly ClassHitPointEntry[], classSourcePath: string, level: number, value: 'avg' | number | undefined): ClassHitPointEntry[] {
  const next = entries.filter((entry) => !(entry.classSourcePath === classSourcePath && entry.level === level)).map((entry) => ({ ...entry }));
  if (value !== undefined) next.push({ classSourcePath, level, value });
  return next.sort((left, right) => left.level - right.level);
}

/** Validate the recorded HP gains against one class's effective level sequence. */
export function validateClassHitPoints(
  entries: readonly ClassHitPointEntry[],
  classSourcePath: string,
  hitDie: string,
  targetLevel: number,
): string[] {
  const errors: string[] = [];
  const dieMaximum = parseHitDie(hitDie);
  if (classSourcePath.trim().length === 0) errors.push('Class source path is missing for hit points.');
  if (dieMaximum === undefined) errors.push(`Unable to determine class hit die from ${classSourcePath}.`);
  if (!Number.isInteger(targetLevel) || targetLevel < 1) errors.push('Invalid class target level for hit points.');

  const seenLevels = new Set<number>();
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry) || typeof entry.classSourcePath !== 'string' || !Number.isInteger(entry.level) || !isHitPointGain(entry.value)) {
      errors.push(`Malformed class hit-point entry at position ${index + 1}.`);
      continue;
    }
    if (entry.classSourcePath !== classSourcePath) errors.push(`Class hit-point entry at level ${entry.level} belongs to a different class.`);
    if (seenLevels.has(entry.level)) errors.push(`Duplicate class hit-point entry for level ${entry.level}.`);
    seenLevels.add(entry.level);
    if (entry.level < 1 || entry.level > targetLevel) errors.push(`Class hit-point entry level ${entry.level} is outside the effective class levels.`);
    if (entry.level === 1 && entry.value !== 'max') errors.push('Level 1 class hit points must use the maximum hit die.');
    if (entry.level > 1 && entry.value === 'max') errors.push(`Class hit points at level ${entry.level} cannot use the maximum gain.`);
    if (typeof entry.value === 'number' && (!Number.isInteger(entry.value) || entry.value < 1 || dieMaximum === undefined || entry.value > dieMaximum)) {
      errors.push(`Numeric class hit-point gain at level ${entry.level} must be an integer from 1 through the hit die maximum.`);
    }
  }

  if (Number.isInteger(targetLevel) && targetLevel >= 1) {
    for (let level = 1; level <= targetLevel; level++) {
      if (!seenLevels.has(level)) errors.push(`Missing class hit-point entry for level ${level}.`);
    }
  }
  return errors;
}

/** Calculate effective maximum HP without changing the recorded die gains. */
export function calculateClassHitPoints(
  entries: readonly ClassHitPointEntry[],
  classSourcePath: string,
  hitDie: string,
  targetLevel: number,
  constitutionModifier: number,
  permanentPerLevelBonus: number,
): number {
  const effectiveEntries = entries.filter((entry) => isRecord(entry) && Number.isInteger(entry.level) && entry.level <= targetLevel);
  const errors = validateClassHitPoints(effectiveEntries, classSourcePath, hitDie, targetLevel);
  if (errors.length > 0) throw new Error(errors.join(' '));
  if (!Number.isInteger(constitutionModifier) || !Number.isInteger(permanentPerLevelBonus) || permanentPerLevelBonus < 0) throw new Error('Invalid hit-point modifier.');
  const dieMaximum = parseHitDie(hitDie)!;
  return effectiveEntries.reduce((total, entry) => {
    const gain = entry.value === 'max' ? dieMaximum : entry.value === 'avg' ? Math.floor(dieMaximum / 2) + 1 : entry.value;
    return total + Math.max(1, gain + constitutionModifier) + permanentPerLevelBonus;
  }, 0);
}

export function isClassHitPointEntry(value: unknown): value is ClassHitPointEntry {
  return isRecord(value)
    && typeof value.classSourcePath === 'string'
    && value.classSourcePath.trim().length > 0
    && Number.isInteger(value.level)
    && (value.value === 'max' || value.value === 'avg' || typeof value.value === 'number' && Number.isInteger(value.value) && value.value >= 1);
}

function parseHitDie(hitDie: string): number | undefined {
  const match = /^d([1-9]\d*)$/i.exec(hitDie.trim());
  if (match?.[1] === undefined) return undefined;
  const maximum = Number(match[1]);
  return Number.isSafeInteger(maximum) ? maximum : undefined;
}

function isHitPointGain(value: unknown): value is ClassHitPointGain {
  return value === 'max' || value === 'avg' || typeof value === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
