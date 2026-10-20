import { describe, expect, it } from 'vitest';
import { proficiencyBonusForLevel } from '../src/proficiency-bonus';

describe('Foundry proficiency bonus projection', () => {
  it.each([
    [1, 2], [4, 2],
    [5, 3], [8, 3],
    [9, 4], [12, 4],
    [13, 5], [16, 5],
    [17, 6], [20, 6],
  ])('maps level %i to +%i', (level, expected) => {
    expect(proficiencyBonusForLevel(level)).toBe(expected);
  });

  it('rejects levels outside the character progression', () => {
    expect(proficiencyBonusForLevel(0)).toBeUndefined();
    expect(proficiencyBonusForLevel(1.5)).toBeUndefined();
  });
});
