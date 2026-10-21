import { describe, expect, it } from 'vitest';
import { calculateClassHitPoints, validateClassHitPoints, type ClassHitPointEntry } from '../src/class-hit-points';

const fighterPath = 'packs/_source/classes24/fighter/fighter.yml';

describe('class hit-point ledger', () => {
  it('calculates maximum HP from the level-one maximum and later average and numeric gains', () => {
    const entries: ClassHitPointEntry[] = [
      { classSourcePath: fighterPath, level: 1, value: 'max' },
      { classSourcePath: fighterPath, level: 2, value: 'avg' },
      { classSourcePath: fighterPath, level: 3, value: 4 },
    ];

    expect(calculateClassHitPoints(entries, fighterPath, 'd10', 3, 2, 0)).toBe(26);
    expect(calculateClassHitPoints(entries, fighterPath, 'd10', 3, 3, 0)).toBe(29);
  });

  it('applies the minimum of one HP after the Constitution modifier at each level', () => {
    const entries: ClassHitPointEntry[] = [
      { classSourcePath: fighterPath, level: 1, value: 'max' },
      { classSourcePath: fighterPath, level: 2, value: 1 },
    ];

    expect(calculateClassHitPoints(entries, fighterPath, 'd10', 2, -20, 0)).toBe(2);
  });

  it('rejects malformed, out-of-range, duplicate, wrong-class, and missing entries', () => {
    const valid: ClassHitPointEntry[] = [
      { classSourcePath: fighterPath, level: 1, value: 'max' },
      { classSourcePath: fighterPath, level: 2, value: 'avg' },
    ];

    expect(validateClassHitPoints([{ ...valid[0]!, value: 10 }, valid[1]!], fighterPath, 'd10', 2)).not.toHaveLength(0);
    expect(validateClassHitPoints([{ ...valid[0]!, value: 'rolled' } as unknown as ClassHitPointEntry, valid[1]!], fighterPath, 'd10', 2)).not.toHaveLength(0);
    expect(validateClassHitPoints([valid[0]!, { ...valid[1]!, value: 11 }], fighterPath, 'd10', 2)).not.toHaveLength(0);
    expect(validateClassHitPoints([valid[0]!, valid[1]!, valid[1]!], fighterPath, 'd10', 2)).not.toHaveLength(0);
    expect(validateClassHitPoints([valid[0]!, { ...valid[1]!, classSourcePath: 'packs/_source/classes24/wizard/wizard.yml' }], fighterPath, 'd10', 2)).not.toHaveLength(0);
    expect(validateClassHitPoints([valid[0]!], fighterPath, 'd10', 2)).not.toHaveLength(0);
    expect(validateClassHitPoints([valid[0]!, valid[1]!, { classSourcePath: fighterPath, level: 3, value: 5 }], fighterPath, 'd10', 2)).not.toHaveLength(0);
  });

  it('excludes higher-level entries when calculating a reduced target level', () => {
    const entries: ClassHitPointEntry[] = [
      { classSourcePath: fighterPath, level: 1, value: 'max' },
      { classSourcePath: fighterPath, level: 2, value: 'avg' },
      { classSourcePath: fighterPath, level: 3, value: 10 },
    ];

    expect(calculateClassHitPoints(entries, fighterPath, 'd10', 2, 2, 0)).toBe(20);
  });
});
