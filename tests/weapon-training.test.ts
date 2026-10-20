import { describe, expect, it } from 'vitest';
import { eligibleWeaponMasteryIds, validateWeaponMasterySelections } from '../src/weapon-training';
import type { FoundryItemSummary } from '../src/foundry-source-catalog';

const item = (id: string, category: string, mastery: string): FoundryItemSummary => ({
  sourcePath: `${id}.yml`, pack: 'test', type: 'weapon', id, identifier: id, name: id,
  ruleset: '2024', itemType: 'weapon', category, subcategory: id, mastery,
  magic: false, equippable: true, properties: [],
});

describe('weapon mastery eligibility', () => {
  it('accepts specifically trained weapons and excludes untrained, unarmed, and generic records', () => {
    const items = [item('dagger', 'simpleM', 'nick'), item('shortsword', 'martialM', 'vex'), item('warhammer', 'martialM', 'push'), item('unarmed-strike', 'simpleM', ''), item('weapon-plus-one', 'martialM', '')];
    const training = ['weapon:sim', 'weapon:mar:shortsword'];

    expect([...eligibleWeaponMasteryIds(items, training)].filter((value) => value.split(':').length === 2)).toEqual(['weapon:dagger', 'weapon:shortsword']);
    expect(validateWeaponMasterySelections(['weapon:shortsword', 'weapon:dagger'], items, training)).toEqual([]);
    expect(validateWeaponMasterySelections(['weapon:sim:dagger', 'weapon:mar:shortsword'], items, training)).toEqual([]);
    expect(validateWeaponMasterySelections(['weapon:warhammer'], items, training)).toContain('Weapon Mastery selection Warhammer is not eligible for the current weapon proficiencies.');
    expect(validateWeaponMasterySelections(['weapon:mar:dagger'], items, training)).toHaveLength(1);
  });
});
