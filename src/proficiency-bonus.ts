/** Mirrors Foundry dnd5e's level-based Proficiency.calculateMod calculation. */
export function proficiencyBonusForLevel(level: number): number | undefined {
  if (!Number.isInteger(level) || level < 1) return undefined;
  return Math.floor((level + 7) / 4);
}
