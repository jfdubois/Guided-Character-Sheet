import type { FoundryItemSummary } from './foundry-source-catalog';

/** Match Foundry category and base-item selectors without treating all martial weapons as trained. */
export function isWeaponTrained(item: Pick<FoundryItemSummary, 'category' | 'subcategory' | 'identifier' | 'id'>, selectors: readonly string[]): boolean | undefined {
  const category = item.category?.toLowerCase();
  const key = category?.startsWith('martial') ? 'mar' : category?.startsWith('simple') ? 'sim' : category;
  if (key === undefined) return undefined;
  if (selectors.includes(`weapon:${key}`)) return true;
  return [item.subcategory, item.identifier, item.id].some((identity) => identity !== undefined && (
    selectors.includes(`weapon:${key}:${identity.toLowerCase()}`) || selectors.includes(`weapon:${identity.toLowerCase()}`)
  ));
}

export function eligibleWeaponMasteryIds(items: readonly FoundryItemSummary[], training: readonly string[]): ReadonlySet<string> {
  return new Set(items
    .filter((item) => item.itemType === 'weapon' && !item.magic && item.mastery?.trim() && isWeaponTrained(item, training) === true)
    .flatMap((item) => {
      const identity = (item.identifier ?? item.id).toLowerCase();
      const category = item.category?.toLowerCase();
      const key = category?.startsWith('martial') ? 'mar' : category?.startsWith('simple') ? 'sim' : undefined;
      return [`weapon:${identity}`, ...(key === undefined ? [] : [`weapon:${key}:${identity}`])];
    }));
}

export function validateWeaponMasterySelections(selected: readonly string[], items: readonly FoundryItemSummary[], training: readonly string[]): string[] {
  const eligible = eligibleWeaponMasteryIds(items, training);
  return selected.filter((value) => !eligible.has(value.toLowerCase())).map((value) => {
    const name = value.split(':').at(-1)?.replace(/[-_]/g, ' ') ?? value;
    return `Weapon Mastery selection ${name.charAt(0).toUpperCase()}${name.slice(1)} is not eligible for the current weapon proficiencies.`;
  });
}
